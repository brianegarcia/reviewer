import path from "path";

// ─── Practice Fusion Export Paths ───
export const PF_EXPORT_DIR = path.resolve(
    __dirname,
    "../../../resources/PracticeExport_88080e82-7440-4df0-b71a-d3e44c55b9fb_20260316_204443_1-20260325T125004Z-1-001/PracticeExport_88080e82-7440-4df0-b71a-d3e44c55b9fb_20260316_204443_1"
);

export const PF_BINARY_DIR = path.resolve(
    __dirname,
    "../../../resources/PracticeExport_88080e82-7440-4df0-b71a-d3e44c55b9fb_20260316_204443_2-20260331T171633Z-1-001/PracticeExport_88080e82-7440-4df0-b71a-d3e44c55b9fb_20260316_204443_2/binary-content"
);

// ─── ID Maps & Logs ───
export const ID_MAPS_DIR = path.resolve(__dirname, "id-maps");
export const LOGS_DIR = path.resolve(__dirname, "logs");

// ─── Organization Config ───
// This will be set after org creation in step 01
export let ORGANIZATION_ID: number = 0;
export const ORGANIZATION_NAME = "Omeed Ahadiat Dermatology";
export const ORGANIZATION_UUID = "dr-omi-dermatology"; // unique org identifier

export function setOrganizationId(id: number) {
    ORGANIZATION_ID = id;
}

// ─── Provider Emails (to be filled before running) ───
export const PROVIDER_EMAILS: Record<string, string> = {
    // Map ProviderGuid -> email. Fill before running the script.
    // "f15585dc-08c3-478b-bb78-fb12c52dcf66": "omeed@example.com",
};

// ─── Import Settings ───
export const BATCH_SIZE = 500;
export const DEFAULT_VISIT_TIME = "00:00:00";
export const DEFAULT_TIMEZONE = "America/Los_Angeles";
export const DEFAULT_PASSWORD = "ch4ng3me1234!";

// ─── TSV File Names ───
export const TSV_FILES = {
    facilities: "facilities.tsv",
    providers: "providers.tsv",
    providerProfiles: "provider-profiles.tsv",
    users: "users.tsv",
    patientDemographics: "patient-demographics.tsv",
    patientRace: "patient-race.tsv",
    patientEthnicity: "patient-ethnicity.tsv",
    patientEncounters: "patient-encounters.tsv",
    patientDiagnoses: "patient-diagnoses.tsv",
    patientMedications: "patient-medications.tsv",
    patientPrescriptions: "patient-prescriptions.tsv",
    patientLabOrders: "patient-lab-orders.tsv",
    patientLabOrderItems: "patient-lab-order-items.tsv",
    patientLabResults: "patient-lab-results.tsv",
    patientLabResultObservations: "patient-lab-result-tests-observations.tsv",
    pharmacies: "pharmacies.tsv",
    preferredPharmacy: "preferred-pharmacy.tsv",
    patientEncounterEvents: "patient-encounter-events.tsv",
    patientEncounterDiagnoses: "patient-encounter-diagnoses.tsv",
    patientEncounterAddendums: "patient-encounter-addendums.tsv",
    patientEncounterObservations: "patient-encounter-observations.tsv",
    patientEncounterMedications: "patient-encounter-medications.tsv",
    patientHealthConcerns: "patient-health-concerns.tsv",
    patientMedHistory: "patient-med-history.tsv",
    patientConditions: "patient-conditions.tsv",
    pinnedNotes: "pinned-notes.tsv",
    labResultObservationNotes: "lab-result-tests-observation-notes.tsv",
    patientLabResultNotes: "patient-lab-result-notes.tsv",
    patientLabOrderItemDiagnoses: "patient-lab-order-item-diagnoses.tsv",
    // Phase 4
    labs: "labs.tsv",
    labOrderItemSpecimens: "patient-lab-order-item-specimens.tsv",
    labResultDocuments: "patient-lab-result-documents.tsv",
    labOrderDocuments: "patient-lab-order-documents.tsv",
    patientDocuments: "patient-documents.tsv",
    superbills: "patient-superbills.tsv",
    superbillDiagnoses: "superbill-diagnosis.tsv",
    superbillProcedures: "superbill-procedures.tsv",
} as const;
