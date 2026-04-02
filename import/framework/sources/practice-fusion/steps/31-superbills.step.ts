/**
 * Step 31 – Superbills → bills
 *
 * Practice Fusion superbills map to our `bills` table.
 *
 * Challenge: bill_readable_id must be sequential (BL-000001, BL-000002, …)
 * and must not collide with existing bills. This is solved with a PL/pgSQL
 * DO block that:
 *   1. Queries the current MAX bill sequence at execution time.
 *   2. Inserts each new bill with the next sequence number.
 *   3. Skips bills that already exist (patient + visit combination).
 *
 * Diagnoses per bill are pre-loaded from superbill-diagnosis.tsv and stored
 * as JSONB in bills.diagnoses.
 */

import { PipelineContext, StepResult, ValidationError } from "../../../core/types";
import { BasePfStep } from "./base.step";
import { PfSuperbillRow, PfSuperbillDiagnosisRow } from "../types";
import { emptyToNull, parseDateString } from "../../../shared/validators";
import { mapBillingStatus } from "../../../shared/utils";
import { sqlLiteral } from "../../../core/sql-builder";

interface BillRecord {
  headerGuid: string;
  patGuid: string;
  encGuid: string | null;
  provGuid: string | null;
  facGuid: string | null;
  status: string;
  diagnoses: { code: string; label: string }[];
  lastModified: string | null;
}

export class SuperbillsStep extends BasePfStep {
  readonly name = "31-superbills";
  readonly phase = 4;

