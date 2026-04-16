/**
 * Step 02 – Facilities → office_locations
 *
 * Natural key: external_id (FacilityGuid)
 * Stores FacilityGuid → external_id mapping in context.lookups["facility"]
 * so downstream steps can resolve facility references.
 */

import { PipelineContext, StepResult, ValidationError, raw } from "../../../core/types";
import { BasePfStep } from "./base.step";
import { PfFacilityRow } from "../types";
import { emptyToNull } from "../../../shared/validators";
import { getPfExtra } from "../config";
import { sqlLiteral } from "../../../core/sql-builder";

export class FacilitiesStep extends BasePfStep {
  readonly name = "02-facilities";
  readonly phase = 1;

  async execute(ctx: PipelineContext): Promise<StepResult> {
    const errors: ValidationError[] = [];
    const extra = getPfExtra(ctx.config);
    const orgId = ctx.config.organizationId;
    const orgIdExpr = `(SELECT id FROM organizations WHERE organization_id = ${sqlLiteral(orgId)} LIMIT 1)`;
    const rows = (await this.loadFile(ctx, "facilities")) as PfFacilityRow[];

    let generated = 0;
    let skipped = 0;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const guid = row.FacilityGuid;
      const name = emptyToNull(row.Name);

      if (!guid) {
        errors.push({ step: this.name, rowIndex: i, field: "FacilityGuid", message: "FacilityGuid is required" });
        skipped++;
        continue;
      }

      if (!name) {
        errors.push({ step: this.name, rowIndex: i, field: "Name", message: "Facility Name is required", rawValue: guid });
        skipped++;
        continue;
      }

      this.emit(ctx, {
        table: "office_locations",
        data: {
          external_id: guid,
          organization_id: raw(orgIdExpr),
          name,
          street_name: emptyToNull(row.Address1),
          city: emptyToNull(row.City),
          state: emptyToNull(row.State),
          postal_code: emptyToNull(row.ZipCode),
          timezone: emptyToNull(row.TimeZone) ?? extra.defaultTimezone,
          primary_office: false,
          created_at: raw("NOW()"),
          updated_at: raw("NOW()"),
        },
        conflictColumns: ["external_id"],
        updateColumns: ["name", "street_name", "city", "state", "postal_code", "timezone", "updated_at"],
        useExistsCheck: true,
        comment: `Facility: ${name} (${guid})`,
      });

      // Register in lookup for downstream steps
      ctx.lookups.set("facility", guid, guid); // guid → external_id (same value)
      generated++;
    }

    return this.result(rows.length, generated, skipped, errors);
  }
}
