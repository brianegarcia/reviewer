import { v4 as uuidv4 } from "uuid";
import Patient from "@models/patient.model";
import { ORGANIZATION_ID, TSV_FILES, BATCH_SIZE } from "../config";
import { parseTsvBatched, TsvRow } from "../lib/tsv-parser";
import { IdMap } from "../lib/id-map";
import { logger } from "../lib/logger";
import { mapGender, parseDateString, emptyToNull, truncate } from "../lib/validators";
import { getSequelize } from "../lib/db";

const CTX = "phase1/patients";

function calculateAge(birthDate: string | null): number | null {
    if (!birthDate) return null;
    const birth = new Date(birthDate);
    const today = new Date();
    let age = today.getFullYear() - birth.getFullYear();
    const monthDiff = today.getMonth() - birth.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
        age--;
    }
    return age;
}

function mapPatientRow(row: TsvRow): Record<string, any> | null {
    const firstName = emptyToNull(row.FirstName);
    const lastName = emptyToNull(row.LastName);

    if (!firstName || !lastName) return null;

    return {
        third_party_id: row.PatientPracticeGuid,
        patient_id: uuidv4(),
        organization_id: ORGANIZATION_ID,
        first_name: truncate(firstName, 100),
        last_name: truncate(lastName, 100),
        middle_name: emptyToNull(row.MiddleName),
        preferred_name: truncate(emptyToNull(row.PreferredName), 100),
        gender: mapGender(row.Gender),
        date_of_birth: parseDateString(row.BirthDate),
        age: row.BirthDate ? calculateAge(parseDateString(row.BirthDate)) : null,
        street_address: emptyToNull(row.Address1),
        city: emptyToNull(row.AddressCity),
        state: emptyToNull(row.AddressState),
        zipcode: emptyToNull(row.AddressZipCode),
        country: row.AddressCountry === "United States of America" ? "US" : emptyToNull(row.AddressCountry),
        home_phone: truncate(emptyToNull(row.HomePhone), 20),
        cellphone: truncate(emptyToNull(row.MobilePhone), 20),
        contact_no: truncate(emptyToNull(row.OfficePhone), 15),
        email: emptyToNull(row.Email),
        ssn: emptyToNull(row.SSN),
        sticky_note: emptyToNull(row.UnPinnedNote),
        data_source: "local",
        existing_patient: true,
        is_deceased: row.DeathDate ? true : false,
    };
}

export async function importPatients(): Promise<IdMap> {
    const patientMap = new IdMap("patient-map");
    logger.info(CTX, "Starting patients import...");

    const stats = { imported: 0, updated: 0, skipped: 0, errored: 0, total: 0 };
    const sequelize = getSequelize();

    const totalRows = await parseTsvBatched(TSV_FILES.patientDemographics, BATCH_SIZE, async (batch, batchIndex) => {
        const mappedRows: Record<string, any>[] = [];

        for (const row of batch) {
            if (!row.PatientPracticeGuid) {
                stats.skipped++;
                continue;
            }

            // Skip if already in map (re-run)
            if (patientMap.has(row.PatientPracticeGuid)) {
                stats.updated++;
                continue;
            }

            // Check if already exists in DB
            const existing = await Patient.findOne({
                where: { third_party_id: row.PatientPracticeGuid, organization_id: ORGANIZATION_ID },
                paranoid: false,
            });
            if (existing) {
                patientMap.set(row.PatientPracticeGuid, existing.id);
                stats.updated++;
                continue;
            }

            const mapped = mapPatientRow(row);
            if (!mapped) {
                logger.warn(CTX, `Batch ${batchIndex}: Patient ${row.PatientPracticeGuid} missing first_name or last_name, skipping`);
                stats.skipped++;
                continue;
            }

            mappedRows.push(mapped);
        }

        if (mappedRows.length === 0) return;

        const transaction = await sequelize.transaction();
        try {
            const created = await Patient.bulkCreate(mappedRows as any[], {
                transaction,
                returning: true,
            });

            for (const patient of created) {
                if (patient.third_party_id) {
                    patientMap.set(patient.third_party_id, patient.id);
                }
            }

            await transaction.commit();
            stats.imported += created.length;
            logger.info(CTX, `Batch ${batchIndex}: ${created.length} patients imported`);
        } catch (err: any) {
            await transaction.rollback();
            logger.error(CTX, `Batch ${batchIndex} failed: ${err.message}`);

            // Fall back to individual inserts
            for (const row of mappedRows) {
                try {
                    const patient = await Patient.create(row as any);
                    if (patient.third_party_id) {
                        patientMap.set(patient.third_party_id, patient.id);
                    }
                    stats.imported++;
                } catch (innerErr: any) {
                    logger.error(CTX, `Patient ${row.third_party_id}: ${innerErr.message}`);
                    stats.errored++;
                }
            }
        }

        // Save map periodically
        if (batchIndex % 5 === 0) patientMap.save();
    });

    stats.total = totalRows;

    // Handle inactive patients with soft-delete after insert
    logger.info(CTX, "Soft-deleting inactive patients...");
    const allRows = await (await import("../lib/tsv-parser")).parseTsvFile(TSV_FILES.patientDemographics);
    let softDeleted = 0;
    for (const row of allRows) {
        if (row.IsActive === "False" && row.PatientPracticeGuid) {
            const patientId = patientMap.get(row.PatientPracticeGuid);
            if (patientId) {
                try {
                    await Patient.destroy({ where: { id: patientId } });
                    softDeleted++;
                } catch {
                    // Already deleted or doesn't exist
                }
            }
        }
    }
    logger.info(CTX, `Soft-deleted ${softDeleted} inactive patients`);

    patientMap.save();
    logger.summary(CTX, stats);
    return patientMap;
}
