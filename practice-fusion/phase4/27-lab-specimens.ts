import { TSV_FILES } from "../config";
import { parseTsvFile } from "../lib/tsv-parser";
import { IdMap } from "../lib/id-map";
import { logger } from "../lib/logger";
import { emptyToNull, parseDate } from "../lib/validators";
import { getSequelize } from "../lib/db";

const CTX = "phase4/lab-specimens";

/**
 * Imports lab order specimen data into `lab_order_test_specimen`.
 * TSV columns: PatientPracticeGuid, OrderGuid, OrderItemGuid, SpecimenContainerCount, Note,
 *   SpecimenCollectionDateTimeUtc, IsCollectedAtPatientServiceCenter, SpecimenTypeCode,
 *   SpecimenTypeName, SpecimenTypeCodingSystemName, ...
 */
export async function importLabSpecimens(labOrderMap: IdMap): Promise<void> {
    logger.info(CTX, "Starting lab specimen import...");

    const sequelize = getSequelize();
    const rows = await parseTsvFile(TSV_FILES.labOrderItemSpecimens);
    logger.info(CTX, `Found ${rows.length} specimen records`);

    let imported = 0;
    let skipped = 0;
    let errored = 0;

    for (const row of rows) {
        const orderGuid = row.OrderGuid;
        if (!orderGuid || !labOrderMap.has(orderGuid)) {
            skipped++;
            continue;
        }

        const labOrderId = labOrderMap.get(orderGuid);
        const specimenDate = parseDate(row.SpecimenCollectionDateTimeUtc);

        if (!specimenDate) {
            logger.warn(CTX, `Specimen for order ${orderGuid}: missing collection date, skipping`);
            skipped++;
            continue;
        }

        try {
            await sequelize.query(
                `INSERT INTO lab_order_test_specimen
                    (lab_order_id, test_id, test_description, test_order_code, loc_label, test_status, specimen_date, created_at, updated_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())`,
                {
                    bind: [
                        labOrderId,
                        0, // test_id: no PF equivalent, use default
                        emptyToNull(row.SpecimenTypeName) || "Specimen",
                        0, // test_order_code: no PF equivalent, use default
                        "imported", // loc_label: required NOT NULL
                        "collected",
                        specimenDate,
                    ],
                }
            );
            imported++;
        } catch (err: any) {
            logger.error(CTX, `Specimen for order ${orderGuid}: ${err.message}`);
            errored++;
        }
    }

    logger.summary(CTX, { imported, updated: 0, skipped, errored, total: rows.length });
}
