/**
 * Step 29 – Lab Order Documents
 *
 * See step 28 for the S3 prerequisite note.
 * lab_order_files has no unique constraint besides PK – reuses the unique
 * index created in step 28 on (lab_orders_id, file_name).
 */

import { PipelineContext, StepResult, ValidationError, raw } from "../../../core/types";
import { BasePfStep } from "./base.step";
import { PfLabOrderDocumentRow } from "../types";
import { emptyToNull } from "../../../shared/validators";
import { sqlLiteral } from "../../../core/sql-builder";

export class LabOrderDocumentsStep extends BasePfStep {
  readonly name = "29-lab-order-documents";
  readonly phase = 4;

  async execute(ctx: PipelineContext): Promise<StepResult> {
    const errors: ValidationError[] = [];
    const rows = (await this.loadFile(ctx, "labOrderDocuments")) as PfLabOrderDocumentRow[];

    let generated = 0;
    let skipped = 0;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const docGuid = row.DocumentGuid;
      const orderGuid = row.OrderGuid;
      const storageGuid = row.DocumentStorageGuid;

      if (!docGuid || !orderGuid) { skipped++; continue; }

      const orderIdExpr = `(SELECT id FROM lab_orders WHERE third_party_id = ${sqlLiteral(orderGuid)} LIMIT 1)`;
      const s3Key = storageGuid
        ? `imports/practice-fusion/lab-orders/${storageGuid}`
        : `imports/practice-fusion/lab-orders/${docGuid}`;
      const fileName = emptyToNull(row.DocumentName) ?? docGuid;

      this.emit(ctx, {
        table: "lab_order_files",
        data: {
          lab_orders_id: raw(orderIdExpr),
          file_name: fileName,
          file_url: s3Key,
          file_type: "lab_order",
          created_at: raw("NOW()"),
          updated_at: raw("NOW()"),
        },
        conflictColumns: ["lab_orders_id", "file_name"],
        updateColumns: ["file_url", "file_type", "updated_at"],
        useExistsCheck: true,
        comment: `Lab order doc: ${docGuid}`,
      });
      generated++;
    }

    return this.result(rows.length, generated, skipped, errors);
  }
}
