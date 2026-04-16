/**
 * Concrete Logger implementation: writes to console + a timestamped log file.
 */

import fs from "fs";
import path from "path";
import { Logger } from "../core/types";

type LogLevel = "INFO" | "WARN" | "ERROR";

const COLORS: Record<LogLevel, string> = {
  INFO: "\x1b[36m",  // cyan
  WARN: "\x1b[33m",  // yellow
  ERROR: "\x1b[31m", // red
};
const RESET = "\x1b[0m";

export class FileLogger implements Logger {
  private readonly stream: fs.WriteStream;
  private readonly filePath: string;

  constructor(logDir: string) {
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    this.filePath = path.join(logDir, `import-${ts}.log`);
    this.stream = fs.createWriteStream(this.filePath, { flags: "a" });
  }

  info(ctx: string, message: string): void {
    this.write("INFO", ctx, message);
  }

  warn(ctx: string, message: string): void {
    this.write("WARN", ctx, message);
  }

  error(ctx: string, message: string): void {
    this.write("ERROR", ctx, message);
  }

  summary(ctx: string, stats: { total: number; generated: number; skipped: number; errors: number }): void {
    const msg =
      `Complete: total=${stats.total}  generated=${stats.generated}  ` +
      `skipped=${stats.skipped}  errors=${stats.errors}`;
    this.write("INFO", ctx, msg);
  }

  close(): void {
    this.stream.end();
  }

  get logFilePath(): string {
    return this.filePath;
  }

  private write(level: LogLevel, ctx: string, message: string): void {
    const ts = new Date().toISOString();
    const color = COLORS[level];
    // Console (coloured)
    console.log(`${color}[${level}]${RESET} ${ts} [${ctx}] ${message}`);
    // File (JSON)
    this.stream.write(JSON.stringify({ ts, level, ctx, message }) + "\n");
  }
}

/** Minimal console-only logger useful for tests / scripting */
export class ConsoleLogger implements Logger {
  info(ctx: string, message: string): void { console.log(`[INFO] [${ctx}] ${message}`); }
  warn(ctx: string, message: string): void { console.warn(`[WARN] [${ctx}] ${message}`); }
  error(ctx: string, message: string): void { console.error(`[ERROR] [${ctx}] ${message}`); }
  summary(ctx: string, stats: { total: number; generated: number; skipped: number; errors: number }): void {
    console.log(`[INFO] [${ctx}] total=${stats.total} generated=${stats.generated} skipped=${stats.skipped} errors=${stats.errors}`);
  }
  close(): void {}
}
