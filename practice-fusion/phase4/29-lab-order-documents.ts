import { TSV_FILES } from "../config";
import { parseTsvFile } from "../lib/tsv-parser";
import { IdMap } from "../lib/id-map";
import { logger } from "../lib/logger";
import { emptyToNull } from "../lib/validators";
import { getSequelize } from "../lib/db";
import { resolveDocumentPath, uploadToS3, uploadBatch } from "../lib/s3-upload";

const CTX = "phase4/lab-order-documents";
const S3_PREFIX = "imports/practice-fusion/lab-orders";
const UPLOAD_CONCURRENCY = 10;

/**
 * Uploads lab order PDFs to S3 and creates `lab_order_files` records.
 * TSV columns: PatientPracticeGuid, OrderGuid, DocumentStorageGuid, DocumentType,
 *   LastModifiedByProfileGuid, LastModifiedDateTimeUtc
 */
export async function importLabOrderDocuments(labOrderMap: IdMap): Promise<void> {
    logger.info(CTX, "Starting lab order document import...");

    const sequelize = getSequelize();
    const rows = await parseTsvFile(TSV_FILES.labOrderDocuments);
    logger.info(CTX, `Found ${rows.length} lab order document records`);

    // Pre-load existing file URLs for idempotency
    const [existingFiles] = await sequelize.query(
        `SELECT file_url FROM lab_order_files`
    ) as [any[], unknown];
    const existingUrls = new Set(existingFiles.map((f: any) => f.file_url));
    logger.info(CTX, `Found ${existingUrls.size} existing lab order files`);

    const processable: typeof rows = [];
    let skipped = 0;
    let updated = 0;

    for (const row of rows) {
        const orderGuid = row.OrderGuid;
        const docGuid = row.DocumentStorageGuid;

        if (!orderGuid || !labOrderMap.has(orderGuid)) {
            skipped++;
            continue;
        }
        if (!docGuid) {
            skipped++;
            continue;
        }

        const localPath = resolveDocumentPath(docGuid);
        if (!localPath) {
            logger.warn(CTX, `PDF not found for DocumentStorageGuid: ${docGuid}`);
            skipped++;
            continue;
        }

        const s3Key = `${S3_PREFIX}/${docGuid}.pdf`;
        if (existingUrls.has(s3Key)) {
            updated++;
            continue;
        }

        processable.push(row);
    }

    logger.info(CTX, `${processable.length} documents to upload, ${skipped} skipped, ${updated} already exist`);

    let imported = 0;
    let errored = 0;

    await uploadBatch(processable, UPLOAD_CONCURRENCY, async (row) => {
        const orderGuid = row.OrderGuid;
        const docGuid = row.DocumentStorageGuid;
        const labOrderId = labOrderMap.get(orderGuid);
        const localPath = resolveDocumentPath(docGuid)!;
        const docType = emptyToNull(row.DocumentType) || "Lab Order Document";

        try {
            const s3Key = `${S3_PREFIX}/${docGuid}.pdf`;
            const { size } = await uploadToS3(localPath, s3Key);

            await sequelize.query(
                `INSERT INTO lab_order_files (lab_orders_id, file_name, file_url, file_type, file_size, description, created_at, updated_at)
                 VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())`,
                {
                    bind: [
                        labOrderId,
                        `${docGuid}.pdf`,
                        s3Key,
                        "application/pdf",
                        size,
                        docType,
                    ],
                }
            );
            imported++;
        } catch (err: any) {
            logger.error(CTX, `Doc ${docGuid} for order ${orderGuid}: ${err.message}`);
            errored++;
        }
    });

    logger.summary(CTX, { imported, updated, skipped, errored, total: rows.length });
}
