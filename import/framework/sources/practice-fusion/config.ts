/**
 * Practice Fusion importer configuration.
 *
 * All TSV file names are declared here so steps never hard-code paths directly.
 * Paths are resolved relative to ImportConfig.sourceDir at runtime.
 */

import path from "path";
import { ImportConfig } from "../../core/types";

// ─── TSV file name registry ────────────────────────────────────────────────────

export const PF_TSV_FILES = {
  // Phase 1
  facilities:                   "facilities.tsv",
  providers:                    "providers.tsv",
  providerProfiles:             "provider-profiles.tsv",
  users:                        "users.tsv",
  patientDemographics:          "patient-demographics.tsv",
  patientRace:                  "patient-race.tsv",
  patientEthnicity:             "patient-ethnicity.tsv",
  pharmacies:                   "pharmacies.tsv",
  preferredPharmacy:            "preferred-pharmacy.tsv",
  // Phase 2
  patientEncounters:            "patient-encounters.tsv",
  patientDiagnoses:             "patient-diagnoses.tsv",
  patientMedications:           "patient-medications.tsv",
  patientPrescriptions:         "patient-prescriptions.tsv",
  patientLabOrders:             "patient-lab-orders.tsv",
  patientLabOrderItems:         "patient-lab-order-items.tsv",
  patientLabResults:            "patient-lab-results.tsv",
  patientLabResultObservations: "patient-lab-result-tests-observations.tsv",
  // Phase 3
  patientEncounterEvents:       "patient-encounter-events.tsv",
  patientEncounterDiagnoses:    "patient-encounter-diagnoses.tsv",
  patientEncounterAddendums:    "patient-encounter-addendums.tsv",
  patientEncounterObservations: "patient-encounter-observations.tsv",
  patientEncounterMedications:  "patient-encounter-medications.tsv",
  patientHealthConcerns:        "patient-health-concerns.tsv",
  patientMedHistory:            "patient-med-history.tsv",
  patientConditions:            "patient-conditions.tsv",
  pinnedNotes:                  "pinned-notes.tsv",
  labResultObservationNotes:    "lab-result-tests-observation-notes.tsv",
  patientLabResultNotes:        "patient-lab-result-notes.tsv",
  patientLabOrderItemDiagnoses: "patient-lab-order-item-diagnoses.tsv",
  // Phase 4
  labs:                         "labs.tsv",
  labOrderItemSpecimens:        "patient-lab-order-item-specimens.tsv",
  labResultDocuments:           "patient-lab-result-documents.tsv",
  labOrderDocuments:            "patient-lab-order-documents.tsv",
  patientDocuments:             "patient-documents.tsv",
  superbills:                   "patient-superbills.tsv",
  superbillDiagnoses:           "superbill-diagnosis.tsv",
  superbillProcedures:          "superbill-procedures.tsv",
} as const;

export type PfTsvKey = keyof typeof PF_TSV_FILES;

// ─── Practice Fusion extra config ─────────────────────────────────────────────

export interface PfExtra {
  [key: string]: unknown;
  /**
   * Map of ProviderGuid → email address.
   * Providers without an entry receive a generated placeholder email.
   */
  providerEmails?: Record<string, string>;
  /** Default password for imported provider user accounts (will be hashed on first login) */
  defaultPassword?: string;
  /** Default timezone for visits that have no facility timezone */
  defaultTimezone?: string;
  /** Default visit time (HH:MM:SS) */
  defaultVisitTime?: string;
  /** Batch size for streaming large TSV files */
  batchSize?: number;
}

export const PF_DEFAULTS: Required<PfExtra> = {
  providerEmails: {},
  defaultPassword: "ch4ng3me1234!",
  defaultTimezone: "America/Los_Angeles",
  defaultVisitTime: "00:00:00",
  batchSize: 500,
};

// ─── Config builder ────────────────────────────────────────────────────────────

export interface PfImportConfigInput {
  sourceDir: string;
  outputFile: string;
  organizationId: string;
  organizationName: string;
  extra?: PfExtra;
}

export function buildPfConfig(input: PfImportConfigInput): ImportConfig {
  return {
    sourceName: "Practice Fusion",
    sourceDir: path.resolve(input.sourceDir),
    outputFile: path.resolve(input.outputFile),
    organizationId: input.organizationId,
    organizationName: input.organizationName,
    batchSize: input.extra?.batchSize ?? PF_DEFAULTS.batchSize,
    extra: {
      ...PF_DEFAULTS,
      ...input.extra,
    } as PfExtra,
  };
}

/** Extract the PF-specific extra config from a generic ImportConfig */
export function getPfExtra(config: ImportConfig): Required<PfExtra> {
  return { ...PF_DEFAULTS, ...(config.extra as PfExtra) };
}

/** Resolve a TSV file path from an ImportConfig + TSV key */
export function tsvPath(config: ImportConfig, key: PfTsvKey): string {
  return path.join(config.sourceDir, PF_TSV_FILES[key]);
}
