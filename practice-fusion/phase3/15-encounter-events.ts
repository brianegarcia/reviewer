import { TSV_FILES, BATCH_SIZE } from "../config";
import { parseTsvBatched } from "../lib/tsv-parser";
import { IdMap } from "../lib/id-map";
import { logger } from "../lib/logger";
import { emptyToNull } from "../lib/validators";
import { getSequelize } from "../lib/db";

const CTX = "phase3/encounter-events";

interface VitalSign {
    code: string;
    name: string;
    value: string;
    units?: string;
    date: string | null;
}

interface EventEntry {
    guid: string;
    name: string;
    description: string;
    category: string;
    status: string;
    value: string | null;
    comments: string | null;
    date: string | null;
    vitalSignCode: string | null;
}

/**
 * Imports encounter events (vitals, procedures, observations) from Practice Fusion.
 * Enriches existing full_note records with vitals and encounter_events data in full_note_details JSON.
 */
export async function importEncounterEvents(
    patientMap: IdMap,
    encounterMap: IdMap
): Promise<void> {
    logger.info(CTX, "Starting encounter events import...");

    // Group events by encounter
    const eventsByEncounter = new Map<string, EventEntry[]>();
    const vitalsByEncounter = new Map<string, VitalSign[]>();

    const stats = { imported: 0, updated: 0, skipped: 0, errored: 0, total: 0 };

    const totalRows = await parseTsvBatched(TSV_FILES.patientEncounterEvents, BATCH_SIZE, async (batch) => {
        for (const row of batch) {
            const encounterGuid = row.EncounterGuid;
            if (!encounterGuid || !encounterMap.has(encounterGuid)) {
                stats.skipped++;
                continue;
            }

            const vitalCode = emptyToNull(row.VitalSignCode);
            const category = emptyToNull(row.EventCategory) || "";
            const value = emptyToNull(row.ResultValue);

            // Separate vitals from other events
            if (vitalCode && value) {
                if (!vitalsByEncounter.has(encounterGuid)) {
                    vitalsByEncounter.set(encounterGuid, []);
                }
                vitalsByEncounter.get(encounterGuid)!.push({
                    code: vitalCode,
                    name: emptyToNull(row.EventName) || vitalCode,
                    value,
                    date: emptyToNull(row.StartDateTimeUtc),
                });
            } else {
                if (!eventsByEncounter.has(encounterGuid)) {
                    eventsByEncounter.set(encounterGuid, []);
                }
                eventsByEncounter.get(encounterGuid)!.push({
                    guid: row.EncounterEventGuid || "",
                    name: emptyToNull(row.EventName) || "",
                    description: emptyToNull(row.EventDescription) || "",
                    category,
                    status: emptyToNull(row.StatusDescription) || "",
                    value,
                    comments: emptyToNull(row.EventComments),
                    date: emptyToNull(row.StartDateTimeUtc),
                    vitalSignCode: vitalCode,
                });
            }
        }
    });

    stats.total = totalRows;
    logger.info(CTX, `Parsed events: ${vitalsByEncounter.size} encounters with vitals, ${eventsByEncounter.size} with other events`);

    // Update full_note_details for each encounter using raw SQL
    // (Sequelize doesn't detect JSON mutations on the same object reference)
    const sequelize = getSequelize();
    const allEncounterGuids = new Set([...vitalsByEncounter.keys(), ...eventsByEncounter.keys()]);

    for (const encounterGuid of allEncounterGuids) {
        const visitId = encounterMap.get(encounterGuid);
        if (!visitId) continue;

        try {
            const vitals = vitalsByEncounter.get(encounterGuid);
            const events = eventsByEncounter.get(encounterGuid);

            let mergeObj: Record<string, any> = {};
            if (vitals && vitals.length > 0) mergeObj.vitals = vitals;
            if (events && events.length > 0) mergeObj.encounterEvents = events;

            await sequelize.query(
                `UPDATE full_note SET full_note_details = COALESCE(full_note_details::jsonb, '{}'::jsonb) || $1::jsonb, updated_at = NOW()
                 WHERE visit_id = $2 AND is_current = true AND deleted_at IS NULL`,
                { bind: [JSON.stringify(mergeObj), visitId] }
            );
            stats.imported++;
        } catch (err: any) {
            logger.error(CTX, `Encounter ${encounterGuid}: ${err.message}`);
            stats.errored++;
        }
    }

    logger.summary(CTX, stats);
}
