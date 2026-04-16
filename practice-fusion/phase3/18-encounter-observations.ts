import { TSV_FILES } from "../config";
import { parseTsvFile } from "../lib/tsv-parser";
import { IdMap } from "../lib/id-map";
import { logger } from "../lib/logger";
import { emptyToNull } from "../lib/validators";
import { getSequelize } from "../lib/db";
import { wrapHtml } from "../lib/html-helpers";

const CTX = "phase3/encounter-observations";

interface PhysicalExamObservation {
    code: string;
    codeSystem: string;
    unit: string | null;
    value: string | null;
    comment: string | null;
}

function buildObservationsHtml(observations: PhysicalExamObservation[]): string {
    const items = observations
        .map((o) => {
            let detail = o.code;
            if (o.codeSystem) detail += ` (${o.codeSystem})`;
            if (o.value) {
                detail += ` &mdash; ${o.value}`;
                if (o.unit) detail += ` ${o.unit}`;
            }
            if (o.comment) detail += `; <em>${o.comment}</em>`;
            return `<li>${detail}</li>`;
        })
        .join("");
    return `<p><strong>Physical Exam Observations:</strong></p><ul>${items}</ul>`;
}

/**
 * Imports physical exam observations per encounter.
 * Appends to the existing exam HTML in full_note_details (written by step 15),
 * or creates a new exam section if none exists.
 */
export async function importEncounterObservations(encounterMap: IdMap): Promise<void> {
    logger.info(CTX, "Starting encounter observations import...");

    const sequelize = getSequelize();
    const rows = await parseTsvFile(TSV_FILES.patientEncounterObservations);
    logger.info(CTX, `Found ${rows.length} observation records`);

    // Group by encounter
    const obsByEncounter = new Map<string, PhysicalExamObservation[]>();

    let skipped = 0;
    for (const row of rows) {
        const encounterGuid = row.EncounterGuid;
        if (!encounterGuid || !encounterMap.has(encounterGuid)) {
            skipped++;
            continue;
        }

        if (!obsByEncounter.has(encounterGuid)) {
            obsByEncounter.set(encounterGuid, []);
        }
        obsByEncounter.get(encounterGuid)!.push({
            codeSystem: emptyToNull(row.ObservationCodeSystem) || "",
            code: emptyToNull(row.ObservationCode) || "",
            unit: emptyToNull(row.UnitOfObservation),
            value: emptyToNull(row.Value),
            comment: emptyToNull(row.Comment),
        });
    }

    logger.info(CTX, `Grouped observations for ${obsByEncounter.size} encounters`);

    let imported = 0;
    let errored = 0;

    for (const [encounterGuid, observations] of obsByEncounter) {
        const visitId = encounterMap.get(encounterGuid);
        if (!visitId) continue;

        try {
            const obsHtmlFragment = buildObservationsHtml(observations);

            // Read existing exam from step 15
            const [existing] = await sequelize.query(
                `SELECT full_note_details->>'exam' AS exam FROM full_note
                 WHERE visit_id = $1 AND is_current = true AND deleted_at IS NULL LIMIT 1`,
                { bind: [visitId] }
            ) as [any[], unknown];

            const currentExam: string | null = existing[0]?.exam || null;
            let newExam: string;

            if (currentExam) {
                // Append inside the existing </section> tag
                newExam = currentExam.replace(/<\/section>\s*$/, `${obsHtmlFragment}</section>`);
            } else {
                newExam = wrapHtml(obsHtmlFragment);
            }

            await sequelize.query(
                `UPDATE full_note SET full_note_details = jsonb_set(
                    COALESCE(full_note_details::jsonb, '{}'::jsonb),
                    '{exam}',
                    $1::jsonb
                 ), updated_at = NOW()
                 WHERE visit_id = $2 AND is_current = true AND deleted_at IS NULL`,
                { bind: [JSON.stringify(newExam), visitId] }
            );
            imported++;
        } catch (err: any) {
            logger.error(CTX, `Encounter ${encounterGuid}: ${err.message}`);
            errored++;
        }
    }

    logger.summary(CTX, { imported, updated: 0, skipped, errored, total: rows.length });
}
