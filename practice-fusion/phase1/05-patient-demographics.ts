import Patient from "@models/patient.model";
import { TSV_FILES } from "../config";
import { parseTsvFile } from "../lib/tsv-parser";
import { IdMap } from "../lib/id-map";
import { logger } from "../lib/logger";
import { mapRace, mapEthnicity } from "../lib/validators";

const CTX = "phase1/demographics";

export async function importPatientDemographics(patientMap: IdMap): Promise<void> {
    logger.info(CTX, "Starting patient race & ethnicity import...");

    // ─── Race ───
    const raceRows = await parseTsvFile(TSV_FILES.patientRace);
    logger.info(CTX, `Found ${raceRows.length} race records`);

    let raceUpdated = 0;
    let raceSkipped = 0;

    for (const row of raceRows) {
        const patientId = patientMap.get(row.PatientPracticeGuid || "");
        if (!patientId) {
            raceSkipped++;
            continue;
        }

        const race = mapRace(row.RaceName);
        if (!race) {
            raceSkipped++;
            continue;
        }

        try {
            await Patient.update({ race } as any, { where: { id: patientId } });
            raceUpdated++;
        } catch (err: any) {
            logger.error(CTX, `Race update for patient ${patientId}: ${err.message}`);
        }
    }

    logger.info(CTX, `Race: ${raceUpdated} updated, ${raceSkipped} skipped`);

    // ─── Ethnicity ───
    const ethnicityRows = await parseTsvFile(TSV_FILES.patientEthnicity);
    logger.info(CTX, `Found ${ethnicityRows.length} ethnicity records`);

    let ethUpdated = 0;
    let ethSkipped = 0;

    for (const row of ethnicityRows) {
        const patientId = patientMap.get(row.PatientPracticeGuid || "");
        if (!patientId) {
            ethSkipped++;
            continue;
        }

        const ethnicity = mapEthnicity(row.EthnicityName);
        if (!ethnicity) {
            ethSkipped++;
            continue;
        }

        try {
            await Patient.update({ ethnicity } as any, { where: { id: patientId } });
            ethUpdated++;
        } catch (err: any) {
            logger.error(CTX, `Ethnicity update for patient ${patientId}: ${err.message}`);
        }
    }

    logger.info(CTX, `Ethnicity: ${ethUpdated} updated, ${ethSkipped} skipped`);
}
