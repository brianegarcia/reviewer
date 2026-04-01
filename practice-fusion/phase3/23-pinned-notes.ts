import { TSV_FILES } from "../config";
import { parseTsvFile } from "../lib/tsv-parser";
import { IdMap } from "../lib/id-map";
import { logger } from "../lib/logger";
import { cleanPfHtml, emptyToNull } from "../lib/validators";
import { getSequelize } from "../lib/db";

const CTX = "phase3/pinned-notes";

/**
 * Imports pinned notes from Practice Fusion.
 * Stores in patient_diagnosis_timeline.personal_note JSON.
 */
export async function importPinnedNotes(patientMap: IdMap): Promise<void> {
    logger.info(CTX, "Starting pinned notes import...");

    const sequelize = getSequelize();
    const rows = await parseTsvFile(TSV_FILES.pinnedNotes);
    logger.info(CTX, `Found ${rows.length} pinned note records`);

    // Group by patient
    const notesByPatient = new Map<number, { type: string; text: string; date: string | null }[]>();

    let skipped = 0;
    for (const row of rows) {
        const patientId = patientMap.get(row.PatientPracticeGuid || "");
        if (!patientId) {
            skipped++;
            continue;
        }

        const text = cleanPfHtml(row.NoteText);
        if (!text) {
            skipped++;
            continue;
        }

        if (!notesByPatient.has(patientId)) {
            notesByPatient.set(patientId, []);
        }
        notesByPatient.get(patientId)!.push({
            type: emptyToNull(row.NoteType) || "PINNED",
            text,
            date: emptyToNull(row.LastModifiedDateTimeUtc),
        });
    }

    logger.info(CTX, `Grouped pinned notes for ${notesByPatient.size} patients`);

    let imported = 0;
    let errored = 0;

    for (const [patientId, notes] of notesByPatient) {
        try {
            const [existing] = await sequelize.query(
                `SELECT id FROM patient_diagnosis_timeline WHERE patient_id = $1 AND deleted_at IS NULL`,
                { bind: [patientId] }
            ) as [any[], unknown];

            if (existing.length > 0) {
                await sequelize.query(
                    `UPDATE patient_diagnosis_timeline SET personal_note = $1::jsonb, updated_at = NOW() WHERE patient_id = $2 AND deleted_at IS NULL`,
                    { bind: [JSON.stringify(notes), patientId] }
                );
            } else {
                await sequelize.query(
                    `INSERT INTO patient_diagnosis_timeline (patient_id, diagnosis_timeline, personal_note, created_at, updated_at)
                     VALUES ($1, '[]'::json, $2::jsonb, NOW(), NOW())`,
                    { bind: [patientId, JSON.stringify(notes)] }
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
