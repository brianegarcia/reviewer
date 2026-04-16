import { TSV_FILES } from "../config";
import { parseTsvFile } from "../lib/tsv-parser";
import { IdMap } from "../lib/id-map";
import { logger } from "../lib/logger";
import { emptyToNull } from "../lib/validators";
import { getSequelize } from "../lib/db";
import { wrapHtml } from "../lib/html-helpers";
import { MedicationInfo } from "../lib/lookup-maps";

const CTX = "phase3/encounter-medications";

function buildMedicationsHtml(
    meds: { medicationGuid: string; comments: string | null }[],
    medicationLookup: Map<string, MedicationInfo>
): string {
    const paragraphs = meds
        .map((m) => {
            const info = medicationLookup.get(m.medicationGuid);
            const name = info?.name || "Unknown Medication";
            const strength = info?.strength || "Not mentioned";
            const doseForm = info?.doseForm || "Not mentioned";
            const route = info?.route || "Not mentioned";
            const sig = info?.sig || "Not mentioned";

            let line = `${name} &mdash; Strength: ${strength}, Dose Form: ${doseForm}, Route: ${route}, Instructions: ${sig}`;
            if (m.comments) line += `<br/><em>${m.comments}</em>`;
            return `<p>${line}</p>`;
        })
        .join("");

    return paragraphs || "<p>No medications found</p>";
}

/**
 * Links medications to encounters.
 * Writes medications_html into full_note_details.
 * The actual medication data lives in patient_medications (step 07).
 */
export async function importEncounterMedications(
    encounterMap: IdMap,
    medicationLookup: Map<string, MedicationInfo>
): Promise<void> {
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
            const medicationsHtml = wrapHtml(buildMedicationsHtml(meds, medicationLookup));

            await sequelize.query(
                `UPDATE full_note SET full_note_details = COALESCE(full_note_details::jsonb, '{}'::jsonb) || $1::jsonb, updated_at = NOW()
                 WHERE visit_id = $2 AND is_current = true AND deleted_at IS NULL`,
                { bind: [JSON.stringify({ medications_html: medicationsHtml }), visitId] }
            );
            imported++;
        } catch (err: any) {
            logger.error(CTX, `Encounter ${encounterGuid}: ${err.message}`);
            errored++;
        }
    }

    logger.summary(CTX, { imported, updated: 0, skipped, errored, total: rows.length });
}
