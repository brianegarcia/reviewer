/**
 * Base class for all Practice Fusion import steps.
 *
 * Provides convenience wrappers around the parser, SQL builder, and context,
 * so concrete steps stay focused on their entity-specific mapping logic.
 */

import { ImportStep, PipelineContext, StepResult, ValidationError, SqlOperation } from "../../../core/types";
import { parseFile, parseBatched, resolveSourceFile } from "../../../shared/tsv-parser";
import { tsvPath, PfTsvKey } from "../config";

export abstract class BasePfStep implements ImportStep {
  abstract readonly name: string;
  abstract readonly phase: number;

  // ─── Convenience helpers ────────────────────────────────────────────────────

  protected file(ctx: PipelineContext, key: PfTsvKey): string {
    return tsvPath(ctx.config, key);
  }

  protected async loadFile(ctx: PipelineContext, key: PfTsvKey) {
    return parseFile(this.file(ctx, key));
  }

  protected async loadBatched(
    ctx: PipelineContext,
    key: PfTsvKey,
    batchSize: number,
    onBatch: (batch: any[], index: number) => Promise<void>
  ) {
    return parseBatched(this.file(ctx, key), batchSize, onBatch);
  }

  /** Push a single SQL operation into the pipeline */
  protected emit(ctx: PipelineContext, op: SqlOperation): void {
    ctx.operations.push(op);
  }

  /** Push multiple SQL operations */
  protected emitAll(ctx: PipelineContext, ops: SqlOperation[]): void {
    ctx.operations.push(...ops);
  }

  /** Record a validation error and return false so callers can short-circuit */
  protected addError(
    ctx: PipelineContext,
    errors: ValidationError[],
    error: ValidationError
  ): void {
    errors.push(error);
  }

  /** Build a StepResult */
  protected result(
    totalRows: number,
    generated: number,
    skipped: number,
    errors: ValidationError[]
  ): StepResult {
    return {
      stepName: this.name,
      phase: this.phase,
      totalRows,
      generated,
      skipped,
      validationErrors: errors,
    };
  }

  abstract execute(context: PipelineContext): Promise<StepResult>;
}
