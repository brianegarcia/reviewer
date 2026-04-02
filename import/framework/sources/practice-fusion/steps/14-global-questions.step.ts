/**
 * Step 14 – Global Questions (Configuration)
 *
 * Inserts the standard global questions configuration used in intake forms.
 * Natural key: (question_key, organization_id)
 */

import { PipelineContext, StepResult, raw } from "../../../core/types";
import { BasePfStep } from "./base.step";
import { sqlLiteral } from "../../../core/sql-builder";

const GLOBAL_QUESTIONS = [
  { key: "chief_complaint", label: "Chief Complaint", type: "text", required: true },
  { key: "allergies", label: "Allergies", type: "text", required: false },
  { key: "current_medications", label: "Current Medications", type: "text", required: false },
  { key: "family_history", label: "Family History", type: "text", required: false },
  { key: "social_history", label: "Social History", type: "text", required: false },
  { key: "review_of_systems", label: "Review of Systems", type: "text", required: false },
];

export class GlobalQuestionsStep extends BasePfStep {
  readonly name = "14-global-questions";
  readonly phase = 3;

  async execute(ctx: PipelineContext): Promise<StepResult> {
    const orgId = ctx.config.organizationId;
    const orgIdExpr = `(SELECT id FROM organizations WHERE organization_id = ${sqlLiteral(orgId)} LIMIT 1)`;
    let generated = 0;

    for (const q of GLOBAL_QUESTIONS) {
      this.emit(ctx, {
        table: "global_questions",
        data: {
          organization_id: raw(orgIdExpr),
          question_text: q.label,
          is_active: true,
          display_order: GLOBAL_QUESTIONS.indexOf(q),
          is_default: q.required,
          created_at: raw("NOW()"),
          updated_at: raw("NOW()"),
        },
        conflictColumns: ["organization_id", "question_text"],
        updateColumns: ["is_active", "display_order", "updated_at"],
        useExistsCheck: true,
        comment: `Global question: ${q.key}`,
      });
      generated++;
    }

    return this.result(GLOBAL_QUESTIONS.length, generated, 0, []);
  }
}
