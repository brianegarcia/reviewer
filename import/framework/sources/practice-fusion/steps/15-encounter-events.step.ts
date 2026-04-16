/**
 * Step 15 – Encounter Events → full_note.full_note_details.exam (HTML)
 *
 * Changes in "fix: general fixes":
 *   - Output changed from raw JSON ({ vitals: [...], encounterEvents: [...] })
 *     to a single HTML string stored in full_note_details.exam.
 *   - VitalSign: removed `code` and `units` fields.
 *   - EventEntry: removed `guid` and `vitalSignCode` fields.
 *   - HTML built with wrapHtml() for consistent Poppins styling.
 *   - Uses jsonb_set (not ||) so re-runs overwrite rather than corrupt.
 */

import { PipelineContext, StepResult, ValidationError } from "../../../core/types";
import { BasePfStep } from "./base.step";
import { PfEncounterEventRow } from "../types";
import { emptyToNull } from "../../../shared/validators";
import { wrapHtml } from "../../../shared/html-helpers";
import { sqlLiteral } from "../../../core/sql-builder";
import { getPfExtra } from "../config";

interface VitalSign {
  name: string;
  value: string;
  date: string | null;
}

interface EventEntry {
  name: string;
  description: string;
  category: string;
  status: string;
  value: string | null;
  comments: string | null;
  date: string | null;
}

function buildVitalsHtml(vitals: VitalSign[]): string {
  const items = vitals
    .map((v) => `<li><strong>${v.name}:</strong> ${v.value}</li>`)
    .join("");
  return `<p><strong>Vitals:</strong></p><ul>${items}</ul>`;
}

function buildEventsHtml(events: EventEntry[]): string {
  const items = events
    .map((e) => {
      let detail = e.name;
      if (e.description) detail += ` &mdash; ${e.description}`;
      const meta: string[] = [];
      if (e.category) meta.push(`Category: ${e.category}`);
      if (e.status) meta.push(`Status: ${e.status}`);
      if (e.value) meta.push(`Value: ${e.value}`);
      if (meta.length > 0) detail += ` (${meta.join(", ")})`;
      if (e.comments) detail += `<br/><em>${e.comments}</em>`;
      return `<li>${detail}</li>`;
    })
    .join("");
  return `<p><strong>Encounter Events:</strong></p><ul>${items}</ul>`;
}

export class EncounterEventsStep extends BasePfStep {
  readonly name = "15-encounter-events";
  readonly phase = 3;

  async execute(ctx: PipelineContext): Promise<StepResult> {
    const errors: ValidationError[] = [];
    const batchSize = getPfExtra(ctx.config).batchSize;

    const vitalsByEnc = new Map<string, VitalSign[]>();
    const eventsByEnc = new Map<string, EventEntry[]>();
    let totalRows = 0;

    await this.loadBatched(ctx, "patientEncounterEvents", batchSize, async (batch: PfEncounterEventRow[]) => {
      for (const row of batch) {
        totalRows++;
        const encGuid = row.EncounterGuid;
        if (!encGuid) continue;

        const vitalCode = emptyToNull(row.VitalSignCode);
        const value = emptyToNull(row.ResultValue);

        if (vitalCode && value) {
          if (!vitalsByEnc.has(encGuid)) vitalsByEnc.set(encGuid, []);
          vitalsByEnc.get(encGuid)!.push({
            name: emptyToNull(row.EventName) ?? vitalCode,
            value,
            date: emptyToNull(row.StartDateTimeUtc),
          });
        } else {
          if (!eventsByEnc.has(encGuid)) eventsByEnc.set(encGuid, []);
          eventsByEnc.get(encGuid)!.push({
            name: emptyToNull(row.EventName) ?? "",
            description: emptyToNull(row.EventDescription) ?? "",
            category: emptyToNull(row.EventCategory) ?? "",
            status: emptyToNull(row.StatusDescription) ?? "",
            value,
            comments: emptyToNull(row.EventComments),
            date: emptyToNull(row.StartDateTimeUtc),
          });
        }
      }
    });

    let generated = 0;
    let skipped = 0;
    const allGuids = new Set([...vitalsByEnc.keys(), ...eventsByEnc.keys()]);

    for (const encGuid of allGuids) {
      const vitals = vitalsByEnc.get(encGuid);
      const events = eventsByEnc.get(encGuid);

      let innerHtml = "";
      if (vitals && vitals.length > 0) innerHtml += buildVitalsHtml(vitals);
      if (events && events.length > 0) innerHtml += buildEventsHtml(events);

      if (!innerHtml) { skipped++; continue; }

      const examHtml = wrapHtml(innerHtml);
      const visitIdExpr = `(SELECT id FROM patient_visits WHERE third_party_id = ${sqlLiteral(encGuid)} LIMIT 1)`;
      const examJson = JSON.stringify(examHtml).replace(/'/g, "''");

      this.emit(ctx, {
        sql: [
          `-- Encounter events (exam HTML) for: ${encGuid}`,
          `UPDATE full_note`,
          `SET`,
          `  full_note_details = jsonb_set(`,
          `    COALESCE(full_note_details::jsonb, '{}'::jsonb),`,
          `    '{exam}'::text[],`,
          `    '${examJson}'::jsonb,`,
          `    true`,
          `  ),`,
          `  updated_at = NOW()`,
          `WHERE visit_id = ${visitIdExpr}`,
          `  AND is_current = true AND deleted_at IS NULL;`,
        ].join("\n"),
      });
      generated++;
    }

    return this.result(totalRows, generated, skipped, errors);
  }
}
