import { TSV_FILES, ORGANIZATION_ID } from "../config";
import { parseTsvFile } from "../lib/tsv-parser";
import { IdMap } from "../lib/id-map";
import { logger } from "../lib/logger";
import { emptyToNull } from "../lib/validators";
import { getSequelize } from "../lib/db";

const CTX = "phase4/superbill-procedures";

/**
 * Imports superbill procedures (CPT codes) into `bill_services`.
 * Pre-reads superbill-diagnosis.tsv to populate diagnosisPointers per procedure.
 */
export async function importSuperbillProcedures(billingHeaderMap: IdMap): Promise<void> {
    logger.info(CTX, "Starting superbill procedures import...");

    const sequelize = getSequelize();

    // ─── Pre-read diagnoses grouped by BillingProcedureGuid ───
    const diagRows = await parseTsvFile(TSV_FILES.superbillDiagnoses);
    const diagByProcedure = new Map<string, string[]>();

    for (const row of diagRows) {
        const procGuid = row.BillingProcedureGuid;
        const code = emptyToNull(row.DiagnosisCode);
        if (!procGuid || !code) continue;

        if (!diagByProcedure.has(procGuid)) diagByProcedure.set(procGuid, []);

        const existing = diagByProcedure.get(procGuid)!;
        if (!existing.includes(code)) existing.push(code);
    }

    logger.info(CTX, `Pre-loaded diagnosis pointers for ${diagByProcedure.size} procedures`);

    // ─── Import procedures ───
    const rows = await parseTsvFile(TSV_FILES.superbillProcedures);
    logger.info(CTX, `Found ${rows.length} superbill procedure records`);

    // Pre-load existing bill_services to check duplicates
    const [existingServices] = await sequelize.query(
        `SELECT bs.bill_id, bs.cpt_code FROM bill_services bs JOIN bills b ON bs.bill_id = b.id WHERE b.organization_id = $1`,
        { bind: [ORGANIZATION_ID] }
    ) as [any[], unknown];
    const existingServiceSet = new Set(
        existingServices.map((s: any) => `${s.bill_id}|${s.cpt_code}`)
    );
    logger.info(CTX, `Found ${existingServices.length} existing bill services`);

    let imported = 0;
    let updated = 0;
    let skipped = 0;
    let errored = 0;

    // Track sortOrder per bill
    const billSortOrders = new Map<number, number>();

    for (const row of rows) {
        const headerGuid = row.BillingHeaderGuid;
        const procGuid = row.BillingProcedureGuid;

        if (!headerGuid || !billingHeaderMap.has(headerGuid)) {
            skipped++;
            continue;
        }

        const billId = billingHeaderMap.get(headerGuid)!;
        const cptCode = emptyToNull(row.BillingCode);

        if (!cptCode) {
            logger.warn(CTX, `Procedure ${procGuid}: missing billing code, skipping`);
            skipped++;
            continue;
        }

        // Check if already exists
        const serviceKey = `${billId}|${cptCode}`;
        if (existingServiceSet.has(serviceKey)) {
            updated++;
            continue;
        }
        existingServiceSet.add(serviceKey);

        const quantity = row.Quantity ? Math.max(1, Math.round(parseFloat(row.Quantity))) : 1;
        const amount = row.Amount ? parseFloat(row.Amount) : 0;
        const totalCharge = amount * quantity;
        const description = emptyToNull(row.Description);
        const diagnosisPointers = procGuid ? (diagByProcedure.get(procGuid) || []) : [];

        // Track sort order per bill
        const currentSort = (billSortOrders.get(billId) || 0);
        billSortOrders.set(billId, currentSort + 1);

        try {
            await sequelize.query(
                `INSERT INTO bill_services
                    (bill_id, cpt_code, description, units, unit_charge, total_charge,
                     diagnosis_pointers, modifiers, status, sort_order, created_at, updated_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())`,
                {
                    bind: [
                        billId,
                        cptCode,
                        description,
                        quantity,
                        amount,
                        totalCharge,
                        JSON.stringify(diagnosisPointers),
                        JSON.stringify([]),
                        "unposted",
                        currentSort,
                    ],
                }
            );
            imported++;
        } catch (err: any) {
            logger.error(CTX, `Procedure ${procGuid} for bill ${headerGuid}: ${err.message}`);
            errored++;
        }
    }

    logger.summary(CTX, { imported, updated, skipped, errored, total: rows.length });
}
