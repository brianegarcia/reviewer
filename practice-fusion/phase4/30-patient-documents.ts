import { TSV_FILES } from "../config";
import { parseTsvFile } from "../lib/tsv-parser";
import { IdMap } from "../lib/id-map";
import { logger } from "../lib/logger";
import { emptyToNull, parseDate } from "../lib/validators";
import { getSequelize } from "../lib/db";
import { resolveDocumentPath, uploadToS3, uploadBatch } from "../lib/s3-upload";

const CTX = "phase4/patient-documents";
const S3_PREFIX = "imports/practice-fusion/patient-docs";
const UPLOAD_CONCURRENCY = 10;

const EXTENSION_TO_MIME: Record<string, string> = {
    ".pdf": "application/pdf",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".tif": "image/tiff",
    ".tiff": "image/tiff",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".txt": "text/plain",
};

/**
 * Uploads patient documents (PDFs, images, etc.) to S3 and creates `attachments` records.
 * TSV columns: PatientPracticeGuid, DocumentName, DocumentType, Status, DocumentStorageGuid,
 *   Comments, FileSizeBytes, OriginalFileExtension, DocumentDate, AssignedProviderGuid,
 *   LastModifiedDateTimeUtc, LastModifiedByUserGuid
 */
export async function importPatientDocuments(
    patientMap: IdMap,
    providerMap: IdMap
): Promise<void> {
    logger.info(CTX, "Starting patient document import...");

    const sequelize = getSequelize();
    const rows = await parseTsvFile(TSV_FILES.patientDocuments);
    logger.info(CTX, `Found ${rows.length} patient document records`);

    // Pre-load existing attachment_ema_ids for idempotency
    const [existingAttachments] = await sequelize.query(
        `SELECT attachment_ema_id FROM attachments WHERE attachment_ema_id IS NOT NULL`
    ) as [any[], unknown];
    const existingDocGuids = new Set(existingAttachments.map((a: any) => a.attachment_ema_id));
    logger.info(CTX, `Found ${existingDocGuids.size} existing attachments`);

    const processable: typeof rows = [];
    let skipped = 0;
    let updated = 0;

    for (const row of rows) {
        const patientGuid = row.PatientPracticeGuid;
        const docGuid = row.DocumentStorageGuid;

        if (!patientGuid || !patientMap.has(patientGuid)) {
            skipped++;
            continue;
        }
        if (!docGuid) {
            skipped++;
            continue;
        }

        if (existingDocGuids.has(docGuid)) {
            updated++;
            continue;
        }

        const ext = emptyToNull(row.OriginalFileExtension) || ".pdf";
        const localPath = resolveDocumentPath(docGuid, ext) || resolveDocumentPath(docGuid);
        if (!localPath) {
            logger.warn(CTX, `File not found for DocumentStorageGuid: ${docGuid}`);
            skipped++;
            continue;
        }

        processable.push(row);
    }

    logger.info(CTX, `${processable.length} documents to upload, ${skipped} skipped`);

    let imported = 0;
    let errored = 0;

    await uploadBatch(processable, UPLOAD_CONCURRENCY, async (row) => {
        const patientGuid = row.PatientPracticeGuid;
        const docGuid = row.DocumentStorageGuid;
        const patientId = patientMap.get(patientGuid);

        const ext = emptyToNull(row.OriginalFileExtension) || ".pdf";
        const normalizedExt = ext.startsWith(".") ? ext : `.${ext}`;
        const localPath = (resolveDocumentPath(docGuid, normalizedExt) || resolveDocumentPath(docGuid))!;
        const mimeType = EXTENSION_TO_MIME[normalizedExt.toLowerCase()] || "application/octet-stream";

        const fileName = emptyToNull(row.DocumentName) || `${docGuid}${normalizedExt}`;
        const fileSize = row.FileSizeBytes ? parseFloat(row.FileSizeBytes) : 0;
        const documentDate = parseDate(row.DocumentDate);
        const providerGuid = emptyToNull(row.AssignedProviderGuid);
        const uploadedBy = providerGuid ? providerMap.get(providerGuid) : null;

        try {
            const s3Key = `${S3_PREFIX}/${docGuid}${normalizedExt}`;
            await uploadToS3(localPath, s3Key, mimeType);

            await sequelize.query(
                `INSERT INTO attachments
                    (file_name, file_path, file_type, file_size, patient_id, uploaded_by, uploaded_at, is_active, attachment_ema_id, created_at, updated_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())`,
                {
                    bind: [
                        fileName,
                        s3Key,
                        mimeType,
                        fileSize,
                        patientId,
                        uploadedBy,
                        documentDate,
                        true,
                        docGuid,
                    ],
                }
            );
            imported++;
        } catch (err: any) {
            logger.error(CTX, `Doc ${docGuid} for patient ${patientGuid}: ${err.message}`);
            errored++;
        }
    });

    logger.summary(CTX, { imported, updated, skipped, errored, total: rows.length });
}
