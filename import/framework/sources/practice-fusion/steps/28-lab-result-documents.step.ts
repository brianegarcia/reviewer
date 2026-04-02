/**
 * Step 28 – Lab Result Documents
 *
 * NOTE: Document upload steps (28, 29, 30) require binary files to be
 * uploaded to S3 before the SQL can reference their storage paths.
 *
 * This step generates SQL stubs that:
 *   1. Insert lab_order_files records with placeholder S3 keys.
 *   2. Emit a comment block explaining what must be done manually.
 *
 * For a fully automated run, a separate document-upload phase should be
 * executed BEFORE this SQL file, using the existing s3-upload.ts helpers.
 * The resulting S3 keys should then be patched into the generated SQL.
 *
 * lab_order_files has no unique constraint besides PK – we create one on
 * (lab_orders_id, file_name) for upsert.
 */

import { PipelineContext, StepResult, ValidationError, raw } from "../../../core/types";
import { BasePfStep } from "./base.step";
import { PfLabResultDocumentRow } from "../types";
import { emptyToNull } from "../../../shared/validators";
import { sqlLiteral } from "../../../core/sql-builder";

export class LabResultDocumentsStep extends BasePfStep {
  readonly name = "28-lab-result-documents";
  readonly phase = 4;

  async execute(ctx: PipelineContext): Promise<StepResult> {
    const errors: ValidationError[] = [];
    const rows = (await this.loadFile(ctx, "labResultDocuments")) as PfLabResultDocumentRow[];

    let generated = 0;
    let skipped = 0;

    // Emit a prominent comment explaining the S3 prerequisite
    this.emit(ctx, {
      sql: [
        "-- ============================================================",
        "-- STEP 28: Lab Result Documents",
        "-- ============================================================",
        "-- PREREQUISITE: Binary files must be uploaded to S3 before",
        "-- executing these statements. Replace the placeholder S3 keys",
        "-- below with actual upload paths, or run the document upload",
        "-- script separately and skip this section.",
        "-- ============================================================",
      ].join("\n"),
    });

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const docGuid = row.DocumentGuid;
      const orderGuid = row.OrderGuid;
      const storageGuid = row.DocumentStorageGuid;

      if (!docGuid || !orderGuid) { skipped++; continue; }

      const orderIdExpr = `(SELECT id FROM lab_orders WHERE third_party_id = ${sqlLiteral(orderGuid)} LIMIT 1)`;
      const s3Key = storageGuid
        ? `imports/practice-fusion/lab-results/${storageGuid}`
        : `imports/practice-fusion/lab-results/${docGuid}`;
      const fileName = emptyToNull(row.DocumentName) ?? docGuid;

      this.emit(ctx, {
        table: "lab_order_files",
        data: {
          lab_orders_id: raw(orderIdExpr),
          file_name: fileName,
          file_url: s3Key,
          file_type: "lab_result",
          created_at: raw("NOW()"),
          updated_at: raw("NOW()"),
        },
        conflictColumns: ["lab_orders_id", "file_name"],
        updateColumns: ["file_url", "file_type", "updated_at"],
        useExistsCheck: true,
        comment: `Lab result doc: ${docGuid}`,
      });
      generated++;
    }

    return this.result(rows.length, generated, skipped, errors);
  }
}
