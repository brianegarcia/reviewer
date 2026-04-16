/**
 * ImporterRegistry – Factory Pattern
 *
 * A central registry that maps source-system names (e.g. "practice-fusion")
 * to factory functions that produce an ImportPipeline.
 *
 * Adding support for a new source system requires only:
 *   1. Implementing a concrete ImportPipeline subclass (with its own steps).
 *   2. Calling ImporterRegistry.register("new-source", factory).
 *
 * Usage:
 *   const pipeline = ImporterRegistry.create("practice-fusion", config, logger);
 *   await pipeline.run();
 */

import { ImportConfig, ImportPipeline, Logger } from "./types";

type PipelineFactory = (config: ImportConfig, logger: Logger) => ImportPipeline;

export class ImporterRegistry {
  private static readonly factories = new Map<string, PipelineFactory>();

  /** Register a factory for a named source system */
  static register(sourceName: string, factory: PipelineFactory): void {
    ImporterRegistry.factories.set(sourceName.toLowerCase(), factory);
  }

  /** Create a pipeline for the given source name */
  static create(sourceName: string, config: ImportConfig, logger: Logger): ImportPipeline {
    const factory = ImporterRegistry.factories.get(sourceName.toLowerCase());
    if (!factory) {
      const known = [...ImporterRegistry.factories.keys()].join(", ");
      throw new Error(
        `No importer registered for "${sourceName}". ` +
          `Known importers: ${known || "(none)"}`
      );
    }
    return factory(config, logger);
  }

  /** List all registered source names */
  static list(): string[] {
    return [...ImporterRegistry.factories.keys()];
  }
}
