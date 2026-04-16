import VisitType from "@models/visit_type.model";
import { ORGANIZATION_ID } from "../config";
import { logger } from "../lib/logger";

const CTX = "phase3/visit-types";

const VISIT_TYPES = [
    "Follow-up Visit",
    "General",
    "Evaluation of Skin Lesion",
    "Acne Evaluation",
    "Rash",
    "Hair Loss (Alopecia)",
    "Warts (Verruca)",
    "Molluscum",
    "Skin Infection",
    "Cosmetic Treatment",
    "Skin Cancer Screening (Full Body Skin Exam)",
    "Discoloration (Vitiligo)",
    "Discoloration (Hyperigmentation / Melasma)",
    "Nail Disorder",
];

export async function importVisitTypes(): Promise<void> {
    logger.info(CTX, "Starting visit types import...");

    let imported = 0;
    let updated = 0;
    let errored = 0;

    for (let i = 0; i < VISIT_TYPES.length; i++) {
        const name = VISIT_TYPES[i];

        try {
            const existing = await VisitType.findOne({
                where: { name, organization_id: ORGANIZATION_ID },
            });

            if (existing) {
                logger.info(CTX, `Visit type "${name}" already exists (id=${existing.id})`);
                updated++;
                continue;
            }

            await VisitType.create({
                organization_id: ORGANIZATION_ID,
                name,
                is_active: true,
                is_visible_in_summary: true,
                display_order: i + 1,
                is_default: name === "General",
                is_deleted: false,
                default_duration: 15,
            } as any);

            imported++;
            logger.info(CTX, `Created visit type: "${name}"`);
        } catch (err: any) {
            logger.error(CTX, `Visit type "${name}": ${err.message}`);
            errored++;
        }
    }

    logger.summary(CTX, { imported, updated, skipped: 0, errored, total: VISIT_TYPES.length });
}
