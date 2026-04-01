import PatientVisit from "@models/patient_visit.model";
import FullNote from "@models/full_note.model";
import { TranscriptStatusEnum } from "@utils/enum";
import { VisitStatusEnum } from "@models/types/patient_visit.model.type";
import { ORGANIZATION_ID, TSV_FILES, BATCH_SIZE, DEFAULT_VISIT_TIME } from "../config";
import { parseTsvBatched } from "../lib/tsv-parser";
import { IdMap } from "../lib/id-map";
import { logger } from "../lib/logger";
import { cleanPfHtml, parseDateString, parseDate, emptyToNull } from "../lib/validators";
import { getSequelize } from "../lib/db";

const CTX = "phase2/encounters";

function buildNoteHtml(subjective: string, objective: string, assessment: string, plan: string): string {
    const parts: string[] = [];
    if (subjective) parts.push(`<h3>Subjective</h3>${subjective}`);
    if (objective) parts.push(`<h3>Objective</h3>${objective}`);
    if (assessment) parts.push(`<h3>Assessment</h3>${assessment}`);
    if (plan) parts.push(`<h3>Plan</h3>${plan}`);
    return parts.join("\n") || "";
}

export async function importEncounters(
    patientMap: IdMap,
    providerMap: IdMap,
    facilityMap: IdMap
): Promise<IdMap> {
    const encounterMap = new IdMap("encounter-map");
    logger.info(CTX, "Starting encounters import...");

    const stats = { imported: 0, updated: 0, skipped: 0, errored: 0, total: 0 };
    const sequelize = getSequelize();

    const totalRows = await parseTsvBatched(TSV_FILES.patientEncounters, BATCH_SIZE, async (batch, batchIndex) => {
        for (const row of batch) {
            const encounterGuid = row.EncounterGuid;
            if (!encounterGuid) {
                stats.skipped++;
                continue;
            }

            // Skip if already imported
            if (encounterMap.has(encounterGuid)) {
                stats.updated++;
                continue;
            }

            const patientId = patientMap.get(row.PatientPracticeGuid || "");
            if (!patientId) {
                stats.skipped++;
                continue;
            }

            const visitDate = parseDateString(row.DateOfService);
            if (!visitDate) {
                logger.warn(CTX, `Encounter ${encounterGuid}: invalid DateOfService "${row.DateOfService}", skipping`);
                stats.skipped++;
                continue;
            }

            const doctorId = providerMap.get(row.SignedByProviderGuid || "") ||
                             providerMap.get(row.SeenByProviderGuid || "") || null;
            const facilityId = facilityMap.get(row.FacilityGuid || "") || null;
            const finalizedAt = parseDate(row.SignedDateTimeUtc);

            const transaction = await sequelize.transaction();
            try {
                // 1. Create patient_visit
                const visit = await PatientVisit.create({
                    third_party_id: encounterGuid,
                    patient_id: patientId,
                    visit_date: visitDate,
                    visit_time: new Date(`${visitDate}T00:00:00`),
                    status: TranscriptStatusEnum.SUCCESS,
                    visit_status: VisitStatusEnum.FINALIZED,
                    doctor_id: doctorId,
                    organization_id: ORGANIZATION_ID,
                    office_location_id: facilityId,
                    visit_notes: emptyToNull(row.ChiefComplaint),
                    visit_type: emptyToNull(row.ChartNoteType),
                    data_source: "local",
                    keep_transcript: false,
                    finalized_at: finalizedAt,
                    finalized_by: doctorId,
                } as any, { transaction });

                // 2. Create full_note (notes table doesn't exist in DB)
                const subjective = cleanPfHtml(row.Subjective);
                const objective = cleanPfHtml(row.Objective);
                const assessment = cleanPfHtml(row.Assessment);
                const plan = cleanPfHtml(row.Plan);
                await FullNote.create({
                    patient_id: patientId,
                    visit_id: visit.id,
                    visit_date: visitDate,
                    status: TranscriptStatusEnum.SUCCESS,
                    version: 1,
                    is_current: true,
                    full_note_details: {
                        subjective: subjective || "",
                        objective: objective || "",
                        assessment: assessment || "",
                        plan: plan || "",
                        chiefComplaint: emptyToNull(row.ChiefComplaint) || "",
                        snapshotDiagnosis: emptyToNull(row.SnapshotDiagnosis) || "",
                        snapshotMedications: emptyToNull(row.SnapshotMedications) || "",
                    },
                } as any, { transaction });

                await transaction.commit();
                encounterMap.set(encounterGuid, visit.id);
                stats.imported++;
            } catch (err: any) {
                await transaction.rollback();
                logger.error(CTX, `Encounter ${encounterGuid}: ${err.message}`);
                stats.errored++;
            }
        }

        // Save map periodically
        if (batchIndex % 5 === 0) encounterMap.save();
        logger.info(CTX, `Batch ${batchIndex}: processed (${stats.imported} imported so far)`);
    });

    stats.total = totalRows;
    encounterMap.save();
    logger.summary(CTX, stats);
    return encounterMap;
}
