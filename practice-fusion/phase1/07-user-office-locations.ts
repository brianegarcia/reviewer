import UserOfficeLocation from "@models/user-office-location.model";
import { ORGANIZATION_ID } from "../config";
import { IdMap } from "../lib/id-map";
import { logger } from "../lib/logger";

const CTX = "phase1/user-office-locations";

/**
 * Links every provider to every office location (cartesian product).
 */
export async function importUserOfficeLocations(
    facilityMap: IdMap,
    providerMap: IdMap
): Promise<void> {
    logger.info(CTX, "Starting user-office-locations import...");

    const userIds = [...new Set(Object.values(providerMap.getAll()))];
    const officeLocationIds = [...new Set(Object.values(facilityMap.getAll()))];

    if (userIds.length === 0 || officeLocationIds.length === 0) {
        logger.info(CTX, "No providers or facilities found — skipping user-office-location links");
        logger.summary(CTX, { imported: 0, updated: 0, skipped: 0, errored: 0, total: 0 });
        return;
    }

    let imported = 0;
    let updated = 0;
    let errored = 0;
    const total = userIds.length * officeLocationIds.length;

    for (const user_id of userIds) {
        for (const office_location_id of officeLocationIds) {
            try {
                const existing = await UserOfficeLocation.findOne({
                    where: { user_id, office_location_id },
                });

                if (existing) {
                    logger.info(CTX, `Link user=${user_id} -> office=${office_location_id} already exists`);
                    updated++;
                    continue;
                }

                await UserOfficeLocation.create({
                    user_id,
                    office_location_id,
                    organization_id: ORGANIZATION_ID,
                } as any);

                imported++;
                logger.info(CTX, `Linked user=${user_id} -> office=${office_location_id}`);
            } catch (err: any) {
                logger.error(CTX, `user=${user_id} office=${office_location_id}: ${err.message}`);
                errored++;
            }
        }
    }

    logger.summary(CTX, { imported, updated, skipped: 0, errored, total });
}
