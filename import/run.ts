/**
 * Import Framework – CLI entry point
 *
 * Usage:
 *   npx ts-node -P import/tsconfig.json import/run.ts \
 *     --source practice-fusion \
 *     --source-dir /path/to/pf-export \
 *     --output-file ./output/practice_fusion_import.sql \
 *     --org-id dr-omi-dermatology \
 *     --org-name "Omeed Ahadiat Dermatology" \
 *     [--phase 1,2,3,4]   # comma-separated phases; omit for all
 *
 * The generated SQL file can then be reviewed and applied with:
 *   psql $DATABASE_URL -f ./output/practice_fusion_import.sql
 *
 * Adding a new source system:
 *   1. Create framework/sources/<new-source>/pipeline.ts
 *   2. Import it here (the import auto-registers it)
 *   3. Run: --source <new-source>
 */

import path from "path";

// ─── Register all available source systems ────────────────────────────────────
// Each import auto-registers the pipeline in ImporterRegistry
import "./framework/sources/practice-fusion/pipeline";

// ─── Framework imports ────────────────────────────────────────────────────────
import { ImporterRegistry } from "./framework/core/registry";
import { FileLogger } from "./framework/shared/logger";
import { buildPfConfig } from "./framework/sources/practice-fusion/config";
import { PracticeFusionPipeline, PhaseSelection } from "./framework/sources/practice-fusion/pipeline";
import { ImportConfig } from "./framework/core/types";

// ─── CLI argument parsing ─────────────────────────────────────────────────────

function parseArgs(argv: string[]): {
  source: string;
  sourceDir: string;
  outputFile: string;
  orgId: string;
  orgName: string;
  phases: PhaseSelection;
  logDir: string;
  providerEmails: Record<string, string>;
} {
  const args = argv.slice(2);
  const get = (flag: string): string | undefined => {
    const i = args.indexOf(flag);
    return i !== -1 && i + 1 < args.length ? args[i + 1] : undefined;
  };

  const source = get("--source") ?? "practice-fusion";
  const sourceDir = get("--source-dir");
  const outputFile = get("--output-file");
  const orgId = get("--org-id");
  const orgName = get("--org-name");
  const phaseRaw = get("--phase");
  const logDir = get("--log-dir") ?? path.join(__dirname, "logs");

  if (!sourceDir) throw new Error("--source-dir is required");
  if (!outputFile) throw new Error("--output-file is required");
  if (!orgId) throw new Error("--org-id is required");
  if (!orgName) throw new Error("--org-name is required");

  let phases: PhaseSelection = "all";
  if (phaseRaw) {
    const nums = phaseRaw.split(",").map((p) => parseInt(p.trim(), 10)).filter((n) => !isNaN(n));
    phases = nums.length === 1 ? (nums[0] as PhaseSelection) : nums;
  }

  return { source, sourceDir, outputFile, orgId, orgName, phases, logDir, providerEmails: {} };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  let logger: FileLogger | undefined;

  try {
    const opts = parseArgs(process.argv);
    logger = new FileLogger(opts.logDir);

    logger.info("main", "╔══════════════════════════════════════════╗");
    logger.info("main", "║     Multi-Source Import Framework        ║");
    logger.info("main", "╚══════════════════════════════════════════╝");
    logger.info("main", `Source:       ${opts.source}`);
    logger.info("main", `Organisation: ${opts.orgName} (${opts.orgId})`);
    logger.info("main", `Source dir:   ${opts.sourceDir}`);
    logger.info("main", `Output file:  ${opts.outputFile}`);
    logger.info("main", `Log file:     ${logger.logFilePath}`);

    // Build source-specific config
    let config: ImportConfig;
    let pipeline: import("./framework/core/types").ImportPipeline;

    if (opts.source === "practice-fusion") {
      config = buildPfConfig({
        sourceDir: opts.sourceDir,
        outputFile: opts.outputFile,
        organizationId: opts.orgId,
        organizationName: opts.orgName,
        extra: { providerEmails: opts.providerEmails },
      });
      pipeline = new PracticeFusionPipeline(config, logger, opts.phases);
    } else {
      // Generic factory path for future source systems
      config = {
        sourceName: opts.source,
        sourceDir: opts.sourceDir,
        outputFile: opts.outputFile,
        organizationId: opts.orgId,
        organizationName: opts.orgName,
      };
      pipeline = ImporterRegistry.create(opts.source, config, logger);
    }

    const report = await pipeline.run();

    logger.info("main", "╔══════════════════════════════════════════╗");
    logger.info("main", "║  IMPORT COMPLETE                         ║");
    logger.info("main", "╚══════════════════════════════════════════╝");
    logger.info("main", `SQL file:         ${report.outputFile}`);
    logger.info("main", `Total operations: ${report.totalOperations}`);
    logger.info("main", `Validation errors: ${report.allValidationErrors.length}`);
    logger.info("main", `Duration: ${((report.completedAt.getTime() - report.startedAt.getTime()) / 1000).toFixed(1)}s`);

    if (report.allValidationErrors.length > 0) {
      logger.warn("main", `⚠  ${report.allValidationErrors.length} rows were skipped due to validation errors.`);
      logger.warn("main", "   Review the error report at the bottom of the SQL file.");
    }

    logger.info("main", "");
    logger.info("main", "To apply the SQL:");
    logger.info("main", `  psql \\$DATABASE_URL -f ${report.outputFile}`);

    process.exit(report.success ? 0 : 1);
  } catch (err: any) {
    if (logger) {
      logger.error("main", `Fatal error: ${err.message}`);
      if (err.stack) logger.error("main", err.stack);
    } else {
      console.error("Fatal error:", err.message);
    }
    process.exit(1);
  } finally {
    logger?.close();
  }
}

main();
