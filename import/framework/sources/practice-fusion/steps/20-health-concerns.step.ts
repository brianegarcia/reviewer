/**
 * Step 20 – Health Concerns → patient_diagnosis_timeline.alerts
 *
 * Groups by patient and upserts the alerts JSONB column.
 * Natural key: patient_id (upserts into existing patient_diagnosis_timeline row).
 */

import { PipelineContext, StepResult, ValidationError } from "../../../core/types";
import { BasePfStep } from "./base.step";
import { PfHealthConcernRow } from "../types";
import { emptyToNull, parseDateString } from "../../../shared/validators";
import { sqlLiteral } from "../../../core/sql-builder";

export class HealthConcernsStep extends BasePfStep {
  readonly name = "20-health-concerns";
  readonly phase = 3;

  async execute(ctx: PipelineContext): Promise<StepResult> {
    const errors: ValidationError[] = [];
    const rows = (await this.loadFile(ctx, "patientHealthConcerns")) as PfHealthConcernRow[];

    const byPatient = new Map<string, object[]>();
    let skipped = 0;

    for (const row of rows) {
      const patGuid = row.PatientPracticeGuid;
      if (!patGuid) { skipped++; continue; }

      if (!byPatient.has(patGuid)) byPatient.set(patGuid, []);
      byPatient.get(patGuid)!.push({
        type: emptyToNull(row.HealthConcernType) ?? "note",
        note: emptyToNull(row.HealthConcernNote) ?? "",
        isActive: row.IsActive === "True",
        startDate: parseDateString(row.StartDate),
        diagnosisGuid: emptyToNull(row.DiagnosisGuid),
      });
    }

    let generated = 0;
    for (const [patGuid, concerns] of byPatient) {
      const patIdExpr = `(SELECT id FROM patient WHERE third_party_id = ${sqlLiteral(patGuid)} LIMIT 1)`;
      const alertsJson = JSON.stringify(concerns).replace(/'/g, "''");

      // Upsert: if timeline exists update alerts, else insert fresh row
      this.emit(ctx, {
        sql: [
          `-- Health concerns for patient: ${patGuid}`,
          `INSERT INTO patient_diagnosis_timeline (patient_id, diagnosis_timeline, alerts, created_at, updated_at)`,
          `VALUES (${patIdExpr}, '[]'::jsonb, '${alertsJson}'::jsonb, NOW(), NOW())`,
          `ON CONFLICT (patient_id) DO UPDATE SET`,
          `  alerts = EXCLUDED.alerts,`,
          `  updated_at = NOW();`,
        ].join("\n"),
      });
      generated++;
    }

    return this.result(rows.length, generated, skipped, errors);
  }
}
