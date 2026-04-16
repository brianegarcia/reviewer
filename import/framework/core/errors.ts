/**
 * Error hierarchy for the import framework.
 */

export class ImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportError";
  }
}

/** Raised when a required source file is missing or unreadable */
export class SourceFileError extends ImportError {
  constructor(public readonly filePath: string, cause?: Error) {
    super(`Cannot read source file: ${filePath}${cause ? ` — ${cause.message}` : ""}`);
    this.name = "SourceFileError";
  }
}

/** Raised when a required configuration value is absent */
export class ConfigError extends ImportError {
  constructor(public readonly key: string) {
    super(`Missing required configuration: ${key}`);
    this.name = "ConfigError";
  }
}

/** Raised when an import step fails fatally (not a per-row skip) */
export class StepError extends ImportError {
  constructor(public readonly stepName: string, cause: Error) {
    super(`Step "${stepName}" failed: ${cause.message}`);
    this.name = "StepError";
    this.cause = cause;
  }
}

/** Raised when SQL generation encounters a value it cannot safely encode */
export class SqlEncodingError extends ImportError {
  constructor(message: string, public readonly value?: unknown) {
    super(message);
    this.name = "SqlEncodingError";
  }
}
