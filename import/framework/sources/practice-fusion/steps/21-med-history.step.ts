/**
 * Step 21 – Medical History → patient_medical_history
 *
 * Natural key: (patient_id, entry_text) – deduplicates by content.
 * Groups by patient and emits one INSERT per history entry.
 */

import { PipelineContext, StepResult, ValidationError } from "../../../core/types";
import { BasePfStep } from "./base.step";
import { PfMedHistoryRow } from "../types";
import { emptyToNull, parseDateString } from "../../../shared/validators";
import { sqlLiteral } from "../../../core/sql-builder";
import { getPfExtra } from "../config";

export class MedHistoryStep extends BasePfStep {
  readonly name = "21-med-history";
  readonly phase = 3;

  async execute(ctx: PipelineContext): Promise<StepResult> {
    const errors: ValidationError[] = [];
    const batchSize = getPfExtra(ctx.config).batchSize;
    let skipped = 0;
    let totalRows = 0;

    // Group entries by patient since the actual table stores jsonb per patient
    const byPatient = new Map<string, { entry: string; date: string | null }[]>();

    await this.loadBatched(ctx, "patientMedHistory", batchSize, async (batch: PfMedHistoryRow[]) => {
      for (const row of batch) {
        totalRows++;
        const patGuid = row.PatientPracticeGuid;
        const entry = emptyToNull(row.MedHistoryEntry);

        if (!patGuid || !entry) { skipped++; continue; }

        if (!byPatient.has(patGuid)) byPatient.set(patGuid, []);
        byPatient.get(patGuid)!.push({
          entry,
          date: parseDateString(row.EntryDate),
        });
      }
    });

    let generated = 0;
    for (const [patGuid, entries] of byPatient) {
      const patIdExpr = `(SELECT id FROM patient WHERE third_party_id = ${sqlLiteral(patGuid)} LIMIT 1)`;
      const entriesJson = JSON.stringify(entries).replace(/'/g, "''");

      // Upsert into patient_medical_history; store imported entries in current_conditions jsonb
      this.emit(ctx, {
        sql: [
          `-- Med history for patient: ${patGuid}`,
          `INSERT INTO patient_medical_history (patient_id, current_conditions, created_at, updated_at)`,
          `VALUES (${patIdExpr}, '${entriesJson}'::jsonb, NOW(), NOW())`,
          `ON CONFLICT (patient_id) DO UPDATE SET`,
          `  current_conditions = EXCLUDED.current_conditions,`,
          `  updated_at = NOW();`,
        ].join("\n"),
      });
      generated++;
    }

    return this.result(totalRows, generated, skipped, errors);
  }
}
