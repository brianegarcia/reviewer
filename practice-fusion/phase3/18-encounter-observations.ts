import { TSV_FILES } from "../config";
import { parseTsvFile } from "../lib/tsv-parser";
import { IdMap } from "../lib/id-map";
import { logger } from "../lib/logger";
import { emptyToNull } from "../lib/validators";
import { getSequelize } from "../lib/db";

const CTX = "phase3/encounter-observations";

interface PhysicalExamObservation {
    codeSystem: string;
    code: string;
    unit: string | null;
    valueType: string;
    value: string | null;
    comment: string | null;
    date: string | null;
}

/**
 * Imports physical exam observations per encounter.
 * Enriches full_note_details with physicalExamObservations array.
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
            valueType: emptyToNull(row.ValueType) || "",
            value: emptyToNull(row.Value),
            comment: emptyToNull(row.Comment),
            date: emptyToNull(row.ObservationDateTimeUtc),
        });
    }

    logger.info(CTX, `Grouped observations for ${obsByEncounter.size} encounters`);

    let imported = 0;
    let errored = 0;

    for (const [encounterGuid, observations] of obsByEncounter) {
        const visitId = encounterMap.get(encounterGuid);
        if (!visitId) continue;

        try {
            await sequelize.query(
                `UPDATE full_note SET full_note_details = COALESCE(full_note_details::jsonb, '{}'::jsonb) || $1::jsonb, updated_at = NOW()
                 WHERE visit_id = $2 AND is_current = true AND deleted_at IS NULL`,
                { bind: [JSON.stringify({ physicalExamObservations: observations }), visitId] }
            );
            imported++;
        } catch (err: any) {
            logger.error(CTX, `Encounter ${encounterGuid}: ${err.message}`);
            errored++;
        }
    }

    logger.summary(CTX, { imported, updated: 0, skipped, errored, total: rows.length });
}
