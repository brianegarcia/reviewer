import { TSV_FILES, BATCH_SIZE } from "../config";
import { parseTsvFile } from "../lib/tsv-parser";
import { parseTsvBatched } from "../lib/tsv-parser";
import { IdMap } from "../lib/id-map";
import { logger } from "../lib/logger";
import { emptyToNull } from "../lib/validators";
import { getSequelize } from "../lib/db";

const CTX = "phase3/lab-result-notes";

/**
 * Imports lab result notes from Practice Fusion.
 *
 * The PF export has a broken link: patient-lab-results.tsv has ResultGuid but
 * OrderGuid is null for 99%+ of rows. So we can't directly map result notes
 * to imported lab_orders.
 *
 * Strategy: group notes by patient (via PatientPracticeGuid), then find that
 * patient's lab orders and append notes as a combined comment.
 *
 * Sources:
 * - patient-lab-result-notes.tsv (557 rows) - general notes per result
 * - lab-result-tests-observation-notes.tsv (18k rows) - notes per observation
 */
export async function importLabResultNotes(labOrderMap: IdMap, patientMap: IdMap): Promise<void> {
    logger.info(CTX, "Starting lab result notes import...");

    const sequelize = getSequelize();

    // 1. Collect all result notes grouped by patient
    const notesByPatient = new Map<number, string[]>();

    const resultNotes = await parseTsvFile(TSV_FILES.patientLabResultNotes);
    logger.info(CTX, `Found ${resultNotes.length} lab result notes`);

    let skipped = 0;
    for (const row of resultNotes) {
        const patientId = patientMap.get(row.PatientPracticeGuid || "");
        if (!patientId) {
            skipped++;
            continue;
        }

        const note = emptyToNull(row.Note);
        if (!note) continue;

        if (!notesByPatient.has(patientId)) {
            notesByPatient.set(patientId, []);
        }
        notesByPatient.get(patientId)!.push(note);
    }

    // 2. Process observation notes (large file)
    let obsNoteCount = 0;
    await parseTsvBatched(TSV_FILES.labResultObservationNotes, BATCH_SIZE, async (batch) => {
        for (const row of batch) {
            const patientId = patientMap.get(row.PatientPracticeGuid || "");
            if (!patientId) continue;

            const note = emptyToNull(row.ObservationNote);
            if (!note) continue;

            if (!notesByPatient.has(patientId)) {
                notesByPatient.set(patientId, []);
            }
            notesByPatient.get(patientId)!.push(note);
            obsNoteCount++;
        }
    });

    logger.info(CTX, `Collected notes for ${notesByPatient.size} patients (${resultNotes.length} result notes, ${obsNoteCount} observation notes)`);

    // 3. For each patient with notes, find their lab orders and append
    let imported = 0;
    let errored = 0;
    let noLabOrders = 0;

    for (const [patientId, notes] of notesByPatient) {
        try {
            // Find lab orders for this patient
            const [rows] = await sequelize.query(
                `SELECT id FROM lab_orders WHERE patient_id = $1 AND deleted_at IS NULL ORDER BY created_at ASC LIMIT 1`,
                { bind: [patientId] }
            ) as [any[], unknown];

            if (rows.length === 0) {
                noLabOrders++;
                continue;
            }

            // Dedupe notes and combine
            const uniqueNotes = [...new Set(notes)];
            const combinedNotes = uniqueNotes.slice(0, 50).join("\n---\n"); // cap at 50 unique notes

            const labOrderId = rows[0].id;
            await sequelize.query(
                `UPDATE lab_orders SET comment = CASE
                    WHEN comment IS NULL OR comment = '' THEN $1
                    ELSE comment || E'\\n---\\nLab Result Notes:\\n' || $1
                 END, updated_at = NOW()
                 WHERE id = $2`,
                { bind: [combinedNotes, labOrderId] }
            );
            imported++;
        } catch (err: any) {
            logger.error(CTX, `Patient ${patientId}: ${err.message}`);
            errored++;
        }
    }

    if (noLabOrders > 0) {
        logger.warn(CTX, `${noLabOrders} patients had result notes but no lab orders in SubQDocs`);
    }

    logger.summary(CTX, {
        imported,
        updated: 0,
        skipped: skipped + noLabOrders,
        errored,
        total: notesByPatient.size,
    });
}
