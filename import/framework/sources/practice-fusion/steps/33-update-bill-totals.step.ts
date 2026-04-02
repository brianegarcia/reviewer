/**
 * Step 33 – Update Bill Totals
 *
 * Recalculates total_charges and balance for every bill in this organisation
 * by summing bill_services.total_charge per bill.
 *
 * This step emits a single UPDATE statement – no source file needed.
 * It must run after step 32 (superbill procedures).
 */

import { PipelineContext, StepResult } from "../../../core/types";
import { BasePfStep } from "./base.step";
import { sqlLiteral } from "../../../core/sql-builder";

export class UpdateBillTotalsStep extends BasePfStep {
  readonly name = "33-update-bill-totals";
  readonly phase = 4;

  async execute(ctx: PipelineContext): Promise<StepResult> {
    const orgId = ctx.config.organizationId;

    const orgIdExpr = `(SELECT id FROM organizations WHERE organization_id = ${sqlLiteral(orgId)} LIMIT 1)`;

    this.emit(ctx, {
      sql: [
        `-- Recalculate total_charges and balance for all bills in this org`,
        `UPDATE bills`,
        `SET`,
        `  total_charges = COALESCE(svc.total, 0),`,
        `  balance       = COALESCE(svc.total, 0),`,
        `  updated_at    = NOW()`,
        `FROM (`,
        `  SELECT bill_id, SUM(total_charge) AS total`,
        `  FROM bill_services`,
        `  GROUP BY bill_id`,
        `) AS svc`,
        `WHERE bills.id = svc.bill_id`,
        `  AND bills.organization_id = ${orgIdExpr};`,
      ].join("\n"),
      comment: "Recalculate bill totals for organization",
    });

    return this.result(0, 1, 0, []);
  }
}
