import PatientDiagnosisTimeline from "@models/patient_diagnosis_timeline.model";
import { TSV_FILES } from "../config";
import { parseTsvFile } from "../lib/tsv-parser";
import { IdMap } from "../lib/id-map";
import { logger } from "../lib/logger";
import { extractIcd10, parseDateString, emptyToNull } from "../lib/validators";

const CTX = "phase2/diagnoses";

interface DiagnosisEntry {
    code: string;
    name: string;
    coding_system: string;
    start_date: string | null;
    end_date: string | null;
    acuity: string;
    pf_diagnosis_guid: string;
}

export async function importDiagnoses(patientMap: IdMap): Promise<void> {
    logger.info(CTX, "Starting diagnoses import...");

    // Read all diagnoses
    const diagRows = await parseTsvFile(TSV_FILES.patientDiagnoses);
    logger.info(CTX, `Found ${diagRows.length} diagnosis records`);

    // Group diagnoses by patient
    const patientDiagnoses = new Map<number, DiagnosisEntry[]>();

    let parsed = 0;
    let skipped = 0;

    for (const row of diagRows) {
        const patientId = patientMap.get(row.PatientPracticeGuid || "");
        if (!patientId) {
            skipped++;
            continue;
        }

        const diagName = emptyToNull(row.Diagnosis) || "Unknown";
        const icd10 = extractIcd10(row.DiagnosisCodeEquivalents);
        const code = icd10?.code || "";

        const entry: DiagnosisEntry = {
            code,
            name: diagName,
            coding_system: code ? "ICD-10" : "Unknown",
            start_date: parseDateString(row.StartDate),
            end_date: parseDateString(row.StopDate),
            acuity: emptyToNull(row.DiagnosisAcuity) || "Unspecified",
            pf_diagnosis_guid: row.DiagnosisGuid || "",
        };

        if (!patientDiagnoses.has(patientId)) {
            patientDiagnoses.set(patientId, []);
        }
        patientDiagnoses.get(patientId)!.push(entry);
        parsed++;
    }

    logger.info(CTX, `Parsed ${parsed} diagnoses for ${patientDiagnoses.size} patients (${skipped} skipped)`);

    // Upsert diagnosis timeline per patient
    let imported = 0;
    let errored = 0;

    for (const [patientId, diagnoses] of patientDiagnoses) {
        try {
            const existing = await PatientDiagnosisTimeline.findOne({
                where: { patient_id: patientId },
            });

            if (existing) {
                await existing.update({ diagnosis_timeline: diagnoses } as any);
            } else {
                await PatientDiagnosisTimeline.create({
                    patient_id: patientId,
                    diagnosis_timeline: diagnoses,
                } as any);
            }
            imported++;
        } catch (err: any) {
            logger.error(CTX, `Patient ${patientId}: ${err.message}`);
            errored++;
        }
    }

    logger.summary(CTX, {
        imported,
        updated: 0,
        skipped,
        errored,
        total: diagRows.length,
    });
}
