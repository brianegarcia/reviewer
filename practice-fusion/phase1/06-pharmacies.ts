import PatientPharmacy from "@models/patient-pharmacy.model";
import { TSV_FILES, BATCH_SIZE } from "../config";
import { parseTsvFile, TsvRow } from "../lib/tsv-parser";
import { IdMap } from "../lib/id-map";
import { logger } from "../lib/logger";
import { emptyToNull, truncate } from "../lib/validators";
import { getSequelize } from "../lib/db";

const CTX = "phase1/pharmacies";

export async function importPharmacies(patientMap: IdMap): Promise<void> {
    logger.info(CTX, "Starting pharmacies import...");

    // Build pharmacy lookup from pharmacies.tsv
    const pharmacyRows = await parseTsvFile(TSV_FILES.pharmacies);
    const pharmacyLookup = new Map<string, TsvRow>();
    for (const row of pharmacyRows) {
        if (row.PharmacyGuid) {
            pharmacyLookup.set(row.PharmacyGuid, row);
        }
    }
    logger.info(CTX, `Loaded ${pharmacyLookup.size} pharmacies into lookup`);

    // Read preferred-pharmacy links
    const prefRows = await parseTsvFile(TSV_FILES.preferredPharmacy);
    logger.info(CTX, `Found ${prefRows.length} patient-pharmacy links`);

    // Pre-load existing pharmacies to check duplicates
    const sequelize = getSequelize();
    const [existingPharmacies] = await sequelize.query(
        `SELECT patient_id, name FROM patient_pharmacies WHERE deleted_at IS NULL`
    ) as [any[], unknown];
    const existingSet = new Set(
        existingPharmacies.map((r: any) => `${r.patient_id}|${r.name}`)
    );
    logger.info(CTX, `Loaded ${existingSet.size} existing pharmacy records`);

    // Track first pharmacy per patient for isPrimary
    const patientFirstPharmacy = new Set<number>();
    const stats = { imported: 0, updated: 0, skipped: 0, errored: 0, total: prefRows.length };

    // Process in batches
    for (let i = 0; i < prefRows.length; i += BATCH_SIZE) {
        const batch = prefRows.slice(i, i + BATCH_SIZE);
        const mappedRows: Record<string, any>[] = [];

        for (const row of batch) {
            const patientId = patientMap.get(row.PatientPracticeGuid || "");
            if (!patientId) {
                stats.skipped++;
                continue;
            }

            const pharmacy = pharmacyLookup.get(row.PharmacyGuid || "");
            if (!pharmacy) {
                stats.skipped++;
                continue;
            }

            const name = emptyToNull(pharmacy.PharmacyName);
            const addressLine1 = emptyToNull(pharmacy.Address1);
            const city = emptyToNull(pharmacy.City);
            const state = emptyToNull(pharmacy.State);
            const zip = emptyToNull(pharmacy.ZipCode);

            // All required fields for PatientPharmacy
            if (!name || !addressLine1 || !city || !state || !zip) {
                stats.skipped++;
                continue;
            }

            const key = `${patientId}|${truncate(name, 255)}`;
            if (existingSet.has(key)) {
                stats.updated++;
                continue;
            }
            existingSet.add(key);

            const isPrimary = !patientFirstPharmacy.has(patientId);
            if (isPrimary) patientFirstPharmacy.add(patientId);

            mappedRows.push({
                patientId,
                name: truncate(name, 255),
                addressLine1: truncate(addressLine1, 255),
                city: truncate(city, 100),
                state: truncate(state, 50),
                zip: truncate(zip, 20),
                phone: truncate(emptyToNull(pharmacy.OfficePhone), 20),
                fax: truncate(emptyToNull(pharmacy.OfficeFax), 20),
                npi: pharmacy.NCPDP ? parseInt(pharmacy.NCPDP, 10) || null : null,
                isPrimary,
            });
        }

        if (mappedRows.length === 0) continue;

        const transaction = await sequelize.transaction();
        try {
            await PatientPharmacy.bulkCreate(mappedRows as any[], { transaction });
            await transaction.commit();
            stats.imported += mappedRows.length;
        } catch (err: any) {
            await transaction.rollback();
            logger.error(CTX, `Batch ${Math.floor(i / BATCH_SIZE)} failed: ${err.message}`);

            // Fallback to individual inserts
            for (const row of mappedRows) {
                try {
                    await PatientPharmacy.create(row as any);
                    stats.imported++;
                } catch (innerErr: any) {
                    logger.error(CTX, `Pharmacy for patient ${row.patientId}: ${innerErr.message}`);
                    stats.errored++;
                }
            }
        }
    }

    logger.summary(CTX, stats);
}
