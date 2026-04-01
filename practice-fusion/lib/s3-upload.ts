import { S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import fs from "fs";
import path from "path";
import { PF_BINARY_DIR } from "../config";
import { logger } from "./logger";

const CTX = "lib/s3-upload";

let s3Client: S3Client | null = null;

function getS3Client(): S3Client {
    if (s3Client) return s3Client;

    const region = process.env.AWS_S3_REGION;
    const accessKeyId = process.env.AWS_S3_ACCESS_KEY_ID;
    const secretAccessKey = process.env.AWS_S3_SECRET_ACCESS_KEY;

    if (!region || !accessKeyId || !secretAccessKey) {
        throw new Error("Missing AWS S3 credentials in .env (AWS_S3_REGION, AWS_S3_ACCESS_KEY_ID, AWS_S3_SECRET_ACCESS_KEY)");
    }

    s3Client = new S3Client({ region, credentials: { accessKeyId, secretAccessKey } });
    return s3Client;
}

function getBucket(): string {
    const bucket = process.env.AWS_S3_BUCKET;
    if (!bucket) throw new Error("Missing AWS_S3_BUCKET in .env");
    return bucket;
}

/**
 * Resolve a DocumentStorageGuid to a local file path.
 * Tries {guid}.pdf first, then {guid} without extension.
 */
export function resolveDocumentPath(documentStorageGuid: string, extension = ".pdf"): string | null {
    const withExt = path.join(PF_BINARY_DIR, `${documentStorageGuid}${extension}`);
    if (fs.existsSync(withExt)) return withExt;

    const withoutExt = path.join(PF_BINARY_DIR, documentStorageGuid);
    if (fs.existsSync(withoutExt)) return withoutExt;

    return null;
}

/**
 * Upload a local file to S3 and return the S3 key.
 */
export async function uploadToS3(
    localPath: string,
    s3Key: string,
    contentType: string = "application/pdf"
): Promise<{ key: string; size: number }> {
    const client = getS3Client();
    const bucket = getBucket();
    const fileBuffer = fs.readFileSync(localPath);
    const stat = fs.statSync(localPath);

    const upload = new Upload({
        client,
        params: {
            Bucket: bucket,
            Key: s3Key,
            Body: fileBuffer,
            ContentType: contentType,
        },
    });

    await upload.done();

    return { key: s3Key, size: stat.size };
}

/**
 * Process uploads with concurrency limit.
 */
export async function uploadBatch<T>(
    items: T[],
    concurrency: number,
    processor: (item: T) => Promise<void>
): Promise<void> {
    for (let i = 0; i < items.length; i += concurrency) {
        const batch = items.slice(i, i + concurrency);
        await Promise.all(batch.map(processor));
        if (i + concurrency < items.length) {
            logger.info(CTX, `Uploaded ${Math.min(i + concurrency, items.length)}/${items.length} files...`);
        }
    }
}
