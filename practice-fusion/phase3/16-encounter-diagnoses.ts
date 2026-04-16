import { TSV_FILES } from "../config";
import { parseTsvFile } from "../lib/tsv-parser";
import { IdMap } from "../lib/id-map";
import { logger } from "../lib/logger";
import { emptyToNull } from "../lib/validators";
import { getSequelize } from "../lib/db";
import { wrapHtml } from "../lib/html-helpers";
import { DiagnosisInfo } from "../lib/lookup-maps";

const CTX = "phase3/encounter-diagnoses";

interface ImpressionItem {
    template_id: string;
    title: string;
    applied_template: string;
    content: string;
}

function buildImpressionItem(
    diagnosisGuid: string,
    comments: string | null,
    diagnosisLookup: Map<string, DiagnosisInfo>
): ImpressionItem {
    const info = diagnosisLookup.get(diagnosisGuid);
    let title: string;

    if (info) {
        title = info.codes ? `${info.name} (${info.codes})` : info.name;
    } else {
        title = `Unknown Diagnosis (GUID: ${diagnosisGuid})`;
    }

    const contentInner = comments
        ? `<p>${comments}</p>`
        : `<p>No additional comments.</p>`;

    return {
        template_id: "None",
        title,
        applied_template: "None",
        content: wrapHtml(contentInner),
    };
}

/**
 * Links diagnoses to encounters by writing impressions_and_plan into full_note_details.
 * The actual diagnosis data lives in patient_diagnosis_timeline (step 09);
 * this adds the encounter<->diagnosis relationship.
 */
export async function importEncounterDiagnoses(
    encounterMap: IdMap,
    diagnosisLookup: Map<string, DiagnosisInfo>
): Promise<void> {
    logger.info(CTX, "Starting encounter-diagnoses link import...");

    const sequelize = getSequelize();
    const rows = await parseTsvFile(TSV_FILES.patientEncounterDiagnoses);
    logger.info(CTX, `Found ${rows.length} encounter-diagnosis links`);

    // Group by encounter
    const diagByEncounter = new Map<string, { diagnosisGuid: string; comments: string | null }[]>();

    let skipped = 0;
    for (const row of rows) {
        const encounterGuid = row.EncounterGuid;
        if (!encounterGuid || !encounterMap.has(encounterGuid)) {
            skipped++;
            continue;
        }

        if (!diagByEncounter.has(encounterGuid)) {
            diagByEncounter.set(encounterGuid, []);
        }
        diagByEncounter.get(encounterGuid)!.push({
            diagnosisGuid: row.DiagnosisGuid || "",
            comments: emptyToNull(row.Comments),
        });
    }

    logger.info(CTX, `Grouped diagnoses for ${diagByEncounter.size} encounters (${skipped} skipped)`);

    let imported = 0;
    let errored = 0;

    for (const [encounterGuid, diagnoses] of diagByEncounter) {
        const visitId = encounterMap.get(encounterGuid);
        if (!visitId) continue;

        try {
            const impressionsAndPlan: ImpressionItem[] = diagnoses.map((d) =>
                buildImpressionItem(d.diagnosisGuid, d.comments, diagnosisLookup)
            );

            await sequelize.query(
                `UPDATE full_note SET full_note_details = COALESCE(full_note_details::jsonb, '{}'::jsonb) || $1::jsonb, updated_at = NOW()
                 WHERE visit_id = $2 AND is_current = true AND deleted_at IS NULL`,
                { bind: [JSON.stringify({ impressions_and_plan: impressionsAndPlan }), visitId] }
            );
            imported++;
        } catch (err: any) {
            logger.error(CTX, `Encounter ${encounterGuid}: ${err.message}`);
            errored++;
        }
    }

    logger.summary(CTX, { imported, updated: 0, skipped, errored, total: rows.length });
}
