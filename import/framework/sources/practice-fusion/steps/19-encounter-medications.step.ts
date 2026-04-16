/**
 * Step 19 – Encounter Medications → full_note.full_note_details.medications_html
 *
 * Changes in "fix: general fixes":
 *   - Output changed from encounterMedications (GUID array) to
 *     medications_html (HTML string rendered from medication details).
 *   - Requires a MedicationInfo lookup built from patient-medications.tsv.
 *   - buildMedicationsHtml() produces a paragraph per medication with
 *     name, strength, dose form, route, and instructions (sig).
 *   - Entire output wrapped with wrapHtml() for consistent Poppins styling.
 *   - Uses jsonb_set (not ||) so re-runs overwrite rather than corrupt.
 *
 * This step reads patient-medications.tsv itself to build the lookup, mirroring
 * the buildMedicationLookup() helper in the original lib/lookup-maps.ts.
 */

import { PipelineContext, StepResult, ValidationError } from "../../../core/types";
import { BasePfStep } from "./base.step";
import { PfEncounterMedicationRow, PfMedicationRow } from "../types";
import { emptyToNull } from "../../../shared/validators";
import { wrapHtml } from "../../../shared/html-helpers";
import { sqlLiteral } from "../../../core/sql-builder";

interface MedicationInfo {
  name: string;
  strength: string | null;
  doseForm: string | null;
  route: string | null;
  sig: string | null;
}

function buildMedicationsHtml(
  medGuids: string[],
  lookup: Map<string, MedicationInfo>
): string {
  const paragraphs = medGuids
    .map((guid) => {
      const info = lookup.get(guid);
      const name = info?.name ?? "Unknown Medication";
      const strength = info?.strength ?? "Not mentioned";
      const doseForm = info?.doseForm ?? "Not mentioned";
      const route = info?.route ?? "Not mentioned";
      const sig = info?.sig ?? "Not mentioned";

      return `<p>${name} &mdash; Strength: ${strength}, Dose Form: ${doseForm}, Route: ${route}, Instructions: ${sig}</p>`;
    })
    .join("");

  return paragraphs || "<p>No medications found</p>";
}

export class EncounterMedicationsStep extends BasePfStep {
  readonly name = "19-encounter-medications";
  readonly phase = 3;

  async execute(ctx: PipelineContext): Promise<StepResult> {
    const errors: ValidationError[] = [];

    // Build medication lookup from patient-medications.tsv
    // (equivalent to buildMedicationLookup() in lib/lookup-maps.ts)
    const medRows = (await this.loadFile(ctx, "patientMedications")) as PfMedicationRow[];
    const medicationLookup = new Map<string, MedicationInfo>();
    for (const row of medRows) {
      const guid = row.MedicationGuid;
      if (!guid || medicationLookup.has(guid)) continue;
      medicationLookup.set(guid, {
        name: row.MedicationName ?? "Unknown Medication",
        strength: emptyToNull(row.ProductStrength),
        doseForm: emptyToNull(row.DoseForm),
        route: emptyToNull(row.Route),
        sig: emptyToNull(row.Sig),
      });
    }
    ctx.logger.info(this.name, `Built medication lookup: ${medicationLookup.size} entries`);

    const rows = (await this.loadFile(ctx, "patientEncounterMedications")) as PfEncounterMedicationRow[];

    // Group by encounter (deduplicated)
    const byEnc = new Map<string, string[]>();
    let skipped = 0;

    for (const row of rows) {
      const encGuid = row.EncounterGuid;
      const medGuid = row.MedicationGuid;
      if (!encGuid || !medGuid) { skipped++; continue; }
      if (!byEnc.has(encGuid)) byEnc.set(encGuid, []);
      if (!byEnc.get(encGuid)!.includes(medGuid)) {
        byEnc.get(encGuid)!.push(medGuid);
      }
    }

    let generated = 0;

    for (const [encGuid, medGuids] of byEnc) {
      const visitIdExpr = `(SELECT id FROM patient_visits WHERE third_party_id = ${sqlLiteral(encGuid)} LIMIT 1)`;
      const medicationsHtml = wrapHtml(buildMedicationsHtml(medGuids, medicationLookup));
      const medicationsHtmlSql = JSON.stringify(medicationsHtml).replace(/'/g, "''");

      this.emit(ctx, {
        sql: [
          `-- Encounter medications HTML for: ${encGuid}`,
          `UPDATE full_note`,
          `SET`,
          `  full_note_details = jsonb_set(`,
          `    COALESCE(full_note_details::jsonb, '{}'::jsonb),`,
          `    '{medications_html}'::text[],`,
          `    '${medicationsHtmlSql}'::jsonb,`,
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
