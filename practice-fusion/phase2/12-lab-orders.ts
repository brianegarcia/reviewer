import { ORGANIZATION_ID, TSV_FILES } from "../config";
import { parseTsvFile, TsvRow } from "../lib/tsv-parser";
import { IdMap } from "../lib/id-map";
import { logger } from "../lib/logger";
import { emptyToNull } from "../lib/validators";
import { getSequelize } from "../lib/db";

const CTX = "phase2/lab-orders";

interface LabTest {
    description: string;
    order_code: string;
}

interface LabObservation {
    testName: string;
    observation: string;
    result: string;
    units: string;
    referenceRange: string;
    status: string;
    loincCode: string;
    flagCode: string | null;
}

const PF_STATUS_MAP: Record<string, string> = {
    Draft: "draft",
    Completed: "completed",
    Received: "pending result",
};

export async function importLabOrders(patientMap: IdMap, profileMap: IdMap, encounterMap: IdMap, facilityMap: IdMap): Promise<void> {
    logger.info(CTX, "Starting lab orders import...");

    // 1. Read lab order items and group by OrderGuid
    const orderItems = await parseTsvFile(TSV_FILES.patientLabOrderItems);
    const itemsByOrder = new Map<string, LabTest[]>();

    for (const item of orderItems) {
        const orderGuid = item.OrderGuid || "";
        if (!itemsByOrder.has(orderGuid)) {
            itemsByOrder.set(orderGuid, []);
        }
        itemsByOrder.get(orderGuid)!.push({
            description: emptyToNull(item.Name) || "",
            order_code: emptyToNull(item.Code) || emptyToNull(item.LoincCode) || "",
        });
    }
    logger.info(CTX, `Loaded ${orderItems.length} lab order items for ${itemsByOrder.size} orders`);

    // 2. Read lab results and group by OrderGuid
    const results = await parseTsvFile(TSV_FILES.patientLabResults);
    const resultsByOrder = new Map<string, TsvRow>();
    for (const r of results) {
        if (r.OrderGuid) {
            resultsByOrder.set(r.OrderGuid, r);
        }
    }

    // 3. Read lab observations and group by ResultGuid
    const observations = await parseTsvFile(TSV_FILES.patientLabResultObservations);
    const obsByResult = new Map<string, LabObservation[]>();
    for (const obs of observations) {
        const resultGuid = obs.ResultGuid || "";
        if (!obsByResult.has(resultGuid)) {
            obsByResult.set(resultGuid, []);
        }
        obsByResult.get(resultGuid)!.push({
            testName: emptyToNull(obs.TestName) || "",
            observation: emptyToNull(obs.Observation) || "",
            result: emptyToNull(obs.Result) || "",
            units: emptyToNull(obs.Units) || "",
            referenceRange: emptyToNull(obs.ReferencesRange) || "",
            status: emptyToNull(obs.Status) || "",
            loincCode: emptyToNull(obs.LoincCode) || "",
            flagCode: emptyToNull(obs.FlagCode),
        });
    }
    logger.info(CTX, `Loaded ${observations.length} observations for ${obsByResult.size} results`);

    // 4. Read and process lab orders
    const labOrders = await parseTsvFile(TSV_FILES.patientLabOrders);
    logger.info(CTX, `Found ${labOrders.length} lab orders`);

    const labOrderMap = new IdMap("lab-order-map");
    const sequelize = getSequelize();
    let imported = 0;
    let updated = 0;
    let skipped = 0;
    let errored = 0;

    // Pre-load existing lab orders by placer_order_number
    const [existingOrders] = await sequelize.query(
        `SELECT id, placer_order_number FROM lab_orders WHERE organization_id = $1 AND placer_order_number IS NOT NULL AND deleted_at IS NULL`,
        { bind: [ORGANIZATION_ID] }
    ) as [any[], unknown];
    const existingByOrderNum = new Map<string, number>();
    for (const row of existingOrders) {
        existingByOrderNum.set(row.placer_order_number, row.id);
    }
    logger.info(CTX, `Found ${existingByOrderNum.size} existing lab orders`);

    for (const row of labOrders) {
        const orderGuid = row.OrderGuid;
        if (!orderGuid) {
            skipped++;
            continue;
        }

        const patientId = patientMap.get(row.PatientPracticeGuid || "");
        if (!patientId) {
            skipped++;
            continue;
        }

        const orderNumber = emptyToNull(row.OrderNumber);

        // Check if already imported
        if (orderNumber && existingByOrderNum.has(orderNumber)) {
            labOrderMap.set(orderGuid, existingByOrderNum.get(orderNumber)!);
            updated++;
            continue;
        }

        const providerId = profileMap.get(row.OrderingProviderProfileGuid || "") || null;
        const visitId = encounterMap.get(row.EncounterGuid || "") || null;
        const facility = facilityMap.get(row.FacilityGuid || "")?.toString() || null;
        const status = PF_STATUS_MAP[row.OrderStatus || ""] || "draft";
        const requestDate = emptyToNull(row.FutureOrderDateTimeUtc) || emptyToNull(row.LastModifiedDateTimeUtc) || null;
        const tests = itemsByOrder.get(orderGuid) || [];

        // Check if there are results for this order
        const result = resultsByOrder.get(orderGuid);
        const hasResults = !!result;
        let resultText = "";

        if (result?.ResultGuid) {
            const obs = obsByResult.get(result.ResultGuid) || [];
            resultText = obs
                .map((o) => `${o.observation}: ${o.result} ${o.units} (Ref: ${o.referenceRange}) [${o.status}]`)
                .join("\n");
        }

        try {
            const [results] = await sequelize.query(
                `INSERT INTO lab_orders (patient_id, organization_id, ordering_provider_id, placer_order_number, visit_id, facility, status, order_type, bill_type, order_status, comment, tests, order_diagnosis, priority, report_status, result, is_unsolicited, patient_notified, plan_executes, ai_automated, request_date, created_at, updated_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, NOW(), NOW())
                 RETURNING id`,
                {
                    bind: [
                        patientId,
                        ORGANIZATION_ID,
                        providerId,
                        orderNumber,
                        visitId,
                        facility,
                        status,
                        emptyToNull(row.LabType) || "Diagnostic",
                        emptyToNull(row.PaymentPreferenceType) || "Patient",
                        emptyToNull(row.OrderStatus),
                        emptyToNull(row.Note),
                        JSON.stringify(tests.length > 0 ? tests : []),
                        JSON.stringify([]), // order_diagnosis NOT NULL default
                        "ROUTINE",
                        hasResults ? "ARRIVED" : "PENDING",
                        resultText || null,
                        false,
                        false,
                        false,
                        true,
                        requestDate,
                    ],
                }
            );

            const newId = (results as any[])[0]?.id;
            if (newId) {
                labOrderMap.set(orderGuid, newId);
                if (orderNumber) existingByOrderNum.set(orderNumber, newId);
            }
            imported++;
        } catch (err: any) {
            logger.error(CTX, `Lab order ${orderGuid}: ${err.message}`);
            errored++;
        }
    }

    labOrderMap.save();
    logger.summary(CTX, { imported, updated, skipped, errored, total: labOrders.length });
}
