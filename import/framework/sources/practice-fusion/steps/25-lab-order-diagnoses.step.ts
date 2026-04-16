/**
 * Step 25 – Lab Order Item Diagnoses → lab_orders.order_diagnosis
 *
 * Groups diagnosis codes by order, then sets them as a JSONB array on lab_orders.
 */

import { PipelineContext, StepResult, ValidationError } from "../../../core/types";
import { BasePfStep } from "./base.step";
import { PfLabOrderItemDiagnosisRow } from "../types";
import { sqlLiteral } from "../../../core/sql-builder";

export class LabOrderDiagnosesStep extends BasePfStep {
  readonly name = "25-lab-order-diagnoses";
  readonly phase = 3;

  async execute(ctx: PipelineContext): Promise<StepResult> {
    const errors: ValidationError[] = [];
    const rows = (await this.loadFile(ctx, "patientLabOrderItemDiagnoses")) as PfLabOrderItemDiagnosisRow[];

    const byOrder = new Map<string, string[]>();
    let skipped = 0;

    for (const row of rows) {
      const orderGuid = row.OrderGuid;
      const diagGuid = row.DiagnosisGuid;
      if (!orderGuid || !diagGuid) { skipped++; continue; }
      if (!byOrder.has(orderGuid)) byOrder.set(orderGuid, []);
      if (!byOrder.get(orderGuid)!.includes(diagGuid)) {
        byOrder.get(orderGuid)!.push(diagGuid);
      }
    }

    let generated = 0;
    for (const [orderGuid, diagGuids] of byOrder) {
      const diagJson = JSON.stringify(diagGuids).replace(/'/g, "''");

      this.emit(ctx, {
        sql: [
          `-- Order diagnoses for lab order: ${orderGuid}`,
          `UPDATE lab_orders`,
          `SET order_diagnosis = '${diagJson}'::jsonb, updated_at = NOW()`,
          `WHERE external_id = ${sqlLiteral(orderGuid)};`,
        ].join("\n"),
      });
      generated++;
    }

    return this.result(rows.length, generated, skipped, errors);
  }
}
