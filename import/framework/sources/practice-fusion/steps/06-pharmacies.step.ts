/**
 * Step 06 – Pharmacies → pharmacies + patient preferred pharmacy
 *
 * Upserts pharmacies by PharmacyGuid (external_id).
 * Then sets each patient's preferred_pharmacy_id from preferred-pharmacy.tsv.
 */

import { PipelineContext, StepResult, ValidationError, raw } from "../../../core/types";
import { BasePfStep } from "./base.step";
import { PfPharmacyRow, PfPreferredPharmacyRow } from "../types";
import { emptyToNull, normalizeStr } from "../../../shared/validators";
import { sqlLiteral } from "../../../core/sql-builder";

export class PharmaciesStep extends BasePfStep {
  readonly name = "06-pharmacies";
  readonly phase = 1;

  async execute(ctx: PipelineContext): Promise<StepResult> {
    const errors: ValidationError[] = [];
    const orgId = ctx.config.organizationId;
    const orgIdExpr = `(SELECT id FROM organizations WHERE organization_id = ${sqlLiteral(orgId)} LIMIT 1)`;
    const pharmacyRows = (await this.loadFile(ctx, "pharmacies")) as PfPharmacyRow[];
    const preferredRows = (await this.loadFile(ctx, "preferredPharmacy")) as PfPreferredPharmacyRow[];

    let generated = 0;
    let skipped = 0;

    // Build pharmacy address lookup for patient_pharmacies NOT NULL fields
    const pharmInfo = new Map<string, { name: string; address: string; city: string; state: string; zip: string; phone: string | null }>();
    for (const row of pharmacyRows) {
      if (row.PharmacyGuid && row.PharmacyName) {
        pharmInfo.set(row.PharmacyGuid, {
          name: row.PharmacyName,
          address: emptyToNull(row.Address) ?? "N/A",
          city: emptyToNull(row.City) ?? "N/A",
          state: emptyToNull(row.State) ?? "N/A",
          zip: emptyToNull(row.ZipCode) ?? "N/A",
          phone: emptyToNull(row.Phone),
        });
      }
    }

    // Upsert pharmacies into preferred_pharmacy table
    for (let i = 0; i < pharmacyRows.length; i++) {
      const row = pharmacyRows[i];
      const guid = row.PharmacyGuid;
      const name = emptyToNull(row.PharmacyName);

      if (!guid || !name) { skipped++; continue; }

      this.emit(ctx, {
        table: "preferred_pharmacy",
        data: {
          pharmacy_id: guid,
          organization_id: raw(orgIdExpr),
          pharmacy_name: name,
          is_primary: false,
          created_at: raw("NOW()"),
          updated_at: raw("NOW()"),
        },
        conflictColumns: ["pharmacy_id", "organization_id"],
        updateColumns: ["pharmacy_name", "updated_at"],
        useExistsCheck: true,
        comment: `Pharmacy: ${name} (${guid})`,
      });
      generated++;
    }

    // Insert patient_pharmacies records for preferred pharmacy links
    for (let i = 0; i < preferredRows.length; i++) {
      const row = preferredRows[i];
      const patGuid = row.PatientPracticeGuid;
      const pharmGuid = row.PharmacyGuid;
      if (!patGuid || !pharmGuid) { skipped++; continue; }

      const info = pharmInfo.get(pharmGuid);
      if (!info) { skipped++; continue; }

      this.emit(ctx, {
        sql: [
          `-- Preferred pharmacy for patient ${patGuid}`,
          `UPDATE patient_pharmacies SET is_primary = TRUE, updated_at = NOW()`,
          `WHERE patient_id = (SELECT id FROM patient WHERE third_party_id = ${sqlLiteral(patGuid)} LIMIT 1)`,
          `  AND name = ${sqlLiteral(info.name)};`,
          ``,
          `INSERT INTO patient_pharmacies (patient_id, name, address_line1, city, state, zip, phone, is_primary, created_at, updated_at)`,
          `SELECT p.id, ${sqlLiteral(info.name)}, ${sqlLiteral(info.address)}, ${sqlLiteral(info.city)}, ${sqlLiteral(info.state)}, ${sqlLiteral(info.zip)}, ${sqlLiteral(info.phone)}, TRUE, NOW(), NOW()`,
          `FROM patient p`,
          `WHERE p.third_party_id = ${sqlLiteral(patGuid)}`,
          `  AND NOT EXISTS (`,
          `    SELECT 1 FROM patient_pharmacies pp`,
          `    WHERE pp.patient_id = p.id AND pp.name = ${sqlLiteral(info.name)}`,
          `  );`,
        ].join("\n"),
      });
      generated++;
    }

    return this.result(pharmacyRows.length + preferredRows.length, generated, skipped, errors);
  }
}
