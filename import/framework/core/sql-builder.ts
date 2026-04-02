/**
 * SqlBuilder – Builder Pattern
 *
 * Translates ImportRecord / JsonbSetOperation / RawSqlBlock into safe,
 * formatted PostgreSQL statements.
 *
 * Design notes:
 * - All string values are escaped by doubling internal single-quotes.
 * - RawSql instances are emitted verbatim (the caller is responsible for
 *   ensuring they are safe – they are only used internally, never from
 *   user-supplied input).
 * - Date objects are emitted as ISO-8601 strings.
 * - Plain JS objects are JSON-serialised and cast to ::jsonb.
 * - NULL is emitted for null/undefined values.
 * - Numbers and booleans are emitted unquoted.
 */

import { ImportRecord, JsonbSetOperation, RawSqlBlock, SqlOperation, RawSql, SqlValue } from "./types";
import { SqlEncodingError } from "./errors";

// ─── Value encoding ───────────────────────────────────────────────────────────

/** Encode a single value to a SQL literal */
export function sqlLiteral(value: SqlValue): string {
  if (value === null || value === undefined) return "NULL";
  if (value instanceof RawSql) return value.sql;
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "number") {
    if (!isFinite(value)) throw new SqlEncodingError(`Non-finite number: ${value}`, value);
    return String(value);
  }
  if (value instanceof Date) {
    if (isNaN(value.getTime())) return "NULL";
    return `'${value.toISOString()}'`;
  }
  if (typeof value === "object") {
    // Plain objects and arrays → JSONB
    const json = JSON.stringify(value).replace(/'/g, "''");
    return `'${json}'::jsonb`;
  }
  if (typeof value === "string") {
    // Escape single quotes
    return `'${value.replace(/'/g, "''")}'`;
  }
  throw new SqlEncodingError(`Unsupported value type: ${typeof value}`, value);
}

// ─── INSERT … ON CONFLICT ─────────────────────────────────────────────────────

function buildUpsert(record: ImportRecord): string {
  const { table, data, conflictColumns, updateColumns, useSelect, fromClause, whereClause } = record;

  const columns = Object.keys(data);
  const colList = columns.map((c) => `  ${c}`).join(",\n");

  let valuesClause: string;

  if (useSelect) {
    // INSERT INTO t (cols) SELECT exprs FROM ... WHERE ...
    const selectExprs = columns.map((c) => {
      const v = data[c];
      const expr = sqlLiteral(v);
      return `  ${expr} AS ${c}`;
    });
    let fromPart = fromClause ? `FROM\n  ${fromClause}` : "";
    let wherePart = "";
    if (whereClause) {
      wherePart = `WHERE\n  ${whereClause}`;
    }
    valuesClause = `SELECT\n${selectExprs.join(",\n")}\n${fromPart}\n${wherePart}`;
  } else {
    const vals = columns.map((c) => `  ${sqlLiteral(data[c])}`).join(",\n");
    valuesClause = `VALUES (\n${vals}\n)`;
  }

  const conflictTarget = conflictColumns.join(", ");

  let conflictAction: string;
  if (updateColumns !== undefined && updateColumns.length === 0) {
    conflictAction = "DO NOTHING";
  } else {
    const toUpdate = updateColumns ??
      columns.filter((c) => !conflictColumns.includes(c) && c !== "created_at");
    if (toUpdate.length === 0) {
      conflictAction = "DO NOTHING";
    } else {
      const setClauses = toUpdate
        .filter((c) => c !== "created_at")
        .map((c) => `  ${c} = EXCLUDED.${c}`)
        .join(",\n");
      conflictAction = `DO UPDATE SET\n${setClauses}`;
    }
  }

  return [
    `INSERT INTO ${table} (`,
    colList,
    `)`,
    valuesClause,
    `ON CONFLICT (${conflictTarget}) ${conflictAction};`,
  ].join("\n");
}

// ─── Conditional INSERT (WHERE NOT EXISTS) ───────────────────────────────────

