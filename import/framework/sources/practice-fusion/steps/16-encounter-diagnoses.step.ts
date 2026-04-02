/**
 * Step 16 – Encounter–Diagnosis links → full_note.full_note_details.impressions_and_plan
 *
 * Changes in "fix: general fixes":
 *   - Output changed from encounterDiagnoses (GUID array) to
 *     impressions_and_plan (array of ImpressionItem objects with HTML content).
 *   - Requires a DiagnosisInfo lookup built from patient-diagnoses.tsv.
 *   - Each ImpressionItem: { template_id, title, applied_template, content }
 *     where content is wrapped with wrapHtml().
 *
 * This step reads patient-diagnoses.tsv itself to build the lookup, mirroring
 * the buildDiagnosisLookup() helper in the original lib/lookup-maps.ts.
 */

import { PipelineContext, StepResult, ValidationError } from "../../../core/types";
import { BasePfStep } from "./base.step";
import { PfEncounterDiagnosisRow, PfDiagnosisRow } from "../types";
import { emptyToNull } from "../../../shared/validators";
import { wrapHtml } from "../../../shared/html-helpers";
import { sqlLiteral } from "../../../core/sql-builder";

interface DiagnosisInfo {
  name: string;
  codes: string | null;
}

interface ImpressionItem {
  template_id: string;
  title: string;
  applied_template: string;
  content: string;
}

function buildImpressionItem(
  diagnosisGuid: string,
  comments: string | null,
  lookup: Map<string, DiagnosisInfo>
): ImpressionItem {
  const info = lookup.get(diagnosisGuid);
  let title: string;

  if (info) {
    title = info.codes ? `${info.name} (${info.codes})` : info.name;
  } else {
    title = `Unknown Diagnosis (GUID: ${diagnosisGuid})`;
  }

  const contentInner = comments
    ? `<p>${comments}</p>`
    : `<p>No additional comments.</p>`;

  return {
    template_id: "None",
    title,
    applied_template: "None",
    content: wrapHtml(contentInner),
  };
}

export class EncounterDiagnosesStep extends BasePfStep {
  readonly name = "16-encounter-diagnoses";
  readonly phase = 3;

  async execute(ctx: PipelineContext): Promise<StepResult> {
    const errors: ValidationError[] = [];

    // Build diagnosis lookup from patient-diagnoses.tsv
    // (equivalent to buildDiagnosisLookup() in lib/lookup-maps.ts)
    const diagnosisRows = (await this.loadFile(ctx, "patientDiagnoses")) as PfDiagnosisRow[];
    const diagnosisLookup = new Map<string, DiagnosisInfo>();
    for (const row of diagnosisRows) {
      const guid = row.DiagnosisGuid;
      if (!guid || diagnosisLookup.has(guid)) continue;
      diagnosisLookup.set(guid, {
        name: row.Diagnosis ?? "Unknown Diagnosis",
        codes: emptyToNull(row.DiagnosisCodeEquivalents),
      });
    }
    ctx.logger.info(this.name, `Built diagnosis lookup: ${diagnosisLookup.size} entries`);

    const rows = (await this.loadFile(ctx, "patientEncounterDiagnoses")) as PfEncounterDiagnosisRow[];

    // Group by encounter
    const diagByEnc = new Map<string, { diagnosisGuid: string; comments: string | null }[]>();
    let skipped = 0;

    for (const row of rows) {
      const encGuid = row.EncounterGuid;
      const diagGuid = row.DiagnosisGuid;
      if (!encGuid || !diagGuid) { skipped++; continue; }
      if (!diagByEnc.has(encGuid)) diagByEnc.set(encGuid, []);
      diagByEnc.get(encGuid)!.push({ diagnosisGuid: diagGuid, comments: null });
    }

    let generated = 0;

    for (const [encGuid, diagnoses] of diagByEnc) {
      const visitIdExpr = `(SELECT id FROM patient_visits WHERE third_party_id = ${sqlLiteral(encGuid)} LIMIT 1)`;

      const impressions: ImpressionItem[] = diagnoses.map((d) =>
        buildImpressionItem(d.diagnosisGuid, d.comments, diagnosisLookup)
      );

      // Escape for SQL embedding
      const impressionsJson = JSON.stringify(impressions).replace(/'/g, "''");

      this.emit(ctx, {
        sql: [
          `-- Impressions and plan for encounter: ${encGuid}`,
          `UPDATE full_note`,
          `SET`,
          `  full_note_details = jsonb_set(`,
          `    COALESCE(full_note_details::jsonb, '{}'::jsonb),`,
          `    '{impressions_and_plan}'::text[],`,
          `    '${impressionsJson}'::jsonb,`,
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
