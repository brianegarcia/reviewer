/**
 * Validation helpers used by individual steps to validate source rows before
 * generating SQL. Steps call these helpers and collect ValidationErrors.
 * Rows with errors are skipped with a warning rather than halting the pipeline.
 */

import { ValidationError, ValidationResult } from "./types";

// ─── Rule builders ────────────────────────────────────────────────────────────

type Rule<T> = (value: T) => string | null; // returns error message or null

export function required(fieldName: string): Rule<unknown> {
  return (v) =>
    v === null || v === undefined || (typeof v === "string" && v.trim() === "")
      ? `${fieldName} is required`
      : null;
}

export function maxLength(fieldName: string, max: number): Rule<string | null> {
  return (v) =>
    typeof v === "string" && v.length > max
      ? `${fieldName} exceeds max length ${max} (got ${v.length})`
      : null;
}

export function isValidDate(fieldName: string): Rule<string | null> {
  return (v) => {
    if (!v) return null; // optional – use required() separately
    const d = new Date(v);
    return isNaN(d.getTime()) ? `${fieldName} is not a valid date: "${v}"` : null;
  };
}

export function isNumeric(fieldName: string): Rule<string | null> {
  return (v) => {
    if (!v) return null;
    return isNaN(Number(v)) ? `${fieldName} is not numeric: "${v}"` : null;
  };
}

// ─── Row validator ─────────────────────────────────────────────────────────────

export class RowValidator {
  private readonly errors: ValidationError[] = [];

  constructor(
    private readonly stepName: string,
    private readonly rowIndex: number
  ) {}

  check<T>(field: string, value: T, ...rules: Rule<T>[]): this {
    for (const rule of rules) {
      const msg = rule(value);
      if (msg) {
        this.errors.push({
          step: this.stepName,
          rowIndex: this.rowIndex,
          field,
          message: msg,
          rawValue: value,
        });
      }
    }
    return this;
  }

  get result(): ValidationResult {
    return { valid: this.errors.length === 0, errors: this.errors };
  }

  get isValid(): boolean {
    return this.errors.length === 0;
  }

  get collectedErrors(): ValidationError[] {
    return this.errors;
  }
}
