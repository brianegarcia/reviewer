/**
 * Step 09 – Encounters → patient_visits + full_note (empty shell)
 *
 * Changes in the "fix: general fixes" commit:
 *   - visit_type (string) replaced by visit_type_id (FK to visit_types.id)
 *     The PF ChartNoteType is mapped through CHART_NOTE_TYPE_MAPPING then
 *     resolved to a visit_type_id via a CASE expression inside a subquery.
 *   - FullNote SOAP content (subjective/objective/assessment/plan) is NO LONGER
 *     written here. The application creates an empty full_note via a hook when
 *     patient_visit is inserted. Steps 15–19 then enrich full_note_details.
 *     For the SQL file (which bypasses application hooks) we insert an empty
 *     full_note shell here so that the enrichment UPDATE statements have a row
 *     to target.
 *
 * Natural key for patient_visits: third_party_id (EncounterGuid)
 * Natural key for full_note:      visit_id
 *
 * FK resolution: patient_id, doctor_id, office_location_id, visit_type_id
 * all use subqueries executed at apply-time.
 */

import { PipelineContext, StepResult, ValidationError, raw } from "../../../core/types";
import { BasePfStep } from "./base.step";
import { PfEncounterRow } from "../types";
import { emptyToNull, parseDateString, parseDateTimeString } from "../../../shared/validators";
import { sqlLiteral } from "../../../core/sql-builder";
import { getPfExtra } from "../config";

// Mapping of Practice Fusion ChartNoteType values → SubQDocs visit type names
// Mirrors CHART_NOTE_TYPE_MAPPING in the source's 09-encounters.ts
const CHART_NOTE_TYPE_MAPPING: Record<string, string> = {
  "General Visit": "General",
  "New Patient / Skin Check": "Evaluation of Skin Lesion",
  "Mole / Spot Exam": "Evaluation of Skin Lesion",
  "Follow Up Chief Complaint": "Follow-up Visit",
  "FOLLOW UP CHIEF COMPLAINT": "Follow-up Visit",
  "Rash / Allergy": "Rash",
  "Vitiligo Evaluation": "Discoloration (Vitiligo)",
  "Pigmentation / Melasma": "Discoloration (Hyperigmentation / Melasma)",
  "Skin Cancer Screening": "Skin Cancer Screening (Full Body Skin Exam)",
};

/**
 * Build a SQL CASE expression that resolves a PF ChartNoteType string to a
 * visit_types.id via the mapping table.
 *
 * Falls back to the default visit type (is_default = true) if no match.
 */
function buildVisitTypeIdExpr(chartNoteType: string | null, orgIdExpr: string): string {
  if (!chartNoteType) {
    return `(SELECT id FROM visit_types WHERE organization_id = ${orgIdExpr} AND is_default = true LIMIT 1)`;
  }

  // Resolve through mapping if present; otherwise use the raw value
  const mappedName = CHART_NOTE_TYPE_MAPPING[chartNoteType] ?? chartNoteType;

  return (
    `COALESCE(` +
    `(SELECT id FROM visit_types WHERE organization_id = ${orgIdExpr} AND name = ${sqlLiteral(mappedName)} LIMIT 1),` +
    `(SELECT id FROM visit_types WHERE organization_id = ${orgIdExpr} AND is_default = true LIMIT 1)` +
    `)`
  );
}

export class EncountersStep extends BasePfStep {
  readonly name = "09-encounters";
  readonly phase = 2;

