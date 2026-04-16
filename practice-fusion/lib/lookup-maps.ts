import { TSV_FILES } from "../config";
import { parseTsvFile } from "./tsv-parser";
import { emptyToNull } from "./validators";
import { logger } from "./logger";

export interface DiagnosisInfo {
    name: string;
    codes: string | null;
}

export interface MedicationInfo {
    name: string;
    strength: string | null;
    doseForm: string | null;
    route: string | null;
    sig: string | null;
}

/**
 * Builds a lookup map from DiagnosisGuid → diagnosis details
 * by parsing patient-diagnoses.tsv.
 */
export async function buildDiagnosisLookup(): Promise<Map<string, DiagnosisInfo>> {
    const map = new Map<string, DiagnosisInfo>();
    const rows = await parseTsvFile(TSV_FILES.patientDiagnoses);

    for (const row of rows) {
        const guid = row.DiagnosisGuid;
        if (!guid || map.has(guid)) continue;

        map.set(guid, {
            name: row.Diagnosis || "Unknown Diagnosis",
            codes: emptyToNull(row.DiagnosisCodeEquivalents),
        });
    }

    logger.info("lookup-maps", `Built diagnosis lookup: ${map.size} entries`);
    return map;
}

/**
 * Builds a lookup map from MedicationGuid → medication details
 * by parsing patient-medications.tsv.
 */
export async function buildMedicationLookup(): Promise<Map<string, MedicationInfo>> {
    const map = new Map<string, MedicationInfo>();
    const rows = await parseTsvFile(TSV_FILES.patientMedications);

    for (const row of rows) {
        const guid = row.MedicationGuid;
        if (!guid || map.has(guid)) continue;

        map.set(guid, {
            name: row.MedicationName || "Unknown Medication",
            strength: emptyToNull(row.ProductStrength),
            doseForm: emptyToNull(row.DoseForm),
            route: emptyToNull(row.Route),
            sig: emptyToNull(row.Sig),
        });
    }

    logger.info("lookup-maps", `Built medication lookup: ${map.size} entries`);
    return map;
}