  async execute(ctx: PipelineContext): Promise<StepResult> {
    const errors: ValidationError[] = [];

    // Pre-load diagnoses grouped by BillingHeaderGuid
    const diagRows = (await this.loadFile(ctx, "superbillDiagnoses")) as PfSuperbillDiagnosisRow[];
    const diagByBill = new Map<string, { code: string; label: string }[]>();
    for (const row of diagRows) {
      const hg = row.BillingHeaderGuid;
      const code = emptyToNull(row.DiagnosisCode);
      if (!hg || !code) continue;
      if (!diagByBill.has(hg)) diagByBill.set(hg, []);
      const existing = diagByBill.get(hg)!;
      if (!existing.some((d) => d.code === code)) {
        existing.push({ code, label: emptyToNull(row.Description) ?? code });
      }
    }

    const rows = (await this.loadFile(ctx, "superbills")) as PfSuperbillRow[];
    let skipped = 0;
    const bills: BillRecord[] = [];

    for (const row of rows) {
      const headerGuid = row.BillingHeaderGuid;
      const patGuid = row.PatientPracticeGuid;
      if (!headerGuid || !patGuid) { skipped++; continue; }

      bills.push({
        headerGuid,
        patGuid,
        encGuid: emptyToNull(row.EncounterGuid),
        provGuid: emptyToNull(row.PerformingProviderProfileGuid),
        facGuid: emptyToNull(row.PerformingFacilityGuid),
        status: mapBillingStatus(row.BillingStatus),
        diagnoses: diagByBill.get(headerGuid) ?? [],
        lastModified: emptyToNull(row.LastModifiedDateTimeUtc),
      });
    }

    if (bills.length === 0) {
      return this.result(rows.length, 0, skipped, errors);
    }

    const orgId = ctx.config.organizationId;
    const orgIdExpr = `(SELECT id FROM organizations WHERE organization_id = ${sqlLiteral(orgId)} LIMIT 1)`;

    // Build the DO block that inserts all bills sequentially
    // using a runtime counter to generate bill_readable_id
    const billCases = bills.map((b) => {
      const patIdExpr = `(SELECT id FROM patient WHERE third_party_id = ${sqlLiteral(b.patGuid)} LIMIT 1)`;
      const visitIdExpr = b.encGuid
        ? `(SELECT id FROM patient_visits WHERE third_party_id = ${sqlLiteral(b.encGuid)} LIMIT 1)`
        : "NULL";
      const provIdExpr = b.provGuid
        ? `(SELECT id FROM users WHERE third_party_id = ${sqlLiteral(b.provGuid)} AND organization_id = ${orgIdExpr} LIMIT 1)`
        : "NULL";
      const facIdExpr = b.facGuid
        ? `(SELECT id FROM office_locations WHERE external_id = ${sqlLiteral(b.facGuid)} LIMIT 1)`
        : "NULL";

      // dateOfService: try encounter visit_date first, fall back to lastModified
      const dosExpr = b.encGuid
        ? `COALESCE((SELECT visit_date FROM patient_visits WHERE third_party_id = ${sqlLiteral(b.encGuid)} LIMIT 1)::text, ${sqlLiteral(parseDateString(b.lastModified) ?? new Date().toISOString().split("T")[0])})`
        : sqlLiteral(parseDateString(b.lastModified) ?? new Date().toISOString().split("T")[0]);

      const diagJson = JSON.stringify(b.diagnoses).replace(/'/g, "''");

      return {
        headerGuid: b.headerGuid,
        patIdExpr,
        visitIdExpr,
        provIdExpr,
        facIdExpr,
        dosExpr,
        status: b.status,
        diagJson,
      };
    });

    // Generate a PL/pgSQL DO block for safe sequential bill ID generation
    const doLines = [
      `DO $$`,
      `DECLARE`,
      `  _seq INTEGER;`,
      `  _org_id INTEGER;`,
      `  _patient_id INTEGER;`,
      `  _visit_id INTEGER;`,
      `  _provider_id INTEGER;`,
      `  _facility_id INTEGER;`,
      `  _dos DATE;`,
      `  _created_by INTEGER;`,
      `BEGIN`,
      `  -- Resolve organization_id string to integer PK`,
      `  SELECT id INTO _org_id FROM organizations WHERE organization_id = ${sqlLiteral(orgId)} LIMIT 1;`,
      ``,
      `  -- Get current max bill sequence`,
      `  SELECT COALESCE(MAX(CAST(SUBSTRING(bill_readable_id FROM 4) AS INTEGER)), 0)`,
      `  INTO _seq`,
      `  FROM bills WHERE bill_readable_id ~ '^BL-\\d{6}$';`,
      ``,
      `  -- Fallback created_by: first user in org`,
      `  SELECT id INTO _created_by FROM users WHERE organization_id = _org_id ORDER BY id LIMIT 1;`,
      ``,
    ];

    for (const b of billCases) {
      doLines.push(
        `  -- Bill: ${b.headerGuid}`,
        `  _patient_id := ${b.patIdExpr};`,
        `  _visit_id   := ${b.visitIdExpr};`,
        `  _provider_id := COALESCE(${b.provIdExpr}, _created_by);`,
        `  _facility_id := ${b.facIdExpr};`,
        `  _dos := ${b.dosExpr}::date;`,
        ``,
        `  IF NOT EXISTS (`,
        `    SELECT 1 FROM bills`,
        `    WHERE patient_id = _patient_id`,
        `      AND (visit_id = _visit_id OR (visit_id IS NULL AND _visit_id IS NULL))`,
        `  ) THEN`,
        `    _seq := _seq + 1;`,
        `    INSERT INTO bills (`,
        `      bill_readable_id, organization_id, patient_id, visit_id,`,
        `      primary_provider_id, location_id, date_of_service, status,`,
        `      total_charges, balance, diagnoses, created_by, created_at, updated_at`,
        `    ) VALUES (`,
        `      'BL-' || LPAD(_seq::text, 6, '0'),`,
        `      _org_id,`,
        `      _patient_id, _visit_id, _provider_id, _facility_id, _dos,`,
        `      ${sqlLiteral(b.status)}, 0, 0, '${b.diagJson}'::jsonb,`,
        `      _created_by, NOW(), NOW()`,
        `    );`,
        `    -- Store header GUID for reference (register in a temp table if needed)`,
        `  END IF;`,
        ``
      );
    }

    doLines.push(`END $$;`);

    this.emit(ctx, {
      sql: doLines.join("\n"),
      comment: `Superbills: ${bills.length} records`,
    });

    return this.result(rows.length, bills.length, skipped, errors);
  }
}
