import { TSV_FILES } from "../config";
import { parseTsvFile } from "../lib/tsv-parser";
import { IdMap } from "../lib/id-map";
import { logger } from "../lib/logger";
import { emptyToNull } from "../lib/validators";
import { getSequelize } from "../lib/db";

const CTX = "phase3/health-concerns";

/**
 * Imports patient health concerns from Practice Fusion.
 * Stores in patient_diagnosis_timeline.alerts JSON.
 */
export async function importHealthConcerns(patientMap: IdMap): Promise<void> {
    logger.info(CTX, "Starting health concerns import...");

    const sequelize = getSequelize();
    const rows = await parseTsvFile(TSV_FILES.patientHealthConcerns);
    logger.info(CTX, `Found ${rows.length} health concern records`);

    // Group by patient
    const concernsByPatient = new Map<number, { type: string; note: string; isActive: boolean; startDate: string | null; diagnosisGuid: string | null }[]>();

    let skipped = 0;
    for (const row of rows) {
        const patientId = patientMap.get(row.PatientPracticeGuid || "");
        if (!patientId) {
            skipped++;
            continue;
        }

        if (!concernsByPatient.has(patientId)) {
            concernsByPatient.set(patientId, []);
        }
        concernsByPatient.get(patientId)!.push({
            type: emptyToNull(row.HealthConcernType) || "note",
            note: emptyToNull(row.HealthConcernNote) || "",
            isActive: row.IsActive === "True",
            startDate: emptyToNull(row.StartDate),
            diagnosisGuid: emptyToNull(row.DiagnosisGuid),
        });
    }

    logger.info(CTX, `Grouped concerns for ${concernsByPatient.size} patients`);

    let imported = 0;
    let errored = 0;

    for (const [patientId, concerns] of concernsByPatient) {
        try {
            // Upsert: update if exists, insert if not
            const [existing] = await sequelize.query(
                `SELECT id FROM patient_diagnosis_timeline WHERE patient_id = $1 AND deleted_at IS NULL`,
                { bind: [patientId] }
            ) as [any[], unknown];

            if (existing.length > 0) {
                await sequelize.query(
                    `UPDATE patient_diagnosis_timeline SET alerts = $1::jsonb, updated_at = NOW() WHERE patient_id = $2 AND deleted_at IS NULL`,
                    { bind: [JSON.stringify(concerns), patientId] }
                );
            } else {
                await sequelize.query(
                    `INSERT INTO patient_diagnosis_timeline (patient_id, diagnosis_timeline, alerts, created_at, updated_at)
                     VALUES ($1, '[]'::json, $2::jsonb, NOW(), NOW())`,
                    { bind: [patientId, JSON.stringify(concerns)] }
                );
            }
            imported++;
        } catch (err: any) {
            logger.error(CTX, `Patient ${patientId}: ${err.message}`);
            errored++;
        }
    }

    logger.summary(CTX, { imported, updated: 0, skipped, errored, total: rows.length });
}
