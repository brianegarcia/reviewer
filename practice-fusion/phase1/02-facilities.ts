import OfficeLocation from "@models/office-location.model";
import { ORGANIZATION_ID, TSV_FILES, DEFAULT_TIMEZONE } from "../config";
import { parseTsvFile } from "../lib/tsv-parser";
import { IdMap } from "../lib/id-map";
import { logger } from "../lib/logger";
import { emptyToNull } from "../lib/validators";

const CTX = "phase1/facilities";

export async function importFacilities(): Promise<IdMap> {
    const facilityMap = new IdMap("facility-map");
    logger.info(CTX, "Starting facilities import...");

    const rows = await parseTsvFile(TSV_FILES.facilities);
    logger.info(CTX, `Found ${rows.length} facilities in TSV`);

    let imported = 0;
    let updated = 0;
    let errored = 0;

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const guid = row.FacilityGuid;

        if (!guid) {
            logger.warn(CTX, `Row ${i + 1}: Missing FacilityGuid, skipping`);
            errored++;
            continue;
        }

        try {
            // Check if already imported
            const existing = await OfficeLocation.findOne({
                where: { external_id: guid, organization_id: ORGANIZATION_ID },
            });

            if (existing) {
                facilityMap.set(guid, existing.id);
                logger.info(CTX, `Facility "${row.Name}" already exists (id=${existing.id})`);
                updated++;
                continue;
            }

            const location = await OfficeLocation.create({
                name: row.Name || "Unknown Facility",
                organization_id: ORGANIZATION_ID,
                external_id: guid,
                street_name: emptyToNull(row.Address1),
                city: emptyToNull(row.City),
                state: emptyToNull(row.State),
                postal_code: emptyToNull(row.ZipCode),
                country: "US",
                timezone: DEFAULT_TIMEZONE,
                primary_office: i === 0, // First facility is primary
            } as any);

            facilityMap.set(guid, location.id);
            imported++;
            logger.info(CTX, `Imported facility: "${row.Name}" -> id=${location.id}`);
        } catch (err: any) {
            logger.error(CTX, `Row ${i + 1} (${guid}): ${err.message}`);
            errored++;
        }
    }

    facilityMap.save();
    logger.summary(CTX, { imported, updated, skipped: 0, errored, total: rows.length });
    return facilityMap;
}
