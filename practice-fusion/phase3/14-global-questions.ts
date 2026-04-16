import GlobalQuestion from "@models/global_question.model";
import { ORGANIZATION_ID } from "../config";
import { logger } from "../lib/logger";

const CTX = "phase3/global-questions";

const QUESTIONS = [
    "What brings you in today?",
    "Do you have any other medical conditions (diabetes, psoriasis, etc.)?",
    "Are you currently taking any medications?",
    "Do you have any known allergies?",
    "Are you currently pregnant or breastfeeding?",
    "Do you have a history of skin cancer? If yes, what kind?",
    "Do you have a history of immunosuppression?",
    "Do you have a pacemaker?",
    "Do you have any joint replacements?",
];

export async function importGlobalQuestions(): Promise<void> {
    logger.info(CTX, "Starting global questions import...");

    let imported = 0;
    let updated = 0;
    let errored = 0;

    for (let i = 0; i < QUESTIONS.length; i++) {
        const text = QUESTIONS[i];

        try {
            const existing = await GlobalQuestion.findOne({
                where: { question_text: text, organization_id: ORGANIZATION_ID },
            });

            if (existing) {
                logger.info(CTX, `Question "${text}" already exists (id=${existing.id})`);
                updated++;
                continue;
            }

            await GlobalQuestion.create({
                organization_id: ORGANIZATION_ID,
                question_text: text,
                is_active: true,
                display_order: i + 1,
                is_default: true,
            } as any);

            imported++;
            logger.info(CTX, `Created question: "${text}"`);
        } catch (err: any) {
            logger.error(CTX, `Question "${text}": ${err.message}`);
            errored++;
        }
    }

    logger.summary(CTX, { imported, updated, skipped: 0, errored, total: QUESTIONS.length });
}
