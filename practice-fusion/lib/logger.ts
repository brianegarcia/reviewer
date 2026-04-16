import fs from "fs";
import path from "path";
import { LOGS_DIR } from "../config";

type LogLevel = "INFO" | "WARN" | "ERROR";

const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const logFileName = `import-${timestamp}.log`;

let logStream: fs.WriteStream | null = null;

function getLogStream(): fs.WriteStream {
    if (!logStream) {
        if (!fs.existsSync(LOGS_DIR)) {
            fs.mkdirSync(LOGS_DIR, { recursive: true });
        }
        logStream = fs.createWriteStream(path.join(LOGS_DIR, logFileName), { flags: "a" });
    }
    return logStream;
}

function log(level: LogLevel, context: string, message: string): void {
    const ts = new Date().toISOString();
    const line = `[${ts}] [${level}] [${context}] ${message}`;

    // Console output with color
    if (level === "ERROR") {
        console.error(`\x1b[31m${line}\x1b[0m`);
    } else if (level === "WARN") {
        console.warn(`\x1b[33m${line}\x1b[0m`);
    } else {
        console.log(line);
    }

    // File output
    getLogStream().write(line + "\n");
}

export const logger = {
    info: (context: string, message: string) => log("INFO", context, message),
    warn: (context: string, message: string) => log("WARN", context, message),
    error: (context: string, message: string) => log("ERROR", context, message),

    /** Log a step summary */
    summary: (context: string, stats: { imported: number; skipped: number; updated: number; errored: number; total: number }) => {
        const msg = `Complete: ${stats.total} total, ${stats.imported} imported, ${stats.updated} updated, ${stats.skipped} skipped, ${stats.errored} errored`;
        log("INFO", context, msg);
    },

    close: () => {
        if (logStream) {
            logStream.end();
            logStream = null;
        }
    },
};
