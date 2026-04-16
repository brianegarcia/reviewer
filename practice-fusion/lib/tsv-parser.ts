import fs from "fs";
import path from "path";
import readline from "readline";
import { PF_EXPORT_DIR } from "../config";

export interface TsvRow {
    [key: string]: string | null;
}

/**
 * Parse a TSV file from the Practice Fusion export.
 * - Reads line by line (memory efficient for large files)
 * - Converts \N to null
 * - Returns array of objects keyed by header columns
 */
export async function parseTsvFile(fileName: string): Promise<TsvRow[]> {
    const filePath = path.join(PF_EXPORT_DIR, fileName);

    if (!fs.existsSync(filePath)) {
        throw new Error(`TSV file not found: ${filePath}`);
    }

    const rows: TsvRow[] = [];
    let headers: string[] = [];
    let lineNum = 0;

    const fileStream = fs.createReadStream(filePath, { encoding: "utf-8" });
    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

    for await (const line of rl) {
        lineNum++;

        if (lineNum === 1) {
            headers = line.split("\t");
            continue;
        }

        if (line.trim() === "") continue;

        const values = line.split("\t");
        const row: TsvRow = {};

        for (let i = 0; i < headers.length; i++) {
            const val = values[i];
            // \N is Practice Fusion's null representation
            row[headers[i]] = val === "\\N" || val === undefined ? null : val;
        }

        rows.push(row);
    }

    return rows;
}

/**
 * Stream-parse a TSV file, calling the callback for each batch of rows.
 * More memory efficient for very large files.
 */
export async function parseTsvBatched(
    fileName: string,
    batchSize: number,
    onBatch: (batch: TsvRow[], batchIndex: number) => Promise<void>
): Promise<number> {
    const filePath = path.join(PF_EXPORT_DIR, fileName);

    if (!fs.existsSync(filePath)) {
        throw new Error(`TSV file not found: ${filePath}`);
    }

    let headers: string[] = [];
    let lineNum = 0;
    let batch: TsvRow[] = [];
    let batchIndex = 0;
    let totalRows = 0;

    const fileStream = fs.createReadStream(filePath, { encoding: "utf-8" });
    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

    for await (const line of rl) {
        lineNum++;

        if (lineNum === 1) {
            headers = line.split("\t");
            continue;
        }

        if (line.trim() === "") continue;

        const values = line.split("\t");
        const row: TsvRow = {};

        for (let i = 0; i < headers.length; i++) {
            const val = values[i];
            row[headers[i]] = val === "\\N" || val === undefined ? null : val;
        }

        batch.push(row);
        totalRows++;

        if (batch.length >= batchSize) {
            await onBatch(batch, batchIndex);
            batchIndex++;
            batch = [];
        }
    }

    // Process remaining rows
    if (batch.length > 0) {
        await onBatch(batch, batchIndex);
    }

    return totalRows;
}
