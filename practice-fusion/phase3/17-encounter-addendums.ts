import { TSV_FILES } from "../config";
import { parseTsvFile } from "../lib/tsv-parser";
import { IdMap } from "../lib/id-map";
import { logger } from "../lib/logger";
import { emptyToNull, cleanPfHtml } from "../lib/validators";
import { getSequelize } from "../lib/db";
import { wrapHtml } from "../lib/html-helpers";

const CTX = "phase3/encounter-addendums";

/**
 * Imports encounter addendums (amendments/corrections to signed notes).
 * Stores as addendums array in full_note_details JSON.
 */
export async function importEncounterAddendums(
    encounterMap: IdMap,
    providerMap: IdMap
): Promise<void> {
    logger.info(CTX, "Starting encounter addendums import...");

    const sequelize = getSequelize();
    const rows = await parseTsvFile(TSV_FILES.patientEncounterAddendums);
    logger.info(CTX, `Found ${rows.length} addendum records`);

    // Group by encounter
    const addendumsByEncounter = new Map<string, { text: string; status: string; source: string; providerId: number | null; date: string | null }[]>();

    let skipped = 0;
    for (const row of rows) {
        const encounterGuid = row.EncounterGuid;
        if (!encounterGuid || !encounterMap.has(encounterGuid)) {
            skipped++;
            continue;
        }

        if (!addendumsByEncounter.has(encounterGuid)) {
            addendumsByEncounter.set(encounterGuid, []);
        }
        addendumsByEncounter.get(encounterGuid)!.push({
            text: wrapHtml(`<p>${cleanPfHtml(row.Addendum)}</p>`),
            status: emptyToNull(row.AmendmentStatus) || "Unknown",
            source: emptyToNull(row.AmendmentSource) || "Unknown",
            providerId: providerMap.get(row.LastModifiedByProviderGuid || "") || null,
            date: emptyToNull(row.LastModifiedDateTimeUtc),
        });
    }

    logger.info(CTX, `Grouped addendums for ${addendumsByEncounter.size} encounters`);

    let imported = 0;
    let errored = 0;

    for (const [encounterGuid, addendums] of addendumsByEncounter) {
        const visitId = encounterMap.get(encounterGuid);
        if (!visitId) continue;

        try {
            await sequelize.query(
                `UPDATE full_note SET full_note_details = COALESCE(full_note_details::jsonb, '{}'::jsonb) || $1::jsonb, updated_at = NOW()
                 WHERE visit_id = $2 AND is_current = true AND deleted_at IS NULL`,
                { bind: [JSON.stringify({ addendums }), visitId] }
            );
            imported++;
        } catch (err: any) {
            logger.error(CTX, `Encounter ${encounterGuid}: ${err.message}`);
            errored++;
        }
    }

    logger.summary(CTX, { imported, updated: 0, skipped, errored, total: rows.length });
}
