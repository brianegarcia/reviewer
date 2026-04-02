/**
 * Step 22 – Patient Conditions → patient_conditions
 *
 * Changes in "fix: patient conditions":
 *   - Added extractIcdCode() helper to parse ICD-10 (falling back to ICD-9,
 *     then first available code) from DiagnosisCodeEquivalents strings.
 *   - Now imports from two sources:
 *       Part 1: patient-conditions.tsv — no ICD code; existing behaviour.
 *       Part 2: patient-diagnoses.tsv  — includes ICD code; natural key is
 *                                        (patient_id, code, condition_name).
 *
 * Natural keys:
 *   - Conditions:  (patient_id, condition_name)
 *   - Diagnoses:   (patient_id, code, condition_name)
 */

import { PipelineContext, StepResult, ValidationError, raw } from "../../../core/types";
import { BasePfStep } from "./base.step";
import { PfPatientConditionRow, PfDiagnosisRow } from "../types";
import { emptyToNull, parseDateString } from "../../../shared/validators";
import { sqlLiteral } from "../../../core/sql-builder";
import { getPfExtra } from "../config";

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

export class PatientConditionsStep extends BasePfStep {
  readonly name = "22-patient-conditions";
  readonly phase = 3;

  async execute(ctx: PipelineContext): Promise<StepResult> {
    const errors: ValidationError[] = [];
    const batchSize = getPfExtra(ctx.config).batchSize;
    let generated = 0;
    let skipped = 0;
    let totalRows = 0;

    // --- Part 1: patient-conditions.tsv (no ICD codes available) ---
    await this.loadBatched(ctx, "patientConditions", batchSize, async (batch: PfPatientConditionRow[]) => {
      for (const row of batch) {
        totalRows++;
        const patGuid = row.PatientPracticeGuid;
        const name = emptyToNull(row.ConditionName);

        if (!patGuid || !name) { skipped++; continue; }

        const patIdExpr = `(SELECT id FROM patient WHERE third_party_id = ${sqlLiteral(patGuid)} LIMIT 1)`;

        this.emit(ctx, {
          table: "conditions",
          data: {
            patient_id: raw(patIdExpr),
            code: "PF-CONDITION",
            value: name,
            "\"createdAt\"": raw("NOW()"),
            "\"updatedAt\"": raw("NOW()"),
          },
          conflictColumns: ["patient_id", "code", "value"],
          updateColumns: ["\"updatedAt\""],
          useExistsCheck: true,
          comment: `Condition "${name}" for patient ${patGuid}`,
        });
        generated++;
      }
    });

    // --- Part 2: patient-diagnoses.tsv (has ICD codes) ---
    const diagnosisRows = (await this.loadFile(ctx, "patientDiagnoses")) as PfDiagnosisRow[];
    totalRows += diagnosisRows.length;
    ctx.logger.info(this.name, `Found ${diagnosisRows.length} diagnosis records`);

    for (const row of diagnosisRows) {
      const patGuid = row.PatientPracticeGuid;
      const diagnosisName = emptyToNull(row.Diagnosis);

      if (!patGuid || !diagnosisName) { skipped++; continue; }

      const code = extractIcdCode(emptyToNull(row.DiagnosisCodeEquivalents)) ?? "PF-DIAGNOSIS";
      const patIdExpr = `(SELECT id FROM patient WHERE third_party_id = ${sqlLiteral(patGuid)} LIMIT 1)`;

      this.emit(ctx, {
        table: "conditions",
        data: {
          patient_id: raw(patIdExpr),
          code,
          value: diagnosisName,
          "\"createdAt\"": raw("NOW()"),
          "\"updatedAt\"": raw("NOW()"),
        },
        conflictColumns: ["patient_id", "code", "value"],
        updateColumns: [],
        useExistsCheck: true,
        comment: `Diagnosis "${diagnosisName}" (${code}) for patient ${patGuid}`,
      });
      generated++;
    }

    return this.result(totalRows, generated, skipped, errors);
  }
}