  async execute(ctx: PipelineContext): Promise<StepResult> {
    const errors: ValidationError[] = [];
    const extra = getPfExtra(ctx.config);
    const batchSize = extra.batchSize;
    let generated = 0;
    let skipped = 0;
    let totalRows = 0;

    const orgId = ctx.config.organizationId;
    const orgIdExpr = `(SELECT id FROM organizations WHERE organization_id = ${sqlLiteral(orgId)} LIMIT 1)`;

    await this.loadBatched(ctx, "patientEncounters", batchSize, async (batch: PfEncounterRow[]) => {
      for (const row of batch) {
        totalRows++;
        const encGuid = row.EncounterGuid;
        const patGuid = row.PatientPracticeGuid;

        if (!encGuid || !patGuid) { skipped++; continue; }

        const visitDate = parseDateString(row.DateOfService);
        if (!visitDate) {
          errors.push({
            step: this.name,
            rowIndex: totalRows,
            field: "DateOfService",
            message: `Invalid date: "${row.DateOfService}"`,
            rawValue: encGuid,
          });
          skipped++;
          continue;
        }

        const signedGuid = emptyToNull(row.SignedByProviderGuid);
        const seenGuid = emptyToNull(row.SeenByProviderGuid);
        const provGuid = signedGuid ?? seenGuid;
        const facGuid = emptyToNull(row.FacilityGuid);
        const finalizedAt = parseDateTimeString(row.SignedDateTimeUtc);

        const doctorIdExpr = provGuid
          ? `(SELECT id FROM users WHERE third_party_id = ${sqlLiteral(provGuid)} AND organization_id = ${orgIdExpr} LIMIT 1)`
          : "NULL";

        const facilityIdExpr = facGuid
          ? `(SELECT id FROM office_locations WHERE external_id = ${sqlLiteral(facGuid)} LIMIT 1)`
          : "NULL";

        const visitTypeIdExpr = buildVisitTypeIdExpr(row.ChartNoteType, orgIdExpr);

        // 1. patient_visits upsert — visit_type_id (not visit_type string)
        this.emit(ctx, {
          table: "patient_visits",
          data: {
            third_party_id: encGuid,
            patient_id: raw(`(SELECT id FROM patient WHERE third_party_id = ${sqlLiteral(patGuid)} LIMIT 1)`),
            visit_date: visitDate,
            visit_time: raw(`'${visitDate}T${extra.defaultVisitTime}'::timestamptz`),
            status: "success",
            visit_status: "Finalized",
            doctor_id: raw(doctorIdExpr),
            organization_id: raw(orgIdExpr),
            office_location_id: raw(facilityIdExpr),
            visit_notes: emptyToNull(row.ChiefComplaint),
            visit_type_id: raw(visitTypeIdExpr),
            data_source: "local",
            finalized_at: finalizedAt,
            finalized_by: raw(doctorIdExpr),
            created_at: raw("NOW()"),
            updated_at: raw("NOW()"),
          },
          conflictColumns: ["third_party_id", "organization_id"],
          updateColumns: [
            "visit_date", "visit_time", "status", "visit_status", "doctor_id",
            "office_location_id", "visit_notes", "visit_type_id", "finalized_at",
            "finalized_by", "updated_at",
          ],
          comment: `Encounter: ${encGuid} patient=${patGuid} date=${visitDate}`,
        });

        // 2. full_note shell upsert (empty details — enriched by steps 15–19)
        // NOTE: The application creates this automatically via @AfterCreate hook on
        // PatientVisit. We emit it here so the SQL file is self-contained without
        // requiring the application layer to run first.
        const visitIdExpr = `(SELECT id FROM patient_visits WHERE third_party_id = ${sqlLiteral(encGuid)} LIMIT 1)`;
        const patIdExpr = `(SELECT id FROM patient WHERE third_party_id = ${sqlLiteral(patGuid)} LIMIT 1)`;

        this.emit(ctx, {
          table: "full_note",
          data: {
            patient_id: raw(patIdExpr),
            visit_id: raw(visitIdExpr),
            visit_date: visitDate,
            status: "Success",
            version: 1,
            is_current: true,
            full_note_details: raw(`'{}'::json`),
            created_at: raw("NOW()"),
            updated_at: raw("NOW()"),
          },
          conflictColumns: ["visit_id"],
          updateColumns: [],
          useExistsCheck: true,
          comment: `FullNote shell for encounter: ${encGuid}`,
        });

        ctx.lookups.set("encounter", encGuid, encGuid);
        generated += 2;
      }
    });

    return this.result(totalRows, generated, skipped, errors);
  }
}
