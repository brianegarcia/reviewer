/**
 * Step 24 – Lab Result Notes → lab_orders.comment
 *
 * Appends result notes from patient-lab-result-notes.tsv to lab_orders.comment.
 * Idempotent: always sets the comment to the latest value (replaces, not appends).
 */

import { PipelineContext, StepResult, ValidationError } from "../../../core/types";
import { BasePfStep } from "./base.step";
import { PfLabResultNoteRow } from "../types";
import { emptyToNull } from "../../../shared/validators";
import { sqlLiteral } from "../../../core/sql-builder";

export class LabResultNotesStep extends BasePfStep {
  readonly name = "24-lab-result-notes";
  readonly phase = 3;

  async execute(ctx: PipelineContext): Promise<StepResult> {
    const errors: ValidationError[] = [];
    const rows = (await this.loadFile(ctx, "patientLabResultNotes")) as PfLabResultNoteRow[];

    let generated = 0;
    let skipped = 0;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const orderGuid = row.OrderGuid;
      const note = emptyToNull(row.ResultNote);

      if (!orderGuid || !note) { skipped++; continue; }

      this.emit(ctx, {
        sql: [
          `-- Result note for lab order: ${orderGuid}`,
          `UPDATE lab_orders`,
          `SET comment = ${sqlLiteral(note)}, updated_at = NOW()`,
          `WHERE external_id = ${sqlLiteral(orderGuid)};`,
        ].join("\n"),
      });
      generated++;
    }

    return this.result(rows.length, generated, skipped, errors);
  }
}
