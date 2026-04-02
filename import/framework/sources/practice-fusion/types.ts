/**
 * TypeScript interfaces matching every Practice Fusion TSV file column layout.
 *
 * These types represent the raw source data BEFORE normalisation.
 * Adapters/Mappers translate them into ImportRecord (domain model).
 *
 * All fields are string | null because TSV values are always strings and
 * Practice Fusion uses \N as the null sentinel (converted by the parser).
 */

import { SourceRow } from "../../shared/tsv-parser";

// Re-export for convenience
export { SourceRow };

// ─── Phase 1 ─────────────────────────────────────────────────────────────────

export interface PfFacilityRow extends SourceRow {
  FacilityGuid: string | null;
  Name: string | null;
  Address1: string | null;
  Address2: string | null;
  City: string | null;
  State: string | null;
  ZipCode: string | null;
  Phone: string | null;
  Fax: string | null;
  TimeZone: string | null;
}

export interface PfProviderRow extends SourceRow {
  ProviderGuid: string | null;
  FirstName: string | null;
  LastName: string | null;
  Title: string | null;
  Npi: string | null;
}

export interface PfProviderProfileRow extends SourceRow {
  ProfileGuid: string | null;
  FirstName: string | null;
  LastName: string | null;
}

export interface PfUserRow extends SourceRow {
  UserGuid: string | null;
  FirstName: string | null;
  LastName: string | null;
}

export interface PfPatientRow extends SourceRow {
  PatientPracticeGuid: string | null;
  FirstName: string | null;
  LastName: string | null;
  MiddleName: string | null;
  PreferredName: string | null;
  Gender: string | null;
  BirthDate: string | null;
  Address1: string | null;
  AddressCity: string | null;
  AddressState: string | null;
  AddressZipCode: string | null;
  AddressCountry: string | null;
  HomePhone: string | null;
  MobilePhone: string | null;
  OfficePhone: string | null;
  Email: string | null;
  SSN: string | null;
  UnPinnedNote: string | null;
  DeathDate: string | null;
  IsActive: string | null;
}

export interface PfPatientRaceRow extends SourceRow {
  PatientPracticeGuid: string | null;
  RaceName: string | null;
}

export interface PfPatientEthnicityRow extends SourceRow {
  PatientPracticeGuid: string | null;
  EthnicityName: string | null;
}

export interface PfPharmacyRow extends SourceRow {
  PharmacyGuid: string | null;
  PharmacyName: string | null;
  Address: string | null;
  City: string | null;
  State: string | null;
  ZipCode: string | null;
  Phone: string | null;
}

export interface PfPreferredPharmacyRow extends SourceRow {
  PatientPracticeGuid: string | null;
  PharmacyGuid: string | null;
}

// ─── Phase 2 ─────────────────────────────────────────────────────────────────

export interface PfEncounterRow extends SourceRow {
  EncounterGuid: string | null;
  PatientPracticeGuid: string | null;
  DateOfService: string | null;
  SignedByProviderGuid: string | null;
  SeenByProviderGuid: string | null;
  FacilityGuid: string | null;
  ChiefComplaint: string | null;
  ChartNoteType: string | null;
  Subjective: string | null;
  Objective: string | null;
  Assessment: string | null;
  Plan: string | null;
  SnapshotDiagnosis: string | null;
  SnapshotMedications: string | null;
  SignedDateTimeUtc: string | null;
}

export interface PfDiagnosisRow extends SourceRow {
  DiagnosisGuid: string | null;
  PatientPracticeGuid: string | null;
  Diagnosis: string | null;
  DiagnosisCodeEquivalents: string | null;
  DiagnosisAcuity: string | null;
  StartDate: string | null;
  StopDate: string | null;
}

export interface PfMedicationRow extends SourceRow {
  MedicationGuid: string | null;
  PatientPracticeGuid: string | null;
  MedicationName: string | null;
  Code: string | null;
  // Fields used by buildMedicationLookup (lookup-maps equivalent)
  ProductStrength: string | null;
  DoseForm: string | null;
  Route: string | null;
  Sig: string | null;
}

export interface PfPrescriptionRow extends SourceRow {
  PrescriptionGuid: string | null;
  PatientPracticeGuid: string | null;
  ProviderGuid: string | null;
  MedicationGuid: string | null;
  MedicationName: string | null;
  Dosage: string | null;
  Frequency: string | null;
  Instructions: string | null;
  WrittenDate: string | null;
  StartDate: string | null;
  StopDate: string | null;
  RefillsAllowed: string | null;
  // New fields used in prescriptions step
  PharmacyGuid: string | null;
  NoteToPharmacy: string | null;
  ControlledSubstanceSchedule: string | null;
  Ndc: string | null;
  GenericName: string | null;
}

export interface PfLabOrderRow extends SourceRow {
  OrderGuid: string | null;
  PatientPracticeGuid: string | null;
  OrderingProviderProfileGuid: string | null;
  OrderNumber: string | null;
  LabType: string | null;
  PaymentPreferenceType: string | null;
  OrderStatus: string | null;
  Note: string | null;
  // New fields added in fix commit
  EncounterGuid: string | null;
  FacilityGuid: string | null;
  FutureOrderDateTimeUtc: string | null;
  LastModifiedDateTimeUtc: string | null;
}

export interface PfLabOrderItemRow extends SourceRow {
  OrderGuid: string | null;
  Code: string | null;
  LoincCode: string | null;
  Name: string | null;
  LabGuid: string | null;
}

