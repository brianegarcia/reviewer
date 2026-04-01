import { TSV_FILES } from "../config";
import { parseTsvFile } from "../lib/tsv-parser";
import { IdMap } from "../lib/id-map";
import { logger } from "../lib/logger";
import { emptyToNull } from "../lib/validators";
import { getSequelize } from "../lib/db";

const CTX = "phase3/encounter-diagnoses";

interface EncounterDiagnosisLink {
    diagnosisGuid: string;
    comments: string | null;
}

/**
 * Links diagnoses to encounters by enriching full_note_details with diagnosis GUIDs.
 * The actual diagnosis data lives in patient_diagnosis_timeline (step 09);
 * this adds the encounter<->diagnosis relationship.
 */
export async function importEncounterDiagnoses(encounterMap: IdMap): Promise<void> {
    logger.info(CTX, "Starting encounter-diagnoses link import...");

    const sequelize = getSequelize();
    const rows = await parseTsvFile(TSV_FILES.patientEncounterDiagnoses);
    logger.info(CTX, `Found ${rows.length} encounter-diagnosis links`);

    // Group by encounter
    const diagByEncounter = new Map<string, EncounterDiagnosisLink[]>();

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
            await sequelize.query(
                `UPDATE full_note SET full_note_details = COALESCE(full_note_details::jsonb, '{}'::jsonb) || $1::jsonb, updated_at = NOW()
                 WHERE visit_id = $2 AND is_current = true AND deleted_at IS NULL`,
                { bind: [JSON.stringify({ encounterDiagnoses: diagnoses }), visitId] }
            );
            imported++;
        } catch (err: any) {
            logger.error(CTX, `Encounter ${encounterGuid}: ${err.message}`);
            errored++;
        }
    }

    logger.summary(CTX, { imported, updated: 0, skipped, errored, total: rows.length });
}
