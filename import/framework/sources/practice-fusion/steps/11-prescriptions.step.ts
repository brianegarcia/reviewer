/**
 * Step 11 – Patient Prescriptions → prescriptions
 *
 * Changes in "fix: general fixes":
 *   - Pre-builds a PharmacyGuid → PharmacyName lookup from pharmacies.tsv.
 *   - Stores pharmacy_name (display string) alongside the existing pharmacy_id.
 *   - Removed meta_data column (NDC / generic name).
 *
 * Natural key: third_party_id (PrescriptionGuid)
 * FKs resolved: patient_id, doctor_id
 *
 * Actual schema: id, patient_id, visit_id, doctor_id, organization_id,
 *   drug_fdb_id, drug_name, sig, day_supply, quantity, refill, comments,
 *   pharmacy_id (varchar), pharmacy_name, daw, icd_code, patient_wt,
 *   patient_ht, patient_ht_uom, patient_wt_uom, status, third_party_id,
 *   created_at, updated_at, deleted_at, prescriber_id, identifier,
 *   is_favorite, meta_data (jsonb), controlled_substances (int),
 *   favorite_name, parent_prescription_id, is_default.
 */

import { PipelineContext, StepResult, ValidationError, raw } from "../../../core/types";
import { BasePfStep } from "./base.step";
import { PfPrescriptionRow, PfPharmacyRow } from "../types";
import { emptyToNull } from "../../../shared/validators";
import { sqlLiteral } from "../../../core/sql-builder";
import { getPfExtra } from "../config";

export class PrescriptionsStep extends BasePfStep {
  readonly name = "11-prescriptions";
  readonly phase = 2;

  async execute(ctx: PipelineContext): Promise<StepResult> {
    const errors: ValidationError[] = [];
    const batchSize = getPfExtra(ctx.config).batchSize;
    let generated = 0;
    let skipped = 0;
    let totalRows = 0;

    const orgId = ctx.config.organizationId;
    const orgIdExpr = `(SELECT id FROM organizations WHERE organization_id = ${sqlLiteral(orgId)} LIMIT 1)`;

    // Pre-build PharmacyGuid → PharmacyName lookup from pharmacies.tsv
    const pharmacyRows = (await this.loadFile(ctx, "pharmacies")) as PfPharmacyRow[];
    const pharmacyNameMap = new Map<string, string>();
    for (const row of pharmacyRows) {
      if (row.PharmacyGuid && row.PharmacyName) {
        pharmacyNameMap.set(row.PharmacyGuid, row.PharmacyName);
      }
    }
    ctx.logger.info(this.name, `Loaded ${pharmacyNameMap.size} pharmacy names`);

    await this.loadBatched(ctx, "patientPrescriptions", batchSize, async (batch: PfPrescriptionRow[]) => {
      for (const row of batch) {
        totalRows++;
        const guid = row.PrescriptionGuid;
        const patGuid = row.PatientPracticeGuid;

        if (!guid || !patGuid) { skipped++; continue; }

        const provGuid = emptyToNull(row.ProviderGuid);
        const medName = emptyToNull(row.MedicationName);

        const patIdExpr = `(SELECT id FROM patient WHERE third_party_id = ${sqlLiteral(patGuid)} LIMIT 1)`;
        const doctorIdExpr = provGuid
          ? `(SELECT id FROM users WHERE third_party_id = ${sqlLiteral(provGuid)} AND organization_id = ${orgIdExpr} LIMIT 1)`
          : "NULL";

        const pharmacyGuid = emptyToNull(row.PharmacyGuid);
        const pharmacyName = pharmacyGuid ? (pharmacyNameMap.get(pharmacyGuid) ?? null) : null;

        // Map controlled_substances schedule string to integer (e.g. "II" → 2)
        const csRaw = emptyToNull(row.ControlledSubstanceSchedule);
        const controlledSubstances = csRaw ? (parseInt(csRaw, 10) || null) : null;

        this.emit(ctx, {
          table: "prescriptions",
          data: {
            third_party_id: guid,
            patient_id: raw(patIdExpr),
            doctor_id: raw(doctorIdExpr),
            drug_name: medName,
            sig: emptyToNull(row.Instructions),
            refill: row.RefillsAllowed ? parseInt(row.RefillsAllowed, 10) : null,
            controlled_substances: controlledSubstances,
            comments: emptyToNull(row.NoteToPharmacy),
            pharmacy_id: pharmacyGuid,
            pharmacy_name: pharmacyName,
            status: "active",
            organization_id: raw(orgIdExpr),
            created_at: raw("NOW()"),
            updated_at: raw("NOW()"),
          },
          conflictColumns: ["third_party_id"],
          updateColumns: ["drug_name", "sig", "refill", "pharmacy_name", "comments", "updated_at"],
          useExistsCheck: true,
          comment: `Prescription: ${medName ?? guid} (${guid})`,
        });
        generated++;
      }
    });

    return this.result(totalRows, generated, skipped, errors);
  }
}