/**
 * For tables without a unique constraint on the conflict columns, generate:
 *   1. UPDATE … SET … WHERE <match>   (only if updateColumns has entries)
 *   2. INSERT INTO … SELECT … WHERE NOT EXISTS (SELECT 1 FROM … WHERE <match>)
 */
function buildConditionalUpsert(record: ImportRecord): string {
  const { table, data, conflictColumns, updateColumns } = record;
  const columns = Object.keys(data);

  // Build the WHERE clause that matches on conflict columns
  const matchConditions = conflictColumns.map((col) => {
    const val = sqlLiteral(data[col]);
    return `${col} = ${val}`;
  }).join(" AND ");

  const parts: string[] = [];

  // Determine which columns to update
  const toUpdate = updateColumns !== undefined
    ? updateColumns.filter((c) => c !== "created_at")
    : columns.filter((c) => !conflictColumns.includes(c) && c !== "created_at");

  // 1. UPDATE existing row (only if there are columns to update)
  if (toUpdate.length > 0) {
    const setClauses = toUpdate.map((col) => `  ${col} = ${sqlLiteral(data[col])}`).join(",\n");
    parts.push([
      `UPDATE ${table} SET`,
      setClauses,
      `WHERE ${matchConditions};`,
    ].join("\n"));
  }

  // 2. INSERT … SELECT … WHERE NOT EXISTS
  const colList = columns.map((c) => `  ${c}`).join(",\n");
  const selectExprs = columns.map((c) => `  ${sqlLiteral(data[c])} AS ${c}`).join(",\n");

  parts.push([
    `INSERT INTO ${table} (`,
    colList,
    `)`,
    `SELECT`,
    selectExprs,
    `WHERE NOT EXISTS (SELECT 1 FROM ${table} WHERE ${matchConditions});`,
  ].join("\n"));

  return parts.join("\n");
}

// ─── JSONB set ────────────────────────────────────────────────────────────────

function buildJsonbSet(op: JsonbSetOperation): string {
  const { table, column, patches, whereClause } = op;

  // Build nested jsonb_set calls from the inside out
  // jsonb_set(jsonb_set(coalesce(col,'{}'), '{a}', val, true), '{b}', val2, true)
  const base = `COALESCE(${column}, '{}'::jsonb)`;

  const expr = patches.reduce((inner, patch) => {
    const jsonVal = JSON.stringify(patch.value ?? null).replace(/'/g, "''");
    return `jsonb_set(${inner}, '${patch.path}'::text[], '${jsonVal}'::jsonb, true)`;
  }, base);

  return [
    `UPDATE ${table}`,
    `SET`,
    `  ${column} = ${expr},`,
    `  updated_at = NOW()`,
    `WHERE`,
    `  ${whereClause};`,
  ].join("\n");
}

// ─── Main builder ─────────────────────────────────────────────────────────────

export class SqlBuilder {
  private readonly _blocks: string[] = [];

  append(op: SqlOperation): this {
    const sql = this.render(op);
    this._blocks.push(sql);
    return this;
  }

  appendAll(ops: SqlOperation[]): this {
    for (const op of ops) this.append(op);
    return this;
  }

  render(op: SqlOperation): string {
    let sql: string;

    if ("whereClause" in op && "patches" in op) {
      // JsonbSetOperation
      sql = buildJsonbSet(op as JsonbSetOperation);
    } else if ("sql" in op) {
      // RawSqlBlock
      sql = (op as RawSqlBlock).sql;
    } else {
      // ImportRecord
      const rec = op as ImportRecord;
      sql = rec.useExistsCheck ? buildConditionalUpsert(rec) : buildUpsert(rec);
    }

    const comment = (op as any).comment;
    return comment ? `-- ${comment}\n${sql}` : sql;
  }

  /** Render a section header comment */
  section(title: string, subtitle?: string): this {
    const bar = "─".repeat(60);
    const lines = [`-- ${bar}`, `-- ${title}`];
    if (subtitle) lines.push(`-- ${subtitle}`);
    lines.push(`-- ${bar}`);
    this._blocks.push(lines.join("\n"));
    return this;
  }

  blank(): this {
    this._blocks.push("");
    return this;
  }

  build(): string {
    return this._blocks.join("\n\n");
  }
}
