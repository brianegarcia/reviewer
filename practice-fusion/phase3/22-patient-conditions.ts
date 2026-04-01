import Condition from "@models/condition.model";
import { TSV_FILES } from "../config";
import { parseTsvFile } from "../lib/tsv-parser";
import { IdMap } from "../lib/id-map";
import { logger } from "../lib/logger";
import { emptyToNull } from "../lib/validators";

const CTX = "phase3/patient-conditions";

/**
 * Imports patient conditions (e.g., "No Known Drug Allergies") from Practice Fusion.
 * Maps to the conditions table.
 */
export async function importPatientConditions(patientMap: IdMap): Promise<void> {
    logger.info(CTX, "Starting patient conditions import...");

    const rows = await parseTsvFile(TSV_FILES.patientConditions);
    logger.info(CTX, `Found ${rows.length} condition records`);

    let imported = 0;
    let skipped = 0;
    let errored = 0;

    for (const row of rows) {
        const patientId = patientMap.get(row.PatientPracticeGuid || "");
        if (!patientId) {
            skipped++;
            continue;
        }

        const conditionName = emptyToNull(row.ConditionName);
        if (!conditionName) {
            skipped++;
            continue;
        }

        try {
            // Check if already exists
            const existing = await Condition.findOne({
                where: { patient_id: String(patientId), value: conditionName },
            });

            if (existing) {
                skipped++;
                continue;
            }

            await Condition.create({
                patient_id: String(patientId),
                code: "PF-CONDITION",
                value: conditionName,
            } as any);

            imported++;
            logger.info(CTX, `Added condition "${conditionName}" for patient ${patientId}`);
        } catch (err: any) {
            logger.error(CTX, `Patient ${patientId} condition "${conditionName}": ${err.message}`);
            errored++;
        }
    }

    logger.summary(CTX, { imported, updated: 0, skipped, errored, total: rows.length });
}
