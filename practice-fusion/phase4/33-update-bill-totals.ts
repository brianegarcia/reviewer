import { IdMap } from "../lib/id-map";
import { logger } from "../lib/logger";
import { getSequelize } from "../lib/db";

const CTX = "phase4/update-bill-totals";

/**
 * Recalculates totalCharges and balance on bills created in this phase.
 */
export async function updateBillTotals(billingHeaderMap: IdMap): Promise<void> {
    logger.info(CTX, "Updating bill totals from services...");

    const sequelize = getSequelize();

    const billIds = Object.values(billingHeaderMap.getAll());
    if (billIds.length === 0) {
        logger.info(CTX, "No bills to update");
        return;
    }

    // Build parameterized IN clause
    const placeholders = billIds.map((_, i) => `$${i + 1}`).join(", ");

    try {
        const [results] = await sequelize.query(
            `UPDATE bills SET
                total_charges = COALESCE((SELECT SUM(total_charge) FROM bill_services WHERE bill_id = bills.id), 0),
                balance = COALESCE((SELECT SUM(total_charge) FROM bill_services WHERE bill_id = bills.id), 0),
                updated_at = NOW()
             WHERE id IN (${placeholders})`,
            { bind: billIds }
        );

        logger.info(CTX, `Updated totals for ${billIds.length} bills`);
    } catch (err: any) {
        logger.error(CTX, `Failed to update bill totals: ${err.message}`);
    }
}
