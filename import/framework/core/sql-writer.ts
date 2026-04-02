/**
 * SqlWriter – writes the generated SQL to a file.
 *
 * Wraps the entire output in a single BEGIN / COMMIT transaction so the
 * generated file can be applied atomically and is trivially roll-back-able
 * if a problem is spotted post-review.
 */

import fs from "fs";
import path from "path";
import { PipelineContext, SqlOperation } from "./types";
import { SqlBuilder } from "./sql-builder";

export class SqlWriter {
  private readonly builder = new SqlBuilder();

  /** Append a pre-built SQL string block (already rendered) */
  appendRaw(sql: string): this {
    this.builder.append({ sql });
    return this;
  }

  /** Emit a section header */
  section(title: string, subtitle?: string): this {
    this.builder.section(title, subtitle);
    return this;
  }

  blank(): this {
    this.builder.blank();
    return this;
  }

  /** Append any SqlOperation */
  append(op: SqlOperation): this {
    this.builder.append(op);
    return this;
  }

  /**
   * Write all accumulated SQL to `outputFile`, wrapped in a transaction.
   * The parent directory is created if it does not exist.
   */
  writeToFile(
    outputFile: string,
    context: PipelineContext
  ): void {
    const dir = path.dirname(outputFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const header = buildFileHeader(context);
    const body = this.builder.build();
    const footer = buildFileFooter(context);

    const content = [header, body, footer].join("\n\n");
    fs.writeFileSync(outputFile, content, "utf8");
  }
}

// ─── File header / footer ─────────────────────────────────────────────────────

function buildFileHeader(ctx: PipelineContext): string {
  const ts = new Date().toISOString();
  const lines = [
    "-- ================================================================",
    `-- Import: ${ctx.config.sourceName}`,
    `-- Organization: ${ctx.config.organizationName}`,
    `-- Generated: ${ts}`,
    "-- ================================================================",
    "--",
    "-- USAGE:",
    "--   psql $DATABASE_URL -f " + path.basename(ctx.config.outputFile),
    "--",
    "-- SAFETY:",
    "--   All statements use INSERT … ON CONFLICT DO UPDATE (upserts).",
    "--   The file is idempotent — safe to run more than once.",
    "--   The entire file runs inside a single transaction.",
    "--   If any statement fails the whole import is rolled back.",
    "--",
    "-- REVIEW BEFORE RUNNING:",
    "--   - Confirm organization_id matches your target organisation.",
    "--   - Confirm source file paths and data quality.",
    "--   - Review validation error report at the bottom of this file.",
    "--",
    `-- Validation errors: ${ctx.validationErrors.length}`,
    "-- ================================================================",
    "",
    "BEGIN;",
  ];
  return lines.join("\n");
}

function buildFileFooter(ctx: PipelineContext): string {
  const stepSummary = ctx.stepResults
    .map(
      (r) =>
        `--   [Phase ${r.phase}] ${r.stepName.padEnd(40)} ` +
        `generated=${String(r.generated).padStart(5)}  ` +
        `skipped=${String(r.skipped).padStart(5)}  ` +
        `errors=${String(r.validationErrors.length).padStart(4)}`
    )
    .join("\n");

  const errorLines =
    ctx.validationErrors.length === 0
      ? "--   (none)"
      : ctx.validationErrors
          .map(
            (e) =>
              `--   [${e.step}] row ${e.rowIndex}: ${e.field} – ${e.message}` +
              (e.rawValue !== undefined ? ` (value: ${JSON.stringify(e.rawValue)})` : "")
          )
          .join("\n");

  return [
    "",
    "COMMIT;",
    "",
    "-- ================================================================",
    "-- IMPORT SUMMARY",
    "-- ================================================================",
    "--",
    "-- Steps:",
    stepSummary,
    "--",
    "-- Validation errors (rows skipped):",
    errorLines,
    "-- ================================================================",
  ].join("\n");
}
