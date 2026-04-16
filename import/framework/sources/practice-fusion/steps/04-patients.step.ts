/**
 * Step 04 – Patients → patients
 *
 * Natural key: third_party_id (PatientPracticeGuid)
 * Inactive patients (IsActive = "False") are soft-deleted after upsert.
 *
 * Uses gen_random_uuid() for patient_id on INSERT; ON CONFLICT preserves
 * the existing UUID.
 */

import { PipelineContext, StepResult, ValidationError, raw } from "../../../core/types";
import { BasePfStep } from "./base.step";
import { PfPatientRow } from "../types";
import { emptyToNull, truncate, mapGender, parseDateString, normalizeStr } from "../../../shared/validators";
import { normalizeCountry } from "../../../shared/utils";
import { getPfExtra } from "../config";
import { sqlLiteral } from "../../../core/sql-builder";

/** Calculate current age in years from a YYYY-MM-DD date string. */
function calculateAge(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const birth = new Date(dateStr);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
    age--;
  }
  return age;
}

export class PatientsStep extends BasePfStep {
  readonly name = "04-patients";
  readonly phase = 1;

  async execute(ctx: PipelineContext): Promise<StepResult> {
    const errors: ValidationError[] = [];
    const batchSize = getPfExtra(ctx.config).batchSize;
    const orgId = ctx.config.organizationId;
    const orgIdExpr = `(SELECT id FROM organizations WHERE organization_id = ${sqlLiteral(orgId)} LIMIT 1)`;
    let generated = 0;
    let skipped = 0;
    let totalRows = 0;
    const inactiveGuids: string[] = [];

    await this.loadBatched(ctx, "patientDemographics", batchSize, async (batch: PfPatientRow[], idx) => {
      for (const row of batch) {
        totalRows++;
        const guid = row.PatientPracticeGuid;
        const firstName = emptyToNull(row.FirstName);
        const lastName = emptyToNull(row.LastName);

        if (!guid) {
          errors.push({ step: this.name, rowIndex: totalRows, field: "PatientPracticeGuid", message: "PatientPracticeGuid is required" });
          skipped++;
          continue;
        }

        if (!firstName || !lastName) {
          errors.push({ step: this.name, rowIndex: totalRows, field: "first_name/last_name", message: "Patient must have first and last name", rawValue: guid });
          skipped++;
          continue;
        }

        const isDeceased = !!emptyToNull(row.DeathDate);
        const isActive = row.IsActive !== "False";

        if (!isActive) inactiveGuids.push(guid);

        this.emit(ctx, {
          table: "patient",
          data: {
            third_party_id: guid,
            patient_id: raw("gen_random_uuid()"),
            organization_id: raw(orgIdExpr),
            first_name: truncate(firstName, 100)!,
            last_name: truncate(lastName, 100)!,
            middle_name: emptyToNull(row.MiddleName),
            preferred_name: normalizeStr(row.PreferredName, 100),
            gender: mapGender(row.Gender),
            date_of_birth: parseDateString(row.BirthDate),
            age: row.BirthDate ? calculateAge(parseDateString(row.BirthDate)) : null,
            street_address: emptyToNull(row.Address1),
            city: emptyToNull(row.AddressCity),
            state: emptyToNull(row.AddressState),
            zipcode: emptyToNull(row.AddressZipCode),
            country: normalizeCountry(row.AddressCountry),
            home_phone: normalizeStr(row.HomePhone, 20),
            cellphone: normalizeStr(row.MobilePhone, 20),
            contact_no: normalizeStr(row.OfficePhone, 15),
            email: emptyToNull(row.Email),
            ssn: emptyToNull(row.SSN),
            sticky_note: emptyToNull(row.UnPinnedNote),
            data_source: "local",
            existing_patient: true,
            is_deceased: isDeceased,
            created_at: raw("NOW()"),
            updated_at: raw("NOW()"),
          },
          conflictColumns: ["third_party_id", "organization_id"],
          updateColumns: [
            "first_name", "last_name", "middle_name", "preferred_name",
            "gender", "date_of_birth", "age", "street_address", "city", "state", "zipcode",
            "country", "home_phone", "cellphone", "contact_no", "email",
            "ssn", "sticky_note", "is_deceased", "updated_at",
          ],
          comment: `Patient: ${firstName} ${lastName} (${guid})`,
        });

        // Register GUID for downstream steps
        ctx.lookups.set("patient", guid, guid);
        generated++;
      }
    });

    // Soft-delete inactive patients
    if (inactiveGuids.length > 0) {
      const guidList = inactiveGuids.map((g) => `'${g.replace(/'/g, "''")}'`).join(", ");
      this.emit(ctx, {
        sql: [
          `-- Soft-delete inactive patients (IsActive = False)`,
          `UPDATE patient`,
          `SET deleted_at = NOW(), updated_at = NOW()`,
          `WHERE third_party_id IN (${guidList})`,
          `  AND deleted_at IS NULL;`,
        ].join("\n"),
        comment: `Soft-delete ${inactiveGuids.length} inactive patients`,
      });
    }

    return this.result(totalRows, generated, skipped, errors);
  }
}
