/**
 * Step 13 – Visit Types (Configuration)
 *
 * Inserts the standard set of visit types used for Practice Fusion encounters.
 * These are configuration records, not patient data.
 *
 * Natural key: (name, organization_id)
 */

import { PipelineContext, StepResult, raw } from "../../../core/types";
import { BasePfStep } from "./base.step";
import { sqlLiteral } from "../../../core/sql-builder";

const VISIT_TYPES: { name: string; color_code: string; default_duration: number; is_default?: boolean }[] = [
  { name: "Office Visit", color_code: "#4A90D9", default_duration: 30, is_default: true },
  { name: "Follow Up", color_code: "#7ED321", default_duration: 20 },
  { name: "New Patient", color_code: "#F5A623", default_duration: 45 },
  { name: "Procedure", color_code: "#9B59B6", default_duration: 60 },
  { name: "Telehealth", color_code: "#1ABC9C", default_duration: 20 },
  { name: "Lab Review", color_code: "#E74C3C", default_duration: 15 },
  { name: "Consultation", color_code: "#2ECC71", default_duration: 30 },
  { name: "Chart Note", color_code: "#95A5A6", default_duration: 15 },
];

export class VisitTypesStep extends BasePfStep {
  readonly name = "13-visit-types";
  readonly phase = 1; // Moved to Phase 1 (needed before encounters insert visit_type_id)

  async execute(ctx: PipelineContext): Promise<StepResult> {
    const orgId = ctx.config.organizationId;
    const orgIdExpr = `(SELECT id FROM organizations WHERE organization_id = ${sqlLiteral(orgId)} LIMIT 1)`;
    let generated = 0;

    for (const vt of VISIT_TYPES) {
      this.emit(ctx, {
        table: "visit_types",
        data: {
          organization_id: raw(orgIdExpr),
          name: vt.name,
          color_code: vt.color_code,
          default_duration: vt.default_duration,
          is_active: true,
          is_default: vt.is_default ?? false,
          created_at: raw("NOW()"),
          updated_at: raw("NOW()"),
        },
        conflictColumns: ["name", "organization_id"],
        updateColumns: ["color_code", "default_duration", "is_default", "updated_at"],
        useExistsCheck: true,
        comment: `Visit type: ${vt.name}`,
      });
      generated++;
    }

    return this.result(VISIT_TYPES.length, generated, 0, []);
  }
}
