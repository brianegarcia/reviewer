/**
 * Step 01 – Organization
 *
 * Generates a single UPSERT for the importing organisation.
 * Natural key: organization_id (UUID supplied in config).
 */

import { PipelineContext, StepResult, raw } from "../../../core/types";
import { BasePfStep } from "./base.step";

export class OrganizationStep extends BasePfStep {
  readonly name = "01-organization";
  readonly phase = 1;

  async execute(ctx: PipelineContext): Promise<StepResult> {
    const errors: import("../../../core/types").ValidationError[] = [];
    const { organizationId, organizationName } = ctx.config;

    if (!organizationId) {
      errors.push({ step: this.name, rowIndex: 0, field: "organizationId", message: "organizationId is required in config" });
      return this.result(0, 0, 0, errors);
    }

    this.emit(ctx, {
      table: "organizations",
      data: {
        organization_id: organizationId,
        name: organizationName,
        is_ema_lite_enabled: true,
        created_at: raw("NOW()"),
        updated_at: raw("NOW()"),
      },
      conflictColumns: ["organization_id"],
      updateColumns: ["name", "updated_at"],
      useExistsCheck: true,
      comment: `Organization: ${organizationName}`,
    });

    return this.result(1, 1, 0, errors);
  }
}
