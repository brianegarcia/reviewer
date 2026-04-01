import fs from "fs";
import path from "path";
import { ID_MAPS_DIR } from "../config";

/**
 * Manages GUID -> SubQDocs ID mappings.
 * Persisted to JSON files for re-runs and cross-step lookups.
 */
export class IdMap {
    private map: Record<string, number> = {};
    private filePath: string;
    private name: string;

    constructor(name: string) {
        this.name = name;
        this.filePath = path.join(ID_MAPS_DIR, `${name}.json`);
        this.load();
    }

    private load(): void {
        if (fs.existsSync(this.filePath)) {
            const data = fs.readFileSync(this.filePath, "utf-8");
            this.map = JSON.parse(data);
        }
    }

    save(): void {
        if (!fs.existsSync(ID_MAPS_DIR)) {
            fs.mkdirSync(ID_MAPS_DIR, { recursive: true });
        }
        fs.writeFileSync(this.filePath, JSON.stringify(this.map, null, 2));
    }

    set(externalId: string, internalId: number): void {
        this.map[externalId] = internalId;
    }

    get(externalId: string): number | undefined {
        return this.map[externalId];
    }

    has(externalId: string): boolean {
        return externalId in this.map;
    }

    size(): number {
        return Object.keys(this.map).length;
    }

    getAll(): Record<string, number> {
        return { ...this.map };
    }

    getName(): string {
        return this.name;
    }
}
