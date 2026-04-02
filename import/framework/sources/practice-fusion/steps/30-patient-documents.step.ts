/**
 * Step 30 – Patient Documents → attachments
 *
 * See step 28 for the S3 prerequisite note.
 *
 * Only "active" documents are imported (Status = "Active" or Status = null).
 *
 * attachments has no unique constraint besides PK – we create one on
 * (patient_id, file_name) for upsert.
 */

import { PipelineContext, StepResult, ValidationError, raw } from "../../../core/types";
import { BasePfStep } from "./base.step";
import { PfPatientDocumentRow } from "../types";
import { emptyToNull, parseDateTimeString } from "../../../shared/validators";
import { sqlLiteral } from "../../../core/sql-builder";
import { getPfExtra } from "../config";

const MIME_MAP: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  tif: "image/tiff",
  tiff: "image/tiff",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

function mimeType(ext: string | null): string {
  if (!ext) return "application/octet-stream";
  return MIME_MAP[ext.toLowerCase().replace(/^\./, "")] ?? "application/octet-stream";
}

export class PatientDocumentsStep extends BasePfStep {
  readonly name = "30-patient-documents";
  readonly phase = 4;

  async execute(ctx: PipelineContext): Promise<StepResult> {
    const errors: ValidationError[] = [];
    const batchSize = getPfExtra(ctx.config).batchSize;
    let generated = 0;
    let skipped = 0;
    let totalRows = 0;
    const orgId = ctx.config.organizationId;
    const orgIdExpr = `(SELECT id FROM organizations WHERE organization_id = ${sqlLiteral(orgId)} LIMIT 1)`;

    this.emit(ctx, {
      sql: [
        "-- ============================================================",
        "-- STEP 30: Patient Documents",
        "-- PREREQUISITE: Binary files must be uploaded to S3.",
        "-- Replace placeholder S3 keys with actual upload paths.",
        "-- ============================================================",
      ].join("\n"),
    });

    await this.loadBatched(ctx, "patientDocuments", batchSize, async (batch: PfPatientDocumentRow[]) => {
      for (const row of batch) {
        totalRows++;
        const storageGuid = row.DocumentStorageGuid;
        const patGuid = row.PatientPracticeGuid;

        if (!storageGuid || !patGuid) { skipped++; continue; }

        // Skip deleted documents
        const status = emptyToNull(row.Status);
        if (status && status.toLowerCase() === "deleted") { skipped++; continue; }

        const ext = emptyToNull(row.OriginalFileExtension)?.replace(/^\./, "");
        const fileName = emptyToNull(row.DocumentName) ?? `${storageGuid}${ext ? `.${ext}` : ""}`;
        const s3Key = `imports/practice-fusion/patient-documents/${storageGuid}${ext ? `.${ext}` : ""}`;
        const fileSize = row.FileSizeBytes ? parseInt(row.FileSizeBytes, 10) : null;
        const docDate = parseDateTimeString(row.DocumentDate ?? row.LastModifiedDateTimeUtc);

        const patIdExpr = `(SELECT id FROM patient WHERE third_party_id = ${sqlLiteral(patGuid)} LIMIT 1)`;
        const uploaderExpr = row.AssignedProviderGuid
          ? `(SELECT id FROM users WHERE third_party_id = ${sqlLiteral(row.AssignedProviderGuid)} AND organization_id = ${orgIdExpr} LIMIT 1)`
          : `(SELECT id FROM users WHERE organization_id = ${orgIdExpr} LIMIT 1)`;

        this.emit(ctx, {
          table: "attachments",
          data: {
            patient_id: raw(patIdExpr),
            file_name: fileName,
            file_path: s3Key,
            file_type: mimeType(ext ?? null),
            file_size: fileSize,
            uploaded_by: raw(uploaderExpr),
            uploaded_at: docDate ?? new Date().toISOString(),
            is_active: true,
            created_at: raw("NOW()"),
            updated_at: raw("NOW()"),
          },
          conflictColumns: ["patient_id", "file_name"],
          updateColumns: ["file_path", "file_type", "updated_at"],
          useExistsCheck: true,
          comment: `Patient doc: ${fileName} (${storageGuid})`,
        });
        generated++;
      }
    });

    return this.result(totalRows, generated, skipped, errors);
  }
}
