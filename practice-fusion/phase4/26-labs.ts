import { TSV_FILES, ORGANIZATION_ID } from "../config";
import { parseTsvFile } from "../lib/tsv-parser";
import { IdMap } from "../lib/id-map";
import { logger } from "../lib/logger";
import { emptyToNull } from "../lib/validators";
import { getSequelize } from "../lib/db";

const CTX = "phase4/labs";

/**
 * Imports lab reference data (Labcorp, Lab Order, Image Order) into the `labs` table.
 * Then backfills `lab_id` on existing `lab_orders` by joining through `patient-lab-order-items.tsv`.
 */
export async function importLabs(labOrderMap: IdMap): Promise<IdMap> {
    logger.info(CTX, "Starting labs import...");

    const sequelize = getSequelize();
    const labMap = new IdMap("lab-map");

    // ─── Step 1: Import labs ───
    const rows = await parseTsvFile(TSV_FILES.labs);
    logger.info(CTX, `Found ${rows.length} lab records`);

    let imported = 0;
    let skipped = 0;
    let errored = 0;

    for (const row of rows) {
        const labGuid = row.LabGuid;
        if (!labGuid) { skipped++; continue; }

        try {
            const [results] = await sequelize.query(
                `INSERT INTO labs (lab_name, lab_code, organizationlab, address_1, address_2, city, state, zip, created_at, updated_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
                 RETURNING id`,
                {
                    bind: [
                        emptyToNull(row.DisplayName) || emptyToNull(row.LabName) || "Unknown Lab",
                        emptyToNull(row.CodePrefix),
                        ORGANIZATION_ID,
                        emptyToNull(row.Address1),
                        emptyToNull(row.Address2),
                        emptyToNull(row.City),
                        emptyToNull(row.State),
                        emptyToNull(row.ZipCode),
                    ],
                }
            );
            const labId = (results as any[])[0].id;
            labMap.set(labGuid, labId);
            imported++;
        } catch (err: any) {
            logger.error(CTX, `Lab ${labGuid}: ${err.message}`);
            errored++;
        }
    }

    logger.summary(CTX, { imported, updated: 0, skipped, errored, total: rows.length });

    // ─── Step 2: Backfill lab_id on lab_orders via order items ───
    logger.info(CTX, "Backfilling lab_id on existing lab_orders...");

    const orderItems = await parseTsvFile(TSV_FILES.patientLabOrderItems);
    let updated = 0;

    // Group by OrderGuid -> LabGuid (take first LabGuid per order)
    const orderLabMap = new Map<string, string>();
    for (const item of orderItems) {
        const orderGuid = item.OrderGuid;
        const itemLabGuid = emptyToNull(item.LabGuid);
        if (orderGuid && itemLabGuid && !orderLabMap.has(orderGuid)) {
            orderLabMap.set(orderGuid, itemLabGuid);
        }
    }

    for (const [orderGuid, itemLabGuid] of orderLabMap) {
        const labOrderId = labOrderMap.get(orderGuid);
        const labId = labMap.get(itemLabGuid);
        if (!labOrderId || !labId) continue;

        try {
            await sequelize.query(
                `UPDATE lab_orders SET lab_id = $1, updated_at = NOW() WHERE id = $2 AND lab_id IS NULL`,
                { bind: [labId, labOrderId] }
            );
            updated++;
        } catch (err: any) {
            logger.error(CTX, `Backfill lab_id for order ${orderGuid}: ${err.message}`);
        }
    }

    logger.info(CTX, `Backfilled lab_id on ${updated} lab orders`);

    return labMap;
}
