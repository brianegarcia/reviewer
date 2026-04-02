/**
 * Step 27 – Lab Specimens → lab_order_test_specimen
 *
 * FK: lab_order_id resolved from lab_orders.third_party_id = OrderGuid
 * No unique constraint besides PK – we create one on (lab_order_id, test_order_code) for upsert.
 */

import { PipelineContext, StepResult, ValidationError, raw } from "../../../core/types";
import { BasePfStep } from "./base.step";
import { PfLabSpecimenRow } from "../types";
import { emptyToNull, parseDateString } from "../../../shared/validators";
import { sqlLiteral } from "../../../core/sql-builder";

export class LabSpecimensStep extends BasePfStep {
  readonly name = "27-lab-specimens";
  readonly phase = 4;

  async execute(ctx: PipelineContext): Promise<StepResult> {
    const errors: ValidationError[] = [];
    const rows = (await this.loadFile(ctx, "labOrderItemSpecimens")) as PfLabSpecimenRow[];

    let generated = 0;
    let skipped = 0;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const guid = row.SpecimenGuid;
      const orderGuid = row.OrderGuid;

      if (!guid || !orderGuid) { skipped++; continue; }

      const orderIdExpr = `(SELECT id FROM lab_orders WHERE third_party_id = ${sqlLiteral(orderGuid)} LIMIT 1)`;

      this.emit(ctx, {
        table: "lab_order_test_specimen",
        data: {
          lab_order_id: raw(orderIdExpr),
          test_description: emptyToNull(row.SpecimenType),
          test_order_code: guid,
          specimen_date: parseDateString(row.CollectionDate),
          created_at: raw("NOW()"),
          updated_at: raw("NOW()"),
        },
        conflictColumns: ["lab_order_id", "test_order_code"],
        updateColumns: ["test_description", "specimen_date", "updated_at"],
        useExistsCheck: true,
        comment: `Lab specimen: ${guid} for order ${orderGuid}`,
      });
      generated++;
    }

    return this.result(rows.length, generated, skipped, errors);
  }
}
