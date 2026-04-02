/**
 * Step 26 – Labs Reference Data → labs
 *
 * Upserts lab reference records from labs.tsv.
 * Natural key: external_id (LabGuid)
 *
 * Also backfills lab_orders.lab_id where the lab was referenced by
 * order items (the LabGuid is stored in lab_order_items).
 */

import { PipelineContext, StepResult, ValidationError, raw } from "../../../core/types";
import { BasePfStep } from "./base.step";
import { PfLabRow, PfLabOrderItemRow } from "../types";
import { emptyToNull } from "../../../shared/validators";
import { sqlLiteral } from "../../../core/sql-builder";

export class LabsStep extends BasePfStep {
  readonly name = "26-labs";
  readonly phase = 4;

  async execute(ctx: PipelineContext): Promise<StepResult> {
    const errors: ValidationError[] = [];
    const rows = (await this.loadFile(ctx, "labs")) as PfLabRow[];
    const itemRows = (await this.loadFile(ctx, "patientLabOrderItems")) as PfLabOrderItemRow[];

    let generated = 0;
    let skipped = 0;

    const orgId = ctx.config.organizationId;
    const orgIdExpr = `(SELECT id FROM organizations WHERE organization_id = ${sqlLiteral(orgId)} LIMIT 1)`;

    // Upsert labs
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const guid = row.LabGuid;
      const name = emptyToNull(row.DisplayName) ?? emptyToNull(row.LabName);

      if (!guid || !name) { skipped++; continue; }

      const labCode = emptyToNull(row.CodePrefix) ?? guid;

      this.emit(ctx, {
        table: "labs",
        data: {
          organizationlab: raw(orgIdExpr),
          lab_code: labCode,
          lab_name: emptyToNull(row.LabName) ?? name,
          address_1: emptyToNull(row.Address1),
          address_2: emptyToNull(row.Address2),
          city: emptyToNull(row.City),
          state: emptyToNull(row.State),
          zip: emptyToNull(row.ZipCode),
          created_at: raw("NOW()"),
          updated_at: raw("NOW()"),
        },
        conflictColumns: ["lab_code"],
        updateColumns: ["lab_name", "address_1", "address_2", "city", "state", "zip", "updated_at"],
        useExistsCheck: true,
        comment: `Lab: ${name} (${guid})`,
      });
      generated++;
    }

    // Backfill lab_id on lab_orders from lab_order_items
    // Group: OrderGuid → LabGuid (take first non-null)
    const labByOrder = new Map<string, string>();
    const labGuidToCode = new Map<string, string>();
    for (const row of rows) {
      if (row.LabGuid) {
        labGuidToCode.set(row.LabGuid, emptyToNull(row.CodePrefix) ?? row.LabGuid);
      }
    }
    for (const item of itemRows) {
      if (item.OrderGuid && item.LabGuid && !labByOrder.has(item.OrderGuid)) {
        labByOrder.set(item.OrderGuid, item.LabGuid);
      }
    }

    for (const [orderGuid, labGuid] of labByOrder) {
      const labCode = labGuidToCode.get(labGuid) ?? labGuid;
      this.emit(ctx, {
        sql: [
          `-- Backfill lab_id for order: ${orderGuid}`,
          `UPDATE lab_orders`,
          `SET lab_id = (SELECT id FROM labs WHERE lab_code = ${sqlLiteral(labCode)} LIMIT 1),`,
          `    updated_at = NOW()`,
          `WHERE optum_order_id = ${sqlLiteral(orderGuid)};`,
        ].join("\n"),
      });
      generated++;
    }

    return this.result(rows.length, generated, skipped, errors);
  }
}
