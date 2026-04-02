/**
 * Step 12 – Lab Orders → lab_orders
 *
 * Changes in "fix: general fixes":
 *   - LabTest interface: { description, order_code } (was code/loinc/name)
 *   - Signature: now receives encounterMap + facilityMap (passed through ctx.lookups)
 *   - New columns: visit_id, facility, status (mapped via PF_STATUS_MAP), request_date
 *
 * Natural key: optum_order_id (OrderGuid), conflict on (optum_order_id, patient_id)
 * The `tests` column is a JSONB array of order items with result observations.
 *
 * Actual schema: id, optum_order_id, patient_id, ordering_provider_id,
 *   organization_id (int), placer_order_number (bigint), visit_id, facility,
 *   status, order_type, bill_type, order_status, priority (enum), comment,
 *   tests (jsonb), collection_date, report_status (enum), result, is_unsolicited,
 *   patient_notified, plan_executes, ai_automated, request_date, created_at, updated_at.
 */

import { PipelineContext, StepResult, ValidationError, raw } from "../../../core/types";
import { BasePfStep } from "./base.step";
import {
  PfLabOrderRow, PfLabOrderItemRow, PfLabResultRow, PfLabResultObservationRow,
} from "../types";
import { emptyToNull, parseDateString, parseDateTimeString } from "../../../shared/validators";
import { sqlLiteral } from "../../../core/sql-builder";
import { getPfExtra } from "../config";

// Mirrors PF_STATUS_MAP from the source
const PF_STATUS_MAP: Record<string, string> = {
  Draft: "draft",
  Completed: "completed",
  Received: "pending result",
};

export class LabOrdersStep extends BasePfStep {
  readonly name = "12-lab-orders";
  readonly phase = 2;

