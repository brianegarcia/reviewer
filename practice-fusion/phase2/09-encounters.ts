import PatientVisit from "@models/patient_visit.model";
import VisitType from "@models/visit_type.model";
import { TranscriptStatusEnum } from "@utils/enum";
import { VisitStatusEnum } from "@models/types/patient_visit.model.type";
import { ORGANIZATION_ID, TSV_FILES, BATCH_SIZE, DEFAULT_VISIT_TIME } from "../config";
import { parseTsvBatched } from "../lib/tsv-parser";
import { IdMap } from "../lib/id-map";
import { logger } from "../lib/logger";
import { parseDateString, parseDate, emptyToNull } from "../lib/validators";
import { getSequelize } from "../lib/db";

// Mapping of Practice Fusion chart note types to SubQDocs visit type names
const CHART_NOTE_TYPE_MAPPING: Record<string, string> = {
    "General Visit": "General",
    "New Patient / Skin Check": "Evaluation of Skin Lesion",
    "Mole / Spot Exam": "Evaluation of Skin Lesion",
    "Follow Up Chief Complaint": "Follow-up Visit",
    "FOLLOW UP CHIEF COMPLAINT": "Follow-up Visit",
    "Rash / Allergy": "Rash",
    "Vitiligo Evaluation": "Discoloration (Vitiligo)",
    "Pigmentation / Melasma": "Discoloration (Hyperigmentation / Melasma)",
    "Skin Cancer Screening": "Skin Cancer Screening (Full Body Skin Exam)",
};

const CTX = "phase2/encounters";

async function buildVisitTypeLookup(): Promise<{ nameToId: Map<string, number>; defaultId: number | null }> {
    const visitTypes = await VisitType.findAll({
        where: { organization_id: ORGANIZATION_ID, is_deleted: false },
        attributes: ["id", "name", "is_default"],
    });

    const nameToId = new Map<string, number>();
    let defaultId: number | null = null;

    for (const vt of visitTypes) {
        nameToId.set(vt.name, vt.id);
        if (vt.is_default) defaultId = vt.id;
    }

    // Add reverse mappings so raw ChartNoteType values resolve too
    for (const [oldName, newName] of Object.entries(CHART_NOTE_TYPE_MAPPING)) {
        const id = nameToId.get(newName);
        if (id && !nameToId.has(oldName)) {
            nameToId.set(oldName, id);
        }
    }

    return { nameToId, defaultId };
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

    const { nameToId: visitTypeLookup, defaultId: defaultVisitTypeId } = await buildVisitTypeLookup();
    logger.info(CTX, `Loaded ${visitTypeLookup.size} visit type mappings (default id: ${defaultVisitTypeId})`);

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
                    visit_time: new Date(`${visitDate}T${DEFAULT_VISIT_TIME}`),
                    status: TranscriptStatusEnum.SUCCESS,
                    visit_status: VisitStatusEnum.FINALIZED,
                    doctor_id: doctorId,
                    organization_id: ORGANIZATION_ID,
                    office_location_id: facilityId,
                    visit_notes: emptyToNull(row.ChiefComplaint),
                    visit_type_id: visitTypeLookup.get(row.ChartNoteType) ?? defaultVisitTypeId,
                    data_source: "local",
                    keep_transcript: false,
                    finalized_at: finalizedAt,
                    finalized_by: doctorId,
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
