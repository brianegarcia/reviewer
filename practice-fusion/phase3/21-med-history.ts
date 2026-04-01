import { TSV_FILES } from "../config";
import { parseTsvFile } from "../lib/tsv-parser";
import { IdMap } from "../lib/id-map";
import { logger } from "../lib/logger";
import { emptyToNull } from "../lib/validators";
import { getSequelize } from "../lib/db";

const CTX = "phase3/med-history";

/**
 * Imports patient medical history from Practice Fusion.
 * Maps to patient_medical_history.current_conditions as JSONB.
 */
export async function importMedHistory(patientMap: IdMap): Promise<void> {
    logger.info(CTX, "Starting medical history import...");

    const sequelize = getSequelize();
    const rows = await parseTsvFile(TSV_FILES.patientMedHistory);
    logger.info(CTX, `Found ${rows.length} med history records`);

    // Group by patient
    const historyByPatient = new Map<number, { historyType: string; reportedHistory: string }[]>();

    let skipped = 0;
    for (const row of rows) {
        const patientId = patientMap.get(row.PatientPracticeGuid || "");
        if (!patientId) {
            skipped++;
            continue;
        }

        const history = emptyToNull(row.ReportedHistory);
        if (!history) {
            skipped++;
            continue;
        }

        if (!historyByPatient.has(patientId)) {
            historyByPatient.set(patientId, []);
        }
        historyByPatient.get(patientId)!.push({
            historyType: emptyToNull(row.HistoryType) || "General",
            reportedHistory: history,
        });
    }

    logger.info(CTX, `Grouped history for ${historyByPatient.size} patients`);

    let imported = 0;
    let errored = 0;

    for (const [patientId, entries] of historyByPatient) {
        try {
            const conditions = entries.map((e) => ({
                name: e.historyType,
                notes: e.reportedHistory,
                source: "practice_fusion_import",
            }));

            const [existing] = await sequelize.query(
                `SELECT id, current_conditions FROM patient_medical_history WHERE patient_id = $1 AND deleted_at IS NULL`,
                { bind: [patientId] }
            ) as [any[], unknown];

            if (existing.length > 0) {
                const current = existing[0].current_conditions || [];
                const merged = [...current, ...conditions];
                await sequelize.query(
                    `UPDATE patient_medical_history SET current_conditions = $1::jsonb, updated_at = NOW() WHERE patient_id = $2 AND deleted_at IS NULL`,
                    { bind: [JSON.stringify(merged), patientId] }
                );
            } else {
                await sequelize.query(
                    `INSERT INTO patient_medical_history (patient_id, current_conditions, created_at, updated_at)
                     VALUES ($1, $2::jsonb, NOW(), NOW())`,
                    { bind: [patientId, JSON.stringify(conditions)] }
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