  async execute(ctx: PipelineContext): Promise<StepResult> {
    const errors: ValidationError[] = [];

    // Pre-load reference tables
    const itemRows = (await this.loadFile(ctx, "patientLabOrderItems")) as PfLabOrderItemRow[];
    const resultRows = (await this.loadFile(ctx, "patientLabResults")) as PfLabResultRow[];
    const obsRows = (await this.loadFile(ctx, "patientLabResultObservations")) as PfLabResultObservationRow[];

    // Build item map: OrderGuid → items[] using new test structure
    const itemsByOrder = new Map<string, { description: string; order_code: string }[]>();
    for (const item of itemRows) {
      if (!item.OrderGuid) continue;
      if (!itemsByOrder.has(item.OrderGuid)) itemsByOrder.set(item.OrderGuid, []);
      itemsByOrder.get(item.OrderGuid)!.push({
        description: emptyToNull(item.Name) ?? "",
        order_code: emptyToNull(item.Code) ?? emptyToNull(item.LoincCode) ?? "",
      });
    }

    // Build result map: OrderGuid → result
    const resultByOrder = new Map<string, PfLabResultRow>();
    for (const result of resultRows) {
      if (result.OrderGuid) resultByOrder.set(result.OrderGuid, result);
    }

    // Build observation map: ResultGuid → observations[]
    const obsByResult = new Map<string, PfLabResultObservationRow[]>();
    for (const obs of obsRows) {
      if (!obs.ResultGuid) continue;
      if (!obsByResult.has(obs.ResultGuid)) obsByResult.set(obs.ResultGuid, []);
      obsByResult.get(obs.ResultGuid)!.push(obs);
    }

    const batchSize = getPfExtra(ctx.config).batchSize;
    let generated = 0;
    let skipped = 0;
    let totalRows = 0;

    const orgId = ctx.config.organizationId;
    const orgIdExpr = `(SELECT id FROM organizations WHERE organization_id = ${sqlLiteral(orgId)} LIMIT 1)`;

    await this.loadBatched(ctx, "patientLabOrders", batchSize, async (batch: PfLabOrderRow[]) => {
      for (const row of batch) {
        totalRows++;
        const orderGuid = row.OrderGuid;
        const patGuid = row.PatientPracticeGuid;

        if (!orderGuid || !patGuid) { skipped++; continue; }

        const profileGuid = emptyToNull(row.OrderingProviderProfileGuid);
        const encGuid = emptyToNull(row.EncounterGuid);
        const facGuid = emptyToNull(row.FacilityGuid);

        const patIdExpr = `(SELECT id FROM patient WHERE third_party_id = ${sqlLiteral(patGuid)} LIMIT 1)`;
        const provIdExpr = profileGuid
          ? `(SELECT id FROM users WHERE third_party_id = ${sqlLiteral(profileGuid)} AND organization_id = ${orgIdExpr} LIMIT 1)`
          : "NULL";

        // visit_id resolved from encounter (new field)
        const visitIdExpr = encGuid
          ? `(SELECT id FROM patient_visits WHERE third_party_id = ${sqlLiteral(encGuid)} LIMIT 1)`
          : "NULL";

        // facility resolved from office_locations (new field — stores the external_id string)
        const facilityExpr = facGuid
          ? `(SELECT external_id FROM office_locations WHERE external_id = ${sqlLiteral(facGuid)} LIMIT 1)`
          : "NULL";

        // status via PF_STATUS_MAP
        const status = PF_STATUS_MAP[row.OrderStatus ?? ""] ?? "draft";

        // request_date: prefer FutureOrderDateTimeUtc, fall back to LastModifiedDateTimeUtc
        const requestDate =
          parseDateTimeString(row.FutureOrderDateTimeUtc) ??
          parseDateTimeString(row.LastModifiedDateTimeUtc) ??
          null;

        // Build tests JSONB using new structure
        const items = itemsByOrder.get(orderGuid) ?? [];
        const result = resultByOrder.get(orderGuid);
        const observations = result ? (obsByResult.get(result.ResultGuid ?? "") ?? []) : [];

        const tests = items.map((item) => ({
          description: item.description,
          order_code: item.order_code,
          result: observations.map((o) => ({
            test_name: emptyToNull(o.TestName),
            observation: emptyToNull(o.Observation),
            result: emptyToNull(o.Result),
            units: emptyToNull(o.Units),
            reference_range: emptyToNull(o.ReferencesRange),
            status: emptyToNull(o.Status),
            loinc_code: emptyToNull(o.LoincCode),
            flag_code: emptyToNull(o.FlagCode),
          })),
        }));

        const reportStatus = emptyToNull(row.OrderStatus) === "Completed" ? "ARRIVED" : "PENDING";
        const collectionDate = result ? parseDateString(result.CollectionDate) : null;

        // placer_order_number is bigint in DB — only use if numeric, otherwise NULL
        const orderNumRaw = emptyToNull(row.OrderNumber);
        const placerOrderNumber = orderNumRaw && /^\d+$/.test(orderNumRaw) ? orderNumRaw : null;

        this.emit(ctx, {
          table: "lab_orders",
          data: {
            optum_order_id: orderGuid,
            patient_id: raw(patIdExpr),
            ordering_provider_id: raw(provIdExpr),
            organization_id: raw(orgIdExpr),
            placer_order_number: placerOrderNumber,
            visit_id: raw(visitIdExpr),
            facility: raw(facilityExpr),
            status,
            order_type: emptyToNull(row.LabType) ?? "Diagnostic",
            bill_type: emptyToNull(row.PaymentPreferenceType) ?? "Patient",
            order_status: emptyToNull(row.OrderStatus),
            priority: "ROUTINE",
            comment: emptyToNull(row.Note),
            tests,
            collection_date: collectionDate,
            report_status: reportStatus,
            result: null,
            is_unsolicited: false,
            patient_notified: false,
            plan_executes: false,
            ai_automated: false,
            request_date: requestDate,
            created_at: raw("NOW()"),
            updated_at: raw("NOW()"),
          },
          conflictColumns: ["optum_order_id", "patient_id"],
          updateColumns: [
            "visit_id", "facility", "status", "order_status", "comment",
            "tests", "collection_date", "report_status", "request_date", "updated_at",
          ],
          comment: `Lab order: ${orderGuid} patient=${patGuid}`,
        });

        ctx.lookups.set("labOrder", orderGuid, orderGuid);
        generated++;
      }
    });

    return this.result(totalRows, generated, skipped, errors);
  }
}
