/**
 * Step 08 – Patient Medications → patient_medications
 *
 * Upsert key: (patient_id, medication_name) — no natural external_id column.
 * FK: patient_id resolved via patient.third_party_id = PatientPracticeGuid
 *
 * Actual schema: id, patient_id, optum_drug_id, medication_name, generic_name,
 *   dose_form, route, dosage, created_by, updated_by, deleted_by,
 *   created_at, updated_at, deleted_at, notes.
 */

import { PipelineContext, StepResult, ValidationError, raw } from "../../../core/types";
import { BasePfStep } from "./base.step";
import { PfMedicationRow } from "../types";
import { emptyToNull } from "../../../shared/validators";
import { sqlLiteral } from "../../../core/sql-builder";
import { getPfExtra } from "../config";

export class MedicationsStep extends BasePfStep {
  readonly name = "08-medications";
  readonly phase = 2;

  async execute(ctx: PipelineContext): Promise<StepResult> {
    const errors: ValidationError[] = [];
    const batchSize = getPfExtra(ctx.config).batchSize;
    let generated = 0;
    let skipped = 0;
    let totalRows = 0;

    await this.loadBatched(ctx, "patientMedications", batchSize, async (batch: PfMedicationRow[]) => {
      for (const row of batch) {
        totalRows++;
        const guid = row.MedicationGuid;
        const patGuid = row.PatientPracticeGuid;
        const name = emptyToNull(row.MedicationName);

        if (!guid || !patGuid || !name) { skipped++; continue; }

        const patIdExpr = `(SELECT id FROM patient WHERE third_party_id = ${sqlLiteral(patGuid)} LIMIT 1)`;

        this.emit(ctx, {
          table: "patient_medications",
          data: {
            patient_id: raw(patIdExpr),
            medication_name: name,
            optum_drug_id: emptyToNull(row.Code),
            created_at: raw("NOW()"),
            updated_at: raw("NOW()"),
          },
          conflictColumns: ["patient_id", "medication_name"],
          updateColumns: ["optum_drug_id", "updated_at"],
          useExistsCheck: true,
          comment: `Medication: ${name} (${guid})`,
        });
        generated++;
      }
    });

    return this.result(totalRows, generated, skipped, errors);
  }
}
