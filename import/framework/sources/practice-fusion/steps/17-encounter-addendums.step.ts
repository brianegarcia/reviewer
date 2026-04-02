/**
 * Step 17 – Encounter Addendums → full_note.full_note_details.addendums
 *
 * Changes in "fix: general fixes":
 *   - Addendum text now wrapped with wrapHtml(`<p>${cleanPfHtml(...)}</p>`).
 *   - Column names updated: Addendum, AmendmentStatus, AmendmentSource,
 *     LastModifiedByProviderGuid (dropped AddendumType/AddedDate/AddedByProviderGuid).
 *   - Uses jsonb_set (not ||) so re-runs overwrite rather than corrupt.
 */

import { PipelineContext, StepResult, ValidationError } from "../../../core/types";
import { BasePfStep } from "./base.step";
import { PfEncounterAddendumRow } from "../types";
import { emptyToNull, cleanPfHtml } from "../../../shared/validators";
import { wrapHtml } from "../../../shared/html-helpers";
import { sqlLiteral } from "../../../core/sql-builder";

export class EncounterAddendumsStep extends BasePfStep {
  readonly name = "17-encounter-addendums";
  readonly phase = 3;

  async execute(ctx: PipelineContext): Promise<StepResult> {
    const errors: ValidationError[] = [];
    const rows = (await this.loadFile(ctx, "patientEncounterAddendums")) as PfEncounterAddendumRow[];

    const byEnc = new Map<string, object[]>();
    for (const row of rows) {
      const encGuid = row.EncounterGuid;
      if (!encGuid) continue;
      if (!byEnc.has(encGuid)) byEnc.set(encGuid, []);
      byEnc.get(encGuid)!.push({
        text: wrapHtml(`<p>${cleanPfHtml(row.Addendum ?? "")}</p>`),
        status: emptyToNull(row.AmendmentStatus) ?? "Unknown",
        source: emptyToNull(row.AmendmentSource) ?? "Unknown",
        providerGuid: emptyToNull(row.LastModifiedByProviderGuid),
      });
    }

    let generated = 0;
    for (const [encGuid, addendums] of byEnc) {
      const visitIdExpr = `(SELECT id FROM patient_visits WHERE third_party_id = ${sqlLiteral(encGuid)} LIMIT 1)`;
      const addendumsJson = JSON.stringify(addendums).replace(/'/g, "''");

      this.emit(ctx, {
        sql: [
          `-- Addendums for encounter: ${encGuid}`,
          `UPDATE full_note`,
          `SET`,
          `  full_note_details = jsonb_set(`,
          `    COALESCE(full_note_details::jsonb, '{}'::jsonb),`,
          `    '{addendums}'::text[],`,
          `    '${addendumsJson}'::jsonb,`,
          `    true`,
          `  ),`,
          `  updated_at = NOW()`,
          `WHERE visit_id = ${visitIdExpr}`,
          `  AND is_current = true AND deleted_at IS NULL;`,
        ].join("\n"),
      });
      generated++;
    }

    return this.result(rows.length, generated, 0, errors);
  }
}
