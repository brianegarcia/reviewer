import Prescription from "@models/prescription.model";
import { PrescriptionStatusEnum } from "@utils/enum";
import { ORGANIZATION_ID, TSV_FILES, BATCH_SIZE } from "../config";
import { parseTsvBatched, parseTsvFile } from "../lib/tsv-parser";
import { IdMap } from "../lib/id-map";
import { logger } from "../lib/logger";
import { emptyToNull, parseDate } from "../lib/validators";
import { getSequelize } from "../lib/db";

const CTX = "phase2/prescriptions";

export async function importPrescriptions(patientMap: IdMap, providerMap: IdMap): Promise<void> {
    logger.info(CTX, "Starting prescriptions import...");

    const stats = { imported: 0, updated: 0, skipped: 0, errored: 0, total: 0 };
    const sequelize = getSequelize();

    // Build PharmacyGuid → PharmacyName lookup
    const pharmacyRows = await parseTsvFile(TSV_FILES.pharmacies);
    const pharmacyNameMap = new Map<string, string>();
    for (const row of pharmacyRows) {
        if (row.PharmacyGuid && row.PharmacyName) {
            pharmacyNameMap.set(row.PharmacyGuid, row.PharmacyName);
        }
    }
    logger.info(CTX, `Loaded ${pharmacyNameMap.size} pharmacy names`);

    // Pre-load existing third_party_ids to skip duplicates
    const [existingRows] = await sequelize.query(
        `SELECT third_party_id FROM prescriptions WHERE third_party_id IS NOT NULL AND organization_id = $1`,
        { bind: [ORGANIZATION_ID] }
    ) as [any[], unknown];
    const existingIds = new Set(existingRows.map((r: any) => r.third_party_id));
    logger.info(CTX, `Loaded ${existingIds.size} existing prescription records`);

    const totalRows = await parseTsvBatched(TSV_FILES.patientPrescriptions, BATCH_SIZE, async (batch, batchIndex) => {
        const mappedRows: Record<string, any>[] = [];

        for (const row of batch) {
            const rxGuid = row.PrescriptionGuid;
            if (!rxGuid) {
                stats.skipped++;
                continue;
            }

            if (existingIds.has(rxGuid)) {
                stats.updated++;
                continue;
            }
            existingIds.add(rxGuid);

            const patientId = patientMap.get(row.PatientPracticeGuid || "");
            if (!patientId) {
                stats.skipped++;
                continue;
            }

            const doctorId = providerMap.get(row.PrescribingProviderGuid || "") || null;
            const dateOfService = parseDate(row.DateOfService);

            mappedRows.push({
                third_party_id: rxGuid,
                patient_id: patientId,
                organization_id: ORGANIZATION_ID,
                doctor_id: doctorId,
                prescriber_id: doctorId,
                drug_name: emptyToNull(row.MedicationDisplayName),
                sig: emptyToNull(row.Sig),
                quantity: emptyToNull(row.Quantity),
                day_supply: emptyToNull(row.DaysSupply),
                refill: emptyToNull(row.NumberOfRefills),
                daw: row.AllowSubstitutions === "True" ? "0" : "1",
                controlled_substances: emptyToNull(row.ControlledSubstanceSchedule),
                comments: emptyToNull(row.NoteToPharmacy),
                pharmacy_id: emptyToNull(row.PharmacyGuid),
                pharmacy_name: pharmacyNameMap.get(row.PharmacyGuid) || null,
                status: PrescriptionStatusEnum.COMPLETED,
                is_default: false,
                is_favorite: false,
                created_at: dateOfService || undefined,
            });
        }

        if (mappedRows.length === 0) return;

        const transaction = await sequelize.transaction();
        try {
            await Prescription.bulkCreate(mappedRows as any[], { transaction });
            await transaction.commit();
            stats.imported += mappedRows.length;
            logger.info(CTX, `Batch ${batchIndex}: ${mappedRows.length} prescriptions imported`);
        } catch (err: any) {
            await transaction.rollback();
            logger.error(CTX, `Batch ${batchIndex} failed: ${err.message}`);

            for (const row of mappedRows) {
                try {
                    await Prescription.create(row as any);
                    stats.imported++;
                } catch (innerErr: any) {
                    logger.error(CTX, `Prescription ${row.third_party_id}: ${innerErr.message}`);
                    stats.errored++;
                }
            }
        }
    });

    stats.total = totalRows;
    logger.summary(CTX, stats);
}
