/**
 * Core types and interfaces for the multi-source import framework.
 *
 * Design pattern: These interfaces form the Strategy contract. Each source system
 * (Practice Fusion, Epic, Athena, etc.) plugs in via ImportStep implementations.
 */

// ─── Raw parsing ─────────────────────────────────────────────────────────────

/** A single row from a delimited source file (TSV, CSV, etc.) */
export type SourceRow = Record<string, string | null>;

// ─── SQL value types ─────────────────────────────────────────────────────────

/** Sentinel wrapper for raw SQL expressions that must not be quoted */
export class RawSql {
  constructor(public readonly sql: string) {}
}

/** Helper to create a raw SQL expression (e.g. gen_random_uuid(), NOW()) */
export const raw = (sql: string): RawSql => new RawSql(sql);

/** All value types that can appear in a SQL statement */
export type SqlValue = string | number | boolean | null | Date | object | RawSql;

// ─── Domain model ─────────────────────────────────────────────────────────────

/**
 * A normalised record ready to emit as a SQL upsert.
 * Adapter/Mapper pattern: external source rows are mapped into these.
 */
export interface ImportRecord {
  /** Target database table name */
  table: string;
  /**
   * Columns and values to INSERT.
   * Keys are column names; values are SqlValue (strings/numbers/booleans/null/Date/object/RawSql).
   */
  data: Record<string, SqlValue>;
  /**
   * Columns that form the unique natural key used in ON CONFLICT.
   * Must be a subset of data keys that have a unique constraint on the table.
   */
  conflictColumns: string[];
  /**
   * Columns to UPDATE on conflict.
   * If omitted all non-conflict, non-generated columns in `data` are updated.
   * If empty array, conflict is silently ignored (INSERT ... ON CONFLICT DO NOTHING).
   */
  updateColumns?: string[];
  /** Optional human-readable comment emitted above the SQL block */
  comment?: string;
  /**
   * When true, use a WHERE NOT EXISTS check instead of ON CONFLICT for tables
   * that lack a unique constraint on the conflict columns. Generates:
   *   UPDATE … SET … WHERE <conflict match>  (if updateColumns has entries)
   *   INSERT INTO … SELECT … WHERE NOT EXISTS (SELECT 1 FROM … WHERE <conflict match>)
   */
  useExistsCheck?: boolean;
  /**
   * When true, emit an INSERT…SELECT form so that FK lookups can be expressed
   * as subqueries inside a FROM clause. The `data` values may include RawSql
   * expressions that reference aliases defined in `fromClause`.
   */
  useSelect?: boolean;
  /** FROM clause used when useSelect is true (e.g. "patients p LEFT JOIN users u ON ...") */
  fromClause?: string;
  /** WHERE clause used when useSelect is true (in addition to the implicit conflict guard) */
  whereClause?: string;
}

/**
 * A JSONB patch operation – used for idempotent enrichment of existing JSONB columns
 * (e.g. merging vitals / encounterEvents into full_note_details).
 */
export interface JsonbSetOperation {
  table: string;
  column: string;
  /** Path segments for jsonb_set, e.g. ['{vitals}', '{encounterEvents}'] */
  patches: Array<{
    path: string;       // e.g. '{vitals}'
    value: object | null;
  }>;
  /** WHERE clause to identify the row (may use subqueries) */
  whereClause: string;
  comment?: string;
}

/**
 * A raw SQL block emitted verbatim (for complex statements like DO $$ … $$
 * or UPDATE ... SET col = subquery that don't fit the upsert pattern).
 */
export interface RawSqlBlock {
  sql: string;
  comment?: string;
}

/** Union of all things a step can emit */
export type SqlOperation = ImportRecord | JsonbSetOperation | RawSqlBlock;

// ─── Validation ───────────────────────────────────────────────────────────────

export interface ValidationError {
  step: string;
  rowIndex: number;
  field: string;
  message: string;
  rawValue?: unknown;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

// ─── Step result ──────────────────────────────────────────────────────────────

export interface StepResult {
  stepName: string;
  phase: number;
  totalRows: number;
  generated: number;
  skipped: number;
  validationErrors: ValidationError[];
}

// ─── Pipeline context ─────────────────────────────────────────────────────────

/**
 * Shared mutable context threaded through every step of the pipeline.
 * Steps read lookups built by earlier steps and push SQL operations.
 */
export interface PipelineContext {
  config: ImportConfig;
  /** Accumulated SQL operations, in dependency order */
  operations: SqlOperation[];
  /** Accumulated validation errors from all steps */
  validationErrors: ValidationError[];
  /** Step results for final report */
  stepResults: StepResult[];
  /** General-purpose cross-step lookup store (keyed by name, then by source GUID) */
  lookups: LookupStore;
  logger: Logger;
}

/** Cross-step lookup maps – populated by each step for downstream reference */
export interface LookupStore {
  /** Store any lookup by name and key */
  set(name: string, key: string, value: unknown): void;
  get(name: string, key: string): unknown;
  has(name: string, key: string): boolean;
  getAll(name: string): Map<string, unknown>;
}

// ─── Import configuration ─────────────────────────────────────────────────────

export interface ImportConfig {
  /** Display name for this import run (e.g. "Practice Fusion – Omeed Ahadiat Dermatology") */
  sourceName: string;
  /** Root directory containing the source export files */
  sourceDir: string;
  /** Path to write the generated SQL output file */
  outputFile: string;
  /** Target organisation UUID in SubQDocs */
  organizationId: string;
  /** Organisation display name (used in comments) */
  organizationName: string;
  /** Batch size for reading large source files */
  batchSize?: number;
  /** Any source-specific extra config */
  extra?: Record<string, unknown>;
}

// ─── Logger interface ─────────────────────────────────────────────────────────

export interface Logger {
  info(ctx: string, message: string): void;
  warn(ctx: string, message: string): void;
  error(ctx: string, message: string): void;
  summary(ctx: string, stats: { total: number; generated: number; skipped: number; errors: number }): void;
  close(): void;
}

// ─── Step interface (Strategy Pattern) ────────────────────────────────────────

/**
 * Each import step is a Strategy: it knows how to read one entity type from the
 * source files and translate it into SqlOperations.
 *
 * Steps are source-specific implementations registered in the pipeline.
 */
export interface ImportStep {
  readonly name: string;
  readonly phase: number;
  execute(context: PipelineContext): Promise<StepResult>;
}

// ─── Pipeline interface (Template Method) ────────────────────────────────────

export interface ImportPipeline {
  run(): Promise<PipelineReport>;
}

// ─── Report ───────────────────────────────────────────────────────────────────

export interface PipelineReport {
  source: string;
  organization: string;
  outputFile: string;
  startedAt: Date;
  completedAt: Date;
  totalOperations: number;
  stepResults: StepResult[];
  allValidationErrors: ValidationError[];
  success: boolean;
}
