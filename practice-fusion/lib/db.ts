import { Sequelize } from "sequelize-typescript";
import path from "path";
import fs from "fs";
import { config } from "dotenv";

// Load .env from backend root
config({ path: path.resolve(__dirname, "../../../.env") });

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
    throw new Error("DATABASE_URL environment variable is required. Check your .env file.");
}

let sequelize: Sequelize | null = null;

/**
 * Get the Sequelize connection, initializing on first call.
 * Loads all models from the backend models directory.
 */
export function getSequelize(): Sequelize {
    if (sequelize) return sequelize;

    const modelsDir = path.resolve(__dirname, "../../../src/sequelize/models");

    // Collect all model files (skip directories and type files)
    const modelFiles = fs
        .readdirSync(modelsDir)
        .filter((f) => {
            return (
                (f.endsWith(".ts") || f.endsWith(".js")) &&
                !f.endsWith(".d.ts") &&
                f !== "index.ts" &&
                f !== "interfaces" &&
                !f.startsWith("types")
            );
        })
        .map((f) => path.join(modelsDir, f));

    sequelize = new Sequelize(DATABASE_URL!, {
        dialect: "postgres",
        logging: false,
        pool: { max: 5, min: 0, acquire: 30000, idle: 10000 },
        models: modelFiles,
    });

    return sequelize;
}

/**
 * Test the database connection.
 */
export async function testConnection(): Promise<void> {
    const seq = getSequelize();
    await seq.authenticate();
}

/**
 * Close the database connection.
 */
export async function closeConnection(): Promise<void> {
    if (sequelize) {
        await sequelize.close();
        sequelize = null;
    }
}
