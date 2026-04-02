/**
 * Step 18 – Encounter Observations → full_note.full_note_details.exam (appended)
 *
 * Changes in "fix: general fixes":
 *   - Output changed from physicalExamObservations JSONB array to HTML fragment
 *     appended to the existing exam HTML produced by step 15.
 *   - PhysicalExamObservation: removed `valueType` and `date` fields.
 *   - buildObservationsHtml() produces <ul> list of observation lines.
 *   - If exam already exists in full_note_details, appends inside </section>;
 *     otherwise creates a new exam section with wrapHtml().
 *   - Uses jsonb_set (not ||) so re-runs overwrite rather than corrupt.
 *
 * Since this framework generates SQL offline, the append logic is expressed as
 * a SQL CASE expression using regexp_replace at apply-time.
 */

import { PipelineContext, StepResult, ValidationError } from "../../../core/types";
import { BasePfStep } from "./base.step";
import { PfEncounterObservationRow } from "../types";
import { emptyToNull } from "../../../shared/validators";
import { wrapHtml } from "../../../shared/html-helpers";
import { sqlLiteral } from "../../../core/sql-builder";

interface PhysicalExamObservation {
  code: string;
  codeSystem: string;
  unit: string | null;
  value: string | null;
  comment: string | null;
}

function buildObservationsHtml(observations: PhysicalExamObservation[]): string {
  const items = observations
    .map((o) => {
      let detail = o.code;
      if (o.codeSystem) detail += ` (${o.codeSystem})`;
      if (o.value) {
        detail += ` &mdash; ${o.value}`;
        if (o.unit) detail += ` ${o.unit}`;
      }
      if (o.comment) detail += `; <em>${o.comment}</em>`;
      return `<li>${detail}</li>`;
    })
    .join("");
  return `<p><strong>Physical Exam Observations:</strong></p><ul>${items}</ul>`;
}

export class EncounterObservationsStep extends BasePfStep {
  readonly name = "18-encounter-observations";
  readonly phase = 3;

  async execute(ctx: PipelineContext): Promise<StepResult> {
    const errors: ValidationError[] = [];
    const rows = (await this.loadFile(ctx, "patientEncounterObservations")) as PfEncounterObservationRow[];

    const byEnc = new Map<string, PhysicalExamObservation[]>();
    let skipped = 0;

    for (const row of rows) {
      const encGuid = row.EncounterGuid;
      if (!encGuid) { skipped++; continue; }
      if (!byEnc.has(encGuid)) byEnc.set(encGuid, []);
      byEnc.get(encGuid)!.push({
        code: emptyToNull(row.ObservationCode) ?? "",
        codeSystem: emptyToNull(row.ObservationCodeSystem) ?? "",
        unit: emptyToNull(row.UnitOfObservation),
        value: emptyToNull(row.Value),
        comment: emptyToNull(row.Comment),
      });
    }

    let generated = 0;

    for (const [encGuid, observations] of byEnc) {
      const visitIdExpr = `(SELECT id FROM patient_visits WHERE third_party_id = ${sqlLiteral(encGuid)} LIMIT 1)`;
      const obsFragment = buildObservationsHtml(observations);
      // Escape single quotes for SQL embedding
      const obsFragmentSql = obsFragment.replace(/'/g, "''");
      const wrappedSql = wrapHtml(obsFragment).replace(/'/g, "''");

      // Append inside </section> if exam exists; otherwise create with wrapHtml.
      // regexp_replace trims trailing whitespace before </section> so the append is clean.
      this.emit(ctx, {
        sql: [
          `-- Physical exam observations for encounter: ${encGuid}`,
          `UPDATE full_note`,
          `SET`,
          `  full_note_details = jsonb_set(`,
          `    COALESCE(full_note_details::jsonb, '{}'::jsonb),`,
          `    '{exam}'::text[],`,
          `    CASE`,
          `      WHEN full_note_details->>'exam' IS NOT NULL`,
          `        THEN to_jsonb(regexp_replace(`,
          `          full_note_details->>'exam',`,
          `          '</section>\\s*$',`,
          `          '${obsFragmentSql}</section>'`,
          `        ))`,
          `      ELSE to_jsonb('${wrappedSql}'::text)`,
          `    END,`,
          `    true`,
          `  ),`,
          `  updated_at = NOW()`,
          `WHERE visit_id = ${visitIdExpr}`,
          `  AND is_current = true AND deleted_at IS NULL;`,
        ].join("\n"),
      });
      generated++;
    }

    return this.result(rows.length, generated, skipped, errors);
  }
}
