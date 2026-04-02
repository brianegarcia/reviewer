/**
 * Step 23 – Pinned Notes → patient_diagnosis_timeline.personal_note
 *
 * Upserts the personal_note column on the existing timeline row.
 * If multiple pinned notes exist for a patient, they are joined with newlines.
 */

import { PipelineContext, StepResult, ValidationError } from "../../../core/types";
import { BasePfStep } from "./base.step";
import { PfPinnedNoteRow } from "../types";
import { emptyToNull } from "../../../shared/validators";
import { sqlLiteral } from "../../../core/sql-builder";

export class PinnedNotesStep extends BasePfStep {
  readonly name = "23-pinned-notes";
  readonly phase = 3;

  async execute(ctx: PipelineContext): Promise<StepResult> {
    const errors: ValidationError[] = [];
    const rows = (await this.loadFile(ctx, "pinnedNotes")) as PfPinnedNoteRow[];

    const byPatient = new Map<string, string[]>();
    let skipped = 0;

    for (const row of rows) {
      const patGuid = row.PatientPracticeGuid;
      const note = emptyToNull(row.NoteText);
      if (!patGuid || !note) { skipped++; continue; }

      if (!byPatient.has(patGuid)) byPatient.set(patGuid, []);
      byPatient.get(patGuid)!.push(note);
    }

    let generated = 0;
    for (const [patGuid, notes] of byPatient) {
      const combinedNote = notes.join("\n");
      const noteJson = JSON.stringify(combinedNote).replace(/'/g, "''");
      const patIdExpr = `(SELECT id FROM patient WHERE third_party_id = ${sqlLiteral(patGuid)} LIMIT 1)`;

      this.emit(ctx, {
        sql: [
          `-- Pinned note for patient: ${patGuid}`,
          `INSERT INTO patient_diagnosis_timeline (patient_id, diagnosis_timeline, alerts, personal_note, created_at, updated_at)`,
          `VALUES (${patIdExpr}, '[]'::json, '[]'::json, '${noteJson}'::json, NOW(), NOW())`,
          `ON CONFLICT (patient_id) DO UPDATE SET`,
          `  personal_note = EXCLUDED.personal_note,`,
          `  updated_at = NOW();`,
        ].join("\n"),
      });
      generated++;
    }

    return this.result(rows.length, generated, skipped, errors);
  }
}
