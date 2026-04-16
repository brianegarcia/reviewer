import { TSV_FILES } from "../config";
import { parseTsvFile } from "../lib/tsv-parser";
import { IdMap } from "../lib/id-map";
import { logger } from "../lib/logger";
import { emptyToNull } from "../lib/validators";
import { getSequelize } from "../lib/db";

const CTX = "phase3/lab-order-diagnoses";

interface LabDiagnosis {
    code: string;
    codingSystem: string;
    description: string;
}

/**
 * Imports diagnoses associated with lab order items from Practice Fusion.
 * TSV columns: PatientPracticeGuid, OrderGuid, OrderItemGuid, DiagnosisCode, CodingSystem, DiagnosisDescription, ...
 * Enriches lab_orders.order_diagnosis JSONB with diagnosis data.
 */
export async function importLabOrderDiagnoses(labOrderMap: IdMap): Promise<void> {
    logger.info(CTX, "Starting lab order item diagnoses import...");

    const sequelize = getSequelize();

    const rows = await parseTsvFile(TSV_FILES.patientLabOrderItemDiagnoses);
    logger.info(CTX, `Found ${rows.length} lab order item diagnosis records`);

    // Group diagnoses by OrderGuid (directly available in TSV)
    const diagByOrder = new Map<string, LabDiagnosis[]>();

    let skipped = 0;
    for (const row of rows) {
        const orderGuid = row.OrderGuid;
        if (!orderGuid || !labOrderMap.has(orderGuid)) {
            skipped++;
            continue;
        }

        const diagCode = emptyToNull(row.DiagnosisCode);
        const diagDesc = emptyToNull(row.DiagnosisDescription);

        if (!diagCode && !diagDesc) {
            skipped++;
            continue;
        }

        if (!diagByOrder.has(orderGuid)) {
            diagByOrder.set(orderGuid, []);
        }

        diagByOrder.get(orderGuid)!.push({
            code: diagCode || "",
            codingSystem: emptyToNull(row.CodingSystem) || "ICD-10",
            description: diagDesc || "",
        });
    }

    logger.info(CTX, `Grouped diagnoses for ${diagByOrder.size} lab orders`);

    let imported = 0;
    let errored = 0;

    for (const [orderGuid, diagnoses] of diagByOrder) {
        const labOrderId = labOrderMap.get(orderGuid);
        if (!labOrderId) continue;

        try {
            await sequelize.query(
                `UPDATE lab_orders SET order_diagnosis = $1::jsonb, updated_at = NOW() WHERE id = $2`,
                { bind: [JSON.stringify(diagnoses), labOrderId] }
            );
            imported++;
        } catch (err: any) {
            logger.error(CTX, `Lab order ${orderGuid} (id=${labOrderId}): ${err.message}`);
            errored++;
        }
    }

    logger.summary(CTX, { imported, updated: 0, skipped, errored, total: rows.length });
}
