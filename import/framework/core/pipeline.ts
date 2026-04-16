/**
 * BaseImportPipeline – Template Method Pattern
 *
 * Defines the invariant skeleton of an import run:
 *   1. validate()      – pre-flight checks (config, files, etc.)
 *   2. buildContext()  – create the shared PipelineContext
 *   3. runSteps()      – execute each registered ImportStep in order
 *   4. writeSql()      – flush all SqlOperations to the output file
 *   5. report()        – return the PipelineReport
 *
 * Subclasses (e.g. PracticeFusionPipeline) override `getSteps()` to supply
 * their ordered list of ImportStep instances.
 */

import path from "path";
import {
  ImportConfig,
  ImportPipeline,
  ImportStep,
  PipelineContext,
  PipelineReport,
  LookupStore,
  Logger,
  StepResult,
} from "./types";
import { SqlWriter } from "./sql-writer";
import { StepError } from "./errors";

// ─── In-memory LookupStore implementation ─────────────────────────────────────

class InMemoryLookupStore implements LookupStore {
  private readonly store = new Map<string, Map<string, unknown>>();

  private bucket(name: string): Map<string, unknown> {
    if (!this.store.has(name)) this.store.set(name, new Map());
    return this.store.get(name)!;
  }

  set(name: string, key: string, value: unknown): void {
    this.bucket(name).set(key, value);
  }

  get(name: string, key: string): unknown {
    return this.bucket(name).get(key);
  }

  has(name: string, key: string): boolean {
    return this.bucket(name).has(key);
  }

  getAll(name: string): Map<string, unknown> {
    return new Map(this.bucket(name));
  }
}

// ─── Base pipeline ─────────────────────────────────────────────────────────────

export abstract class BaseImportPipeline implements ImportPipeline {
  constructor(
    protected readonly config: ImportConfig,
    protected readonly logger: Logger
  ) {}

  /**
   * Template method hook – subclasses return their ordered list of steps.
   */
  protected abstract getSteps(): ImportStep[];

  /**
   * Template method hook – subclasses may override to add pre-flight checks
   * beyond the base ones (e.g. verify TSV files exist).
   */
  protected validate(_config: ImportConfig): void {
    if (!_config.organizationId) throw new Error("organizationId is required");
    if (!_config.sourceDir) throw new Error("sourceDir is required");
    if (!_config.outputFile) throw new Error("outputFile is required");
  }

  async run(): Promise<PipelineReport> {
    const startedAt = new Date();

    this.logger.info("pipeline", `Starting import: ${this.config.sourceName}`);
    this.logger.info("pipeline", `Organization: ${this.config.organizationName}`);
    this.logger.info("pipeline", `Output: ${this.config.outputFile}`);

    // 1. Validate
    try {
      this.validate(this.config);
    } catch (err: any) {
      this.logger.error("pipeline", `Pre-flight validation failed: ${err.message}`);
      throw err;
    }

    // 2. Build context
    const writer = new SqlWriter();
    const context: PipelineContext = {
      config: this.config,
      operations: [],
      validationErrors: [],
      stepResults: [],
      lookups: new InMemoryLookupStore(),
      logger: this.logger,
    };

    writer.section(
      `${this.config.sourceName}`,
      `Organization: ${this.config.organizationName} (${this.config.organizationId})`
    );

    // 3. Run steps
    const steps = this.getSteps();
    this.logger.info("pipeline", `Running ${steps.length} steps...`);

    let allSuccess = true;
    for (const step of steps) {
      this.logger.info("pipeline", `→ [Phase ${step.phase}] ${step.name}`);
      try {
        const result = await step.execute(context);
        context.stepResults.push(result);
        context.validationErrors.push(...result.validationErrors);

        this.logger.summary(step.name, {
          total: result.totalRows,
          generated: result.generated,
          skipped: result.skipped,
          errors: result.validationErrors.length,
        });

        // Flush step's operations to the writer
        writer.section(`Step: ${step.name}`, `Phase ${step.phase}`);
        for (const op of context.operations.splice(0)) {
          writer.append(op);
        }
        writer.blank();
      } catch (err: any) {
        allSuccess = false;
        this.logger.error("pipeline", `Step "${step.name}" threw: ${err.message}`);
        throw new StepError(step.name, err);
      }
    }

    // 4. Write SQL file
    writer.writeToFile(this.config.outputFile, context);
    this.logger.info(
      "pipeline",
      `SQL file written: ${path.resolve(this.config.outputFile)}`
    );

    const completedAt = new Date();
    const totalOps = context.stepResults.reduce((s, r) => s + r.generated, 0);

    // 5. Return report
    const report: PipelineReport = {
      source: this.config.sourceName,
      organization: this.config.organizationName,
      outputFile: path.resolve(this.config.outputFile),
      startedAt,
      completedAt,
      totalOperations: totalOps,
      stepResults: context.stepResults,
      allValidationErrors: context.validationErrors,
      success: allSuccess,
    };

    this.logger.info(
      "pipeline",
      `Import complete. ${totalOps} SQL operations. ${context.validationErrors.length} validation errors.`
    );

    return report;
  }
}