export interface PfLabResultRow extends SourceRow {
  ResultGuid: string | null;
  OrderGuid: string | null;
  LabName: string | null;
  CollectionDate: string | null;
}

export interface PfLabResultObservationRow extends SourceRow {
  ResultGuid: string | null;
  TestName: string | null;
  Observation: string | null;
  Result: string | null;
  Units: string | null;
  ReferencesRange: string | null;
  Status: string | null;
  LoincCode: string | null;
  FlagCode: string | null;
}

// ─── Phase 3 ─────────────────────────────────────────────────────────────────

export interface PfEncounterEventRow extends SourceRow {
  EncounterGuid: string | null;
  EncounterEventGuid: string | null;
  EventName: string | null;
  EventDescription: string | null;
  EventCategory: string | null;
  ResultValue: string | null;
  StartDateTimeUtc: string | null;
  StatusDescription: string | null;
  VitalSignCode: string | null;
  EventComments: string | null;
}

export interface PfEncounterDiagnosisRow extends SourceRow {
  EncounterGuid: string | null;
  DiagnosisGuid: string | null;
}

export interface PfEncounterAddendumRow extends SourceRow {
  EncounterAddendumGuid: string | null;
  EncounterGuid: string | null;
  // Columns as used by the actual import logic (17-encounter-addendums)
  Addendum: string | null;
  AmendmentStatus: string | null;
  AmendmentSource: string | null;
  LastModifiedByProviderGuid: string | null;
}

export interface PfEncounterObservationRow extends SourceRow {
  EncounterObservationGuid: string | null;
  EncounterGuid: string | null;
  // Columns as used by the actual import logic (18-encounter-observations)
  ObservationCode: string | null;
  ObservationCodeSystem: string | null;
  UnitOfObservation: string | null;
  Value: string | null;
  Comment: string | null;
}

export interface PfEncounterMedicationRow extends SourceRow {
  EncounterGuid: string | null;
  MedicationGuid: string | null;
}

export interface PfHealthConcernRow extends SourceRow {
  PatientPracticeGuid: string | null;
  HealthConcernType: string | null;
  HealthConcernNote: string | null;
  IsActive: string | null;
  StartDate: string | null;
  DiagnosisGuid: string | null;
}

export interface PfMedHistoryRow extends SourceRow {
  PatientPracticeGuid: string | null;
  MedHistoryEntry: string | null;
  EntryDate: string | null;
}

export interface PfPatientConditionRow extends SourceRow {
  PatientPracticeGuid: string | null;
  ConditionName: string | null;
  IsActive: string | null;
  OnsetDate: string | null;
}

export interface PfPinnedNoteRow extends SourceRow {
  PatientPracticeGuid: string | null;
  NoteText: string | null;
  CreatedDate: string | null;
}

export interface PfLabResultNoteRow extends SourceRow {
  OrderGuid: string | null;
  ResultNote: string | null;
}

export interface PfLabResultObservationNoteRow extends SourceRow {
  ObservationGuid: string | null;
  NoteText: string | null;
}

export interface PfLabOrderItemDiagnosisRow extends SourceRow {
  OrderGuid: string | null;
  DiagnosisGuid: string | null;
}

// ─── Phase 4 ─────────────────────────────────────────────────────────────────

export interface PfLabRow extends SourceRow {
  LabGuid: string | null;
  DisplayName: string | null;
  LabName: string | null;
  CodePrefix: string | null;
  Address1: string | null;
  Address2: string | null;
  City: string | null;
  State: string | null;
  ZipCode: string | null;
}

export interface PfLabSpecimenRow extends SourceRow {
  SpecimenGuid: string | null;
  OrderGuid: string | null;
  SpecimenType: string | null;
  CollectionDate: string | null;
}

export interface PfLabResultDocumentRow extends SourceRow {
  DocumentGuid: string | null;
  OrderGuid: string | null;
  DocumentName: string | null;
  DocumentStorageGuid: string | null;
  DocumentDate: string | null;
}

export interface PfLabOrderDocumentRow extends SourceRow {
  DocumentGuid: string | null;
  OrderGuid: string | null;
  DocumentName: string | null;
  DocumentStorageGuid: string | null;
  DocumentDate: string | null;
}

export interface PfPatientDocumentRow extends SourceRow {
  DocumentStorageGuid: string | null;
  PatientPracticeGuid: string | null;
  DocumentName: string | null;
  DocumentType: string | null;
  Status: string | null;
  Comments: string | null;
  FileSizeBytes: string | null;
  OriginalFileExtension: string | null;
  DocumentDate: string | null;
  AssignedProviderGuid: string | null;
  LastModifiedDateTimeUtc: string | null;
  LastModifiedByUserGuid: string | null;
}

export interface PfSuperbillRow extends SourceRow {
  BillingHeaderGuid: string | null;
  PatientPracticeGuid: string | null;
  EncounterGuid: string | null;
  BillingStatus: string | null;
  PerformingProviderProfileGuid: string | null;
  PerformingFacilityGuid: string | null;
  LastModifiedDateTimeUtc: string | null;
}

export interface PfSuperbillDiagnosisRow extends SourceRow {
  BillingHeaderGuid: string | null;
  BillingProcedureGuid: string | null;
  DiagnosisCode: string | null;
  Description: string | null;
}

export interface PfSuperbillProcedureRow extends SourceRow {
  BillingProcedureGuid: string | null;
  BillingHeaderGuid: string | null;
  BillingCode: string | null;
  Description: string | null;
  Quantity: string | null;
  Amount: string | null;
  TotalAmount: string | null;
}
