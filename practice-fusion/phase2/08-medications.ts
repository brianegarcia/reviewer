import PatientMedication from "@models/patient-medication.model";
import { TSV_FILES, BATCH_SIZE } from "../config";
import { parseTsvBatched } from "../lib/tsv-parser";
import { IdMap } from "../lib/id-map";
import { logger } from "../lib/logger";
import { emptyToNull, truncate, parseDate } from "../lib/validators";
import { getSequelize } from "../lib/db";

const CTX = "phase2/medications";

export async function importMedications(patientMap: IdMap, providerMap: IdMap): Promise<void> {
    logger.info(CTX, "Starting medications import...");

    const stats = { imported: 0, updated: 0, skipped: 0, errored: 0, total: 0 };
    const sequelize = getSequelize();

    // Pre-load existing medications for org patients to check duplicates
    const [existingRows] = await sequelize.query(
        `SELECT patient_id, medication_name, dosage FROM patient_medications`
    ) as [any[], unknown];
    const existingSet = new Set(
        existingRows.map((r: any) => `${r.patient_id}|${r.medication_name}|${r.dosage || ""}`)
    );
    logger.info(CTX, `Loaded ${existingSet.size} existing medication records`);

    const totalRows = await parseTsvBatched(TSV_FILES.patientMedications, BATCH_SIZE, async (batch, batchIndex) => {
        const mappedRows: Record<string, any>[] = [];

        for (const row of batch) {
            const patientId = patientMap.get(row.PatientPracticeGuid || "");
            if (!patientId) {
                stats.skipped++;
                continue;
            }

            const medicationName = emptyToNull(row.MedicationName);
            if (!medicationName) {
                stats.skipped++;
                continue;
            }

            const name = truncate(medicationName, 255)!;
            const dosage = truncate(emptyToNull(row.ProductStrength), 100) || "";
            const key = `${patientId}|${name}|${dosage}`;

            if (existingSet.has(key)) {
                stats.updated++;
                continue;
            }
            existingSet.add(key);

            const createdBy = providerMap.get(row.LastModifiedByProviderGuid || "") || null;
            const stopDate = parseDate(row.StopDate);

            mappedRows.push({
                patient_id: patientId,
                medication_name: name,
                generic_name: truncate(emptyToNull(row.GenericName), 255),
                dose_form: truncate(emptyToNull(row.DoseForm), 100),
                route: truncate(emptyToNull(row.Route), 100),
                dosage: dosage || null,
                notes: emptyToNull(row.Sig),
                created_by: createdBy,
                // Soft-delete discontinued medications
                deleted_at: stopDate || null,
            });
        }

        if (mappedRows.length === 0) return;

        const transaction = await sequelize.transaction();
        try {
            await PatientMedication.bulkCreate(mappedRows as any[], { transaction });
            await transaction.commit();
            stats.imported += mappedRows.length;
            logger.info(CTX, `Batch ${batchIndex}: ${mappedRows.length} medications imported`);
        } catch (err: any) {
            await transaction.rollback();
            logger.error(CTX, `Batch ${batchIndex} failed: ${err.message}`);

            for (const row of mappedRows) {
                try {
                    await PatientMedication.create(row as any);
                    stats.imported++;
                } catch (innerErr: any) {
                    logger.error(CTX, `Medication for patient ${row.patient_id}: ${innerErr.message}`);
                    stats.errored++;
                }
            }
        }
    });

    stats.total = totalRows;
    logger.summary(CTX, stats);
}
