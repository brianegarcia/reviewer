/**
 * Step 32 – Superbill Procedures → bill_services
 *
 * Maps CPT code line items to bill_services.
 * Natural key: (bill_id, cpt_code) – bills must be inserted first (step 31).
 *
 * FK: bill_id resolved via bills.patient_id + visit_id lookup.
 * (bills don't store BillingHeaderGuid directly, so we match by patient + visit)
 *
 * Diagnosis pointers per procedure come from superbill-diagnosis.tsv
 * (BillingProcedureGuid → diagnosis codes).
 */

import { PipelineContext, StepResult, ValidationError, raw } from "../../../core/types";
import { BasePfStep } from "./base.step";
import { PfSuperbillProcedureRow, PfSuperbillDiagnosisRow, PfSuperbillRow } from "../types";
import { emptyToNull, parseFloat2, parseQuantity } from "../../../shared/validators";
import { sqlLiteral } from "../../../core/sql-builder";

export class SuperbillProceduresStep extends BasePfStep {
  readonly name = "32-superbill-procedures";
  readonly phase = 4;

  async execute(ctx: PipelineContext): Promise<StepResult> {
    const errors: ValidationError[] = [];

    // Pre-load diagnosis pointers per BillingProcedureGuid
    const diagRows = (await this.loadFile(ctx, "superbillDiagnoses")) as PfSuperbillDiagnosisRow[];
    const diagByProc = new Map<string, string[]>();
    for (const row of diagRows) {
      const procGuid = row.BillingProcedureGuid;
      const code = emptyToNull(row.DiagnosisCode);
      if (!procGuid || !code) continue;
      if (!diagByProc.has(procGuid)) diagByProc.set(procGuid, []);
      if (!diagByProc.get(procGuid)!.includes(code)) diagByProc.get(procGuid)!.push(code);
    }

    // Pre-load superbill header → patient + encounter for bill resolution
    const headerRows = (await this.loadFile(ctx, "superbills")) as PfSuperbillRow[];
    const headerMap = new Map<string, { patGuid: string; encGuid: string | null }>();
    for (const row of headerRows) {
      if (row.BillingHeaderGuid && row.PatientPracticeGuid) {
        headerMap.set(row.BillingHeaderGuid, {
          patGuid: row.PatientPracticeGuid,
          encGuid: emptyToNull(row.EncounterGuid),
        });
      }
    }

    const rows = (await this.loadFile(ctx, "superbillProcedures")) as PfSuperbillProcedureRow[];
    let generated = 0;
    let skipped = 0;
    const orgId = ctx.config.organizationId;
    const orgIdExpr = `(SELECT id FROM organizations WHERE organization_id = ${sqlLiteral(orgId)} LIMIT 1)`;

    // Track sort order per bill (keyed by headerGuid)
    const sortOrders = new Map<string, number>();

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const headerGuid = row.BillingHeaderGuid;
      const procGuid = row.BillingProcedureGuid;
      const cptCode = emptyToNull(row.BillingCode);

      if (!headerGuid || !cptCode) { skipped++; continue; }

      const header = headerMap.get(headerGuid);
      if (!header) { skipped++; continue; }

      const { patGuid, encGuid } = header;

      const billIdExpr = encGuid
        ? `(SELECT b.id FROM bills b JOIN patient p ON b.patient_id = p.id JOIN patient_visits pv ON b.visit_id = pv.id WHERE p.third_party_id = ${sqlLiteral(patGuid)} AND pv.third_party_id = ${sqlLiteral(encGuid)} AND b.organization_id = ${orgIdExpr} LIMIT 1)`
        : `(SELECT b.id FROM bills b JOIN patient p ON b.patient_id = p.id WHERE p.third_party_id = ${sqlLiteral(patGuid)} AND b.visit_id IS NULL AND b.organization_id = ${orgIdExpr} LIMIT 1)`;

      const quantity = parseQuantity(row.Quantity);
      const unitCharge = parseFloat2(row.Amount);
      const totalCharge = unitCharge * quantity;
      const diagPointers = procGuid ? (diagByProc.get(procGuid) ?? []) : [];

      const sortOrder = (sortOrders.get(headerGuid) ?? 0);
      sortOrders.set(headerGuid, sortOrder + 1);

      this.emit(ctx, {
        table: "bill_services",
        data: {
          bill_id: raw(billIdExpr),
          cpt_code: cptCode,
          description: emptyToNull(row.Description),
          units: quantity,
          unit_charge: unitCharge,
          total_charge: totalCharge,
          diagnosis_pointers: diagPointers,
          modifiers: [],
          status: "unposted",
          sort_order: sortOrder,
          created_at: raw("NOW()"),
          updated_at: raw("NOW()"),
        },
        conflictColumns: ["bill_id", "cpt_code"],
        updateColumns: ["description", "units", "unit_charge", "total_charge", "diagnosis_pointers", "updated_at"],
        useExistsCheck: true,
        comment: `Bill service: ${cptCode} for ${headerGuid}`,
      });
      generated++;
    }

    return this.result(rows.length, generated, skipped, errors);
  }
}
