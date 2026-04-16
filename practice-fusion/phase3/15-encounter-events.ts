import { TSV_FILES, BATCH_SIZE } from "../config";
import { parseTsvBatched } from "../lib/tsv-parser";
import { IdMap } from "../lib/id-map";
import { logger } from "../lib/logger";
import { emptyToNull } from "../lib/validators";
import { getSequelize } from "../lib/db";
import { wrapHtml } from "../lib/html-helpers";

const CTX = "phase3/encounter-events";

interface VitalSign {
    name: string;
    value: string;
    date: string | null;
}

interface EventEntry {
    name: string;
    description: string;
    category: string;
    status: string;
    value: string | null;
    comments: string | null;
    date: string | null;
}

function buildVitalsHtml(vitals: VitalSign[]): string {
    const items = vitals
        .map((v) => `<li><strong>${v.name}:</strong> ${v.value}</li>`)
        .join("");
    return `<p><strong>Vitals:</strong></p><ul>${items}</ul>`;
}

function buildEventsHtml(events: EventEntry[]): string {
    const items = events
        .map((e) => {
            let detail = e.name;
            if (e.description) detail += ` &mdash; ${e.description}`;
            const meta: string[] = [];
            if (e.category) meta.push(`Category: ${e.category}`);
            if (e.status) meta.push(`Status: ${e.status}`);
            if (e.value) meta.push(`Value: ${e.value}`);
            if (meta.length > 0) detail += ` (${meta.join(", ")})`;
            if (e.comments) detail += `<br/><em>${e.comments}</em>`;
            return `<li>${detail}</li>`;
        })
        .join("");
    return `<p><strong>Encounter Events:</strong></p><ul>${items}</ul>`;
}

/**
 * Imports encounter events (vitals, procedures, observations) from Practice Fusion.
 * Writes exam HTML into full_note_details.exam.
 */
export async function importEncounterEvents(
    _patientMap: IdMap,
    encounterMap: IdMap
): Promise<void> {
    logger.info(CTX, "Starting encounter events import...");

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
            const value = emptyToNull(row.ResultValue);

            if (vitalCode && value) {
                if (!vitalsByEncounter.has(encounterGuid)) {
                    vitalsByEncounter.set(encounterGuid, []);
                }
                vitalsByEncounter.get(encounterGuid)!.push({
                    name: emptyToNull(row.EventName) || vitalCode,
                    value,
                    date: emptyToNull(row.StartDateTimeUtc),
                });
            } else {
                if (!eventsByEncounter.has(encounterGuid)) {
                    eventsByEncounter.set(encounterGuid, []);
                }
                eventsByEncounter.get(encounterGuid)!.push({
                    name: emptyToNull(row.EventName) || "",
                    description: emptyToNull(row.EventDescription) || "",
                    category: emptyToNull(row.EventCategory) || "",
                    status: emptyToNull(row.StatusDescription) || "",
                    value,
                    comments: emptyToNull(row.EventComments),
                    date: emptyToNull(row.StartDateTimeUtc),
                });
            }
        }
    });

    stats.total = totalRows;
    logger.info(CTX, `Parsed events: ${vitalsByEncounter.size} encounters with vitals, ${eventsByEncounter.size} with other events`);

    const sequelize = getSequelize();
    const allEncounterGuids = new Set([...vitalsByEncounter.keys(), ...eventsByEncounter.keys()]);

    for (const encounterGuid of allEncounterGuids) {
        const visitId = encounterMap.get(encounterGuid);
        if (!visitId) continue;

        try {
            const vitals = vitalsByEncounter.get(encounterGuid);
            const events = eventsByEncounter.get(encounterGuid);

            let innerHtml = "";
            if (vitals && vitals.length > 0) innerHtml += buildVitalsHtml(vitals);
            if (events && events.length > 0) innerHtml += buildEventsHtml(events);

            const examHtml = wrapHtml(innerHtml);

            await sequelize.query(
                `UPDATE full_note SET full_note_details = COALESCE(full_note_details::jsonb, '{}'::jsonb) || $1::jsonb, updated_at = NOW()
                 WHERE visit_id = $2 AND is_current = true AND deleted_at IS NULL`,
                { bind: [JSON.stringify({ exam: examHtml }), visitId] }
            );
            stats.imported++;
        } catch (err: any) {
            logger.error(CTX, `Encounter ${encounterGuid}: ${err.message}`);
            stats.errored++;
        }
    }

    logger.summary(CTX, stats);
}
