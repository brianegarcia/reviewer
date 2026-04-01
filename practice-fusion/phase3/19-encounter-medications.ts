import { TSV_FILES } from "../config";
import { parseTsvFile } from "../lib/tsv-parser";
import { IdMap } from "../lib/id-map";
import { logger } from "../lib/logger";
import { emptyToNull } from "../lib/validators";
import { getSequelize } from "../lib/db";

const CTX = "phase3/encounter-medications";

/**
 * Links medications to encounters.
 * Enriches full_note_details with encounterMedications array (medication GUIDs per visit).
 * The actual medication data lives in patient_medications (step 07).
 */
export async function importEncounterMedications(encounterMap: IdMap): Promise<void> {
    logger.info(CTX, "Starting encounter-medications link import...");

    const sequelize = getSequelize();
    const rows = await parseTsvFile(TSV_FILES.patientEncounterMedications);
    logger.info(CTX, `Found ${rows.length} encounter-medication links`);

    // Group by encounter
    const medsByEncounter = new Map<string, { medicationGuid: string; comments: string | null }[]>();

    let skipped = 0;
    for (const row of rows) {
        const encounterGuid = row.EncounterGuid;
        if (!encounterGuid || !encounterMap.has(encounterGuid)) {
            skipped++;
            continue;
        }

        if (!medsByEncounter.has(encounterGuid)) {
            medsByEncounter.set(encounterGuid, []);
        }
        medsByEncounter.get(encounterGuid)!.push({
            medicationGuid: row.MedicationGuid || "",
            comments: emptyToNull(row.Comments),
        });
    }

    logger.info(CTX, `Grouped medications for ${medsByEncounter.size} encounters`);

    let imported = 0;
    let errored = 0;

    for (const [encounterGuid, meds] of medsByEncounter) {
        const visitId = encounterMap.get(encounterGuid);
        if (!visitId) continue;

        try {
            await sequelize.query(
                `UPDATE full_note SET full_note_details = COALESCE(full_note_details::jsonb, '{}'::jsonb) || $1::jsonb, updated_at = NOW()
                 WHERE visit_id = $2 AND is_current = true AND deleted_at IS NULL`,
                { bind: [JSON.stringify({ encounterMedications: meds }), visitId] }
            );
            imported++;
        } catch (err: any) {
            logger.error(CTX, `Encounter ${encounterGuid}: ${err.message}`);
            errored++;
        }
    }

    logger.summary(CTX, { imported, updated: 0, skipped, errored, total: rows.length });
}
