import { TSV_FILES, ORGANIZATION_ID } from "../config";
import { parseTsvFile } from "../lib/tsv-parser";
import { IdMap } from "../lib/id-map";
import { logger } from "../lib/logger";
import { emptyToNull } from "../lib/validators";
import { getSequelize } from "../lib/db";

const CTX = "phase4/superbills";

function mapBillingStatus(pfStatus: string | null): string {
    switch (pfStatus?.toLowerCase()) {
        case "draft": return "draft";
        case "ready": return "finalized";
        case "submitted": return "claim_filed";
        case "paid": return "paid";
        default: return "draft";
    }
}

/**
 * Imports Practice Fusion superbills into the `bills` table.
 * Pre-reads superbill-diagnosis.tsv to build diagnoses JSONB per bill.
 */
export async function importSuperbills(
    patientMap: IdMap,
    profileMap: IdMap,
    encounterMap: IdMap,
    facilityMap: IdMap
): Promise<IdMap> {
    logger.info(CTX, "Starting superbills import...");

    const sequelize = getSequelize();
    const billingHeaderMap = new IdMap("billing-header-map");

    // ─── Pre-read diagnoses grouped by BillingHeaderGuid ───
    const diagRows = await parseTsvFile(TSV_FILES.superbillDiagnoses);
    const diagByBill = new Map<string, { code: string; label: string }[]>();

    for (const row of diagRows) {
        const headerGuid = row.BillingHeaderGuid;
        const code = emptyToNull(row.DiagnosisCode);
        const label = emptyToNull(row.Description);
        if (!headerGuid || !code) continue;

        if (!diagByBill.has(headerGuid)) diagByBill.set(headerGuid, []);

        // Deduplicate by code within the same bill
        const existing = diagByBill.get(headerGuid)!;
        if (!existing.some((d) => d.code === code)) {
            existing.push({ code, label: label || code });
        }
    }

    logger.info(CTX, `Pre-loaded diagnoses for ${diagByBill.size} bills`);

    // ─── Get next billReadableId sequence ───
    const [[{ max_seq }]] = (await sequelize.query(
        `SELECT COALESCE(MAX(CAST(SUBSTRING(bill_readable_id FROM 4) AS INTEGER)), 0) as max_seq FROM bills`
    )) as any;
    let nextSeq = (max_seq || 0) + 1;

    // ─── Import superbills ───
    const rows = await parseTsvFile(TSV_FILES.superbills);
    logger.info(CTX, `Found ${rows.length} superbill records`);

    // Pre-load existing bills to check duplicates
    const [existingBills] = await sequelize.query(
        `SELECT id, visit_id, patient_id, date_of_service FROM bills WHERE organization_id = $1`,
        { bind: [ORGANIZATION_ID] }
    ) as [any[], unknown];
    const existingBillSet = new Set(
        existingBills.map((b: any) => `${b.patient_id}|${b.visit_id ?? "null"}`)
    );
    logger.info(CTX, `Found ${existingBills.length} existing bills`);

    let imported = 0;
    let updated = 0;
    let skipped = 0;
    let errored = 0;

    for (const row of rows) {
        const headerGuid = row.BillingHeaderGuid;
        const patientGuid = row.PatientPracticeGuid;

        if (!headerGuid || !patientGuid || !patientMap.has(patientGuid)) {
            skipped++;
            continue;
        }

        const patientId = patientMap.get(patientGuid);
        const encounterGuid = emptyToNull(row.EncounterGuid);
        const visitId = (encounterGuid ? encounterMap.get(encounterGuid) : null) ?? null;
        const providerGuid = emptyToNull(row.PerformingProviderProfileGuid);
        const providerId = (providerGuid ? profileMap.get(providerGuid) : null) ?? null;
        const facilityGuid = emptyToNull(row.PerformingFacilityGuid);
        const locationId = (facilityGuid ? facilityMap.get(facilityGuid) : null) ?? null;

        // dateOfService: get from encounter's visit or fall back to LastModifiedDateTimeUtc
        let dateOfService: string | null = null;
        if (visitId) {
            const [[visit]] = (await sequelize.query(
                `SELECT visit_date FROM patient_visits WHERE id = $1`,
                { bind: [visitId] }
            )) as any;
            if (visit) dateOfService = visit.visit_date;
        }
        if (!dateOfService) {
            // Parse from LastModifiedDateTimeUtc as fallback
            const modified = emptyToNull(row.LastModifiedDateTimeUtc);
            if (modified) {
                const d = new Date(modified);
                if (!isNaN(d.getTime())) dateOfService = d.toISOString().split("T")[0];
            }
        }
        if (!dateOfService) dateOfService = new Date().toISOString().split("T")[0];

        // Check if bill already exists for this patient+visit
        const billKey = `${patientId}|${visitId ?? "null"}`;
        if (existingBillSet.has(billKey)) {
            const match = existingBills.find(
                (b: any) => b.patient_id === patientId && (b.visit_id ?? null) === (visitId ?? null)
            );
            if (match) billingHeaderMap.set(headerGuid, match.id);
            updated++;
            continue;
        }
        existingBillSet.add(billKey);

        const status = mapBillingStatus(row.BillingStatus);
        const diagnoses = diagByBill.get(headerGuid) || [];
        const billReadableId = `BL-${String(nextSeq).padStart(6, "0")}`;

        // createdBy: use provider or fallback to first user in org
        let createdBy = providerId;
        if (!createdBy) {
            const [[firstUser]] = (await sequelize.query(
                `SELECT id FROM users WHERE organization_id = $1 LIMIT 1`,
                { bind: [ORGANIZATION_ID] }
            )) as any;
            createdBy = firstUser?.id || 1;
        }

        try {
            const [results] = await sequelize.query(
                `INSERT INTO bills
                    (bill_readable_id, organization_id, patient_id, visit_id, primary_provider_id,
                     location_id, date_of_service, status, total_charges, balance,
                     diagnoses, created_by, created_at, updated_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW())
                 RETURNING id`,
                {
                    bind: [
                        billReadableId,
                        ORGANIZATION_ID,
                        patientId,
                        visitId,
                        providerId,
                        locationId,
                        dateOfService,
                        status,
                        0, // totalCharges - will be updated by 33-update-bill-totals
                        0, // balance - will be updated by 33-update-bill-totals
                        JSON.stringify(diagnoses),
                        createdBy,
                    ],
                }
            );
            const billId = (results as any[])[0].id;
            billingHeaderMap.set(headerGuid, billId);
            nextSeq++;
            imported++;
        } catch (err: any) {
            logger.error(CTX, `Superbill ${headerGuid}: ${err.message}`);
            errored++;
            nextSeq++; // Still increment to avoid collision on retry
        }
    }

    logger.summary(CTX, { imported, updated, skipped, errored, total: rows.length });

    return billingHeaderMap;
}
