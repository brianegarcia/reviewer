/**
 * TSV / delimited file parser for source export files.
 *
 * Supports:
 *   - Tab-separated (Practice Fusion default)
 *   - Configurable delimiter for other sources
 *   - Practice Fusion null sentinel: \N → null
 *   - Streaming / batch processing to avoid loading huge files in memory
 */

import fs from "fs";
import readline from "readline";
import path from "path";
import { SourceRow } from "../core/types";
import { SourceFileError } from "../core/errors";

export { SourceRow };

export interface ParseOptions {
  /** Column delimiter – defaults to TAB */
  delimiter?: string;
  /** Sentinel value to convert to null – defaults to "\\N" (Practice Fusion) */
  nullSentinel?: string;
}

const DEFAULT_OPTS: Required<ParseOptions> = {
  delimiter: "\t",
  nullSentinel: "\\N",
};

// ─── Synchronous full-file parse ──────────────────────────────────────────────

/**
 * Parse an entire delimited file into memory.
 * Suitable for small-to-medium files (facilities, providers, pharmacies, etc.).
 */
export async function parseFile(
  filePath: string,
  opts?: ParseOptions
): Promise<SourceRow[]> {
  const rows: SourceRow[] = [];
  await parseBatched(filePath, Infinity, async (batch) => { rows.push(...batch); }, opts);
  return rows;
}

// ─── Streaming batched parse ──────────────────────────────────────────────────

/**
 * Stream a delimited file in batches to avoid loading everything into memory.
 * Suitable for large files (patients, encounters, lab orders, etc.).
 *
 * @param filePath  Absolute path to the source file.
 * @param batchSize Number of data rows per batch callback invocation.
 * @param onBatch   Async callback called with each batch + the batch index.
 * @returns         Total number of data rows read.
 */
export async function parseBatched(
  filePath: string,
  batchSize: number,
  onBatch: (batch: SourceRow[], batchIndex: number) => Promise<void>,
  opts?: ParseOptions
): Promise<number> {
  const { delimiter, nullSentinel } = { ...DEFAULT_OPTS, ...opts };

  if (!fs.existsSync(filePath)) {
    throw new SourceFileError(filePath);
  }

  return new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath, { encoding: "utf8" });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    let headers: string[] = [];
    let batch: SourceRow[] = [];
    let totalRows = 0;
    let batchIndex = 0;
    let headerParsed = false;
    const pendingBatches: Array<() => Promise<void>> = [];

    // Process lines sequentially via a promise chain to honour backpressure
    let chain = Promise.resolve();

    rl.on("line", (line) => {
      if (!headerParsed) {
        headers = splitLine(line, delimiter);
        headerParsed = true;
        return;
      }

      const cells = splitLine(line, delimiter);
      const row: SourceRow = {};
      for (let i = 0; i < headers.length; i++) {
        const raw = cells[i] ?? null;
        row[headers[i]] = raw === nullSentinel ? null : raw;
      }

      batch.push(row);
      totalRows++;

      if (batch.length >= batchSize) {
        const currentBatch = batch;
        const currentIndex = batchIndex;
        batch = [];
        batchIndex++;

        chain = chain.then(() => onBatch(currentBatch, currentIndex));
      }
    });

    rl.on("close", () => {
      if (batch.length > 0) {
        chain = chain.then(() => onBatch(batch, batchIndex));
      }
      chain.then(() => resolve(totalRows)).catch(reject);
    });

    rl.on("error", (err) => reject(new SourceFileError(filePath, err)));
    stream.on("error", (err) => reject(new SourceFileError(filePath, err)));
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function splitLine(line: string, delimiter: string): string[] {
  return line.split(delimiter);
}

/**
 * Resolve a file path relative to the source directory.
 * Paths that are already absolute are returned unchanged.
 */
export function resolveSourceFile(sourceDir: string, fileName: string): string {
  if (path.isAbsolute(fileName)) return fileName;
  return path.join(sourceDir, fileName);
}
