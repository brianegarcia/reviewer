import Condition from "@models/condition.model";
import { TSV_FILES } from "../config";
import { parseTsvFile } from "../lib/tsv-parser";
import { IdMap } from "../lib/id-map";
import { logger } from "../lib/logger";
import { emptyToNull } from "../lib/validators";

const CTX = "phase3/patient-conditions";

/**
 * Extracts the ICD-10 code from a DiagnosisCodeEquivalents string.
 * Format example: "706.1 (ICD9), L70.9 (ICD10), 11381005 (SNOMED)"
 * Falls back to ICD-9, then first available code.
 */
function extractIcdCode(codeEquivalents: string | null): string | null {
    if (!codeEquivalents) return null;

    const icd10Match = codeEquivalents.match(/([\w.]+)\s*\(ICD10\)/);
    if (icd10Match) return icd10Match[1];

    const icd9Match = codeEquivalents.match(/([\w.]+)\s*\(ICD9\)/);
    if (icd9Match) return icd9Match[1];

    const anyMatch = codeEquivalents.match(/([\w.]+)\s*\(/);
    if (anyMatch) return anyMatch[1];

    return null;
}

/**
 * Imports patient conditions from patient-conditions.tsv
 * and patient diagnoses from patient-diagnoses.tsv into the conditions table.
 */
export async function importPatientConditions(patientMap: IdMap): Promise<void> {
    logger.info(CTX, "Starting patient conditions import...");

    let imported = 0;
    let skipped = 0;
    let errored = 0;
    let totalRows = 0;

    // --- Part 1: patient-conditions.tsv (no ICD codes available) ---
    const conditionRows = await parseTsvFile(TSV_FILES.patientConditions);
    totalRows += conditionRows.length;
    logger.info(CTX, `Found ${conditionRows.length} condition records`);

    for (const row of conditionRows) {
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

    // --- Part 2: patient-diagnoses.tsv (has ICD codes) ---
    const diagnosisRows = await parseTsvFile(TSV_FILES.patientDiagnoses);
    totalRows += diagnosisRows.length;
    logger.info(CTX, `Found ${diagnosisRows.length} diagnosis records`);

    for (const row of diagnosisRows) {
        const patientId = patientMap.get(row.PatientPracticeGuid || "");
        if (!patientId) {
            skipped++;
            continue;
        }

        const diagnosisName = emptyToNull(row.Diagnosis);
        if (!diagnosisName) {
            skipped++;
            continue;
        }

        const code = extractIcdCode(emptyToNull(row.DiagnosisCodeEquivalents)) || "PF-DIAGNOSIS";

        try {
            const existing = await Condition.findOne({
                where: { patient_id: String(patientId), code, value: diagnosisName },
            });

            if (existing) {
                skipped++;
                continue;
            }

            await Condition.create({
                patient_id: String(patientId),
                code,
                value: diagnosisName,
            } as any);

            imported++;
            logger.info(CTX, `Added diagnosis "${diagnosisName}" (${code}) for patient ${patientId}`);
        } catch (err: any) {
            logger.error(CTX, `Patient ${patientId} diagnosis "${diagnosisName}": ${err.message}`);
            errored++;
        }
    }

    logger.summary(CTX, { imported, updated: 0, skipped, errored, total: totalRows });
}
