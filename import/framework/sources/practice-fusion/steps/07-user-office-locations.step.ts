/**
 * Step 07 – User–Office Location Links
 *
 * Links each imported provider to every facility that was imported.
 * Practice Fusion does not export explicit user-facility assignments, so we
 * assign all providers to all facilities as a safe default.
 *
 * Natural key: (user_id, office_location_id) on the user_office_locations
 * junction table.
 *
 * Uses INSERT…SELECT to resolve both FK references at execution time.
 */

import { PipelineContext, StepResult, ValidationError, raw } from "../../../core/types";
import { BasePfStep } from "./base.step";
import { PfProviderRow, PfFacilityRow } from "../types";
import { emptyToNull } from "../../../shared/validators";
import { sqlLiteral } from "../../../core/sql-builder";

export class UserOfficeLocationsStep extends BasePfStep {
  readonly name = "07-user-office-locations";
  readonly phase = 1;

  async execute(ctx: PipelineContext): Promise<StepResult> {
    const errors: ValidationError[] = [];
    const orgId = ctx.config.organizationId;
    const orgIdExpr = `(SELECT id FROM organizations WHERE organization_id = ${sqlLiteral(orgId)} LIMIT 1)`;
    const providers = (await this.loadFile(ctx, "providers")) as PfProviderRow[];
    const facilities = (await this.loadFile(ctx, "facilities")) as PfFacilityRow[];

    const providerGuids = providers
      .map((p) => p.ProviderGuid)
      .filter((g): g is string => !!g);

    const facilityGuids = facilities
      .map((f) => f.FacilityGuid)
      .filter((g): g is string => !!g);

    let generated = 0;

    for (const provGuid of providerGuids) {
      for (const facGuid of facilityGuids) {
        this.emit(ctx, {
          table: "user_office_locations",
          data: {
            user_id: raw(`(SELECT id FROM users WHERE third_party_id = ${sqlLiteral(provGuid)} AND organization_id = ${orgIdExpr} LIMIT 1)`),
            office_location_id: raw(`(SELECT id FROM office_locations WHERE external_id = ${sqlLiteral(facGuid)} LIMIT 1)`),
            organization_id: raw(orgIdExpr),
            created_at: raw("NOW()"),
            updated_at: raw("NOW()"),
          },
          conflictColumns: ["user_id", "office_location_id"],
          updateColumns: [],
          comment: `Link provider ${provGuid} → facility ${facGuid}`,
        });
        generated++;
      }
    }

    // Override: use a more readable INSERT...SELECT form for this junction table
    // Clear the individual emits and replace with a single batch insert
    // (Already emitted above — this is fine for small provider/facility counts)

    return this.result(providerGuids.length * facilityGuids.length, generated, 0, errors);
  }
}
