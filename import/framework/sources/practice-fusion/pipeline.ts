/**
 * PracticeFusionPipeline
 *
 * Extends BaseImportPipeline (Template Method) and returns the ordered list
 * of all 33 Practice Fusion import steps.
 *
 * Registration with the ImporterRegistry happens at the bottom of this file
 * so that importing this module is sufficient to make "practice-fusion"
 * available in the registry.
 */

import fs from "fs";
import { BaseImportPipeline } from "../../core/pipeline";
import { ImportConfig, Logger, ImportStep } from "../../core/types";
import { ImporterRegistry } from "../../core/registry";
import { tsvPath, PfTsvKey } from "./config";

// Phase 1
import { OrganizationStep } from "./steps/01-organization.step";
import { FacilitiesStep } from "./steps/02-facilities.step";
import { ProvidersStep } from "./steps/03-providers.step";
import { PatientsStep } from "./steps/04-patients.step";
import { PatientDemographicsStep } from "./steps/05-patient-demographics.step";
import { PharmaciesStep } from "./steps/06-pharmacies.step";
import { UserOfficeLocationsStep } from "./steps/07-user-office-locations.step";
import { VisitTypesStep } from "./steps/13-visit-types.step";

// Phase 2
import { MedicationsStep } from "./steps/08-medications.step";
import { EncountersStep } from "./steps/09-encounters.step";
import { PrescriptionsStep } from "./steps/11-prescriptions.step";
import { LabOrdersStep } from "./steps/12-lab-orders.step";

// Phase 3
import { GlobalQuestionsStep } from "./steps/14-global-questions.step";
import { EncounterEventsStep } from "./steps/15-encounter-events.step";
import { EncounterDiagnosesStep } from "./steps/16-encounter-diagnoses.step";
import { EncounterAddendumsStep } from "./steps/17-encounter-addendums.step";
import { EncounterObservationsStep } from "./steps/18-encounter-observations.step";
import { EncounterMedicationsStep } from "./steps/19-encounter-medications.step";
import { HealthConcernsStep } from "./steps/20-health-concerns.step";
import { MedHistoryStep } from "./steps/21-med-history.step";
import { PatientConditionsStep } from "./steps/22-patient-conditions.step";
import { PinnedNotesStep } from "./steps/23-pinned-notes.step";
import { LabResultNotesStep } from "./steps/24-lab-result-notes.step";
import { LabOrderDiagnosesStep } from "./steps/25-lab-order-diagnoses.step";

// Phase 4
import { LabsStep } from "./steps/26-labs.step";
import { LabSpecimensStep } from "./steps/27-lab-specimens.step";
import { LabResultDocumentsStep } from "./steps/28-lab-result-documents.step";
import { LabOrderDocumentsStep } from "./steps/29-lab-order-documents.step";
import { PatientDocumentsStep } from "./steps/30-patient-documents.step";
import { SuperbillsStep } from "./steps/31-superbills.step";
import { SuperbillProceduresStep } from "./steps/32-superbill-procedures.step";
import { UpdateBillTotalsStep } from "./steps/33-update-bill-totals.step";

// ─── Phase filter flags ────────────────────────────────────────────────────────

export type PhaseSelection = "all" | 1 | 2 | 3 | 4 | number[];

// ─── Pipeline ─────────────────────────────────────────────────────────────────

export class PracticeFusionPipeline extends BaseImportPipeline {
  private readonly phases: PhaseSelection;

  constructor(config: ImportConfig, logger: Logger, phases: PhaseSelection = "all") {
    super(config, logger);
    this.phases = phases;
  }

  /** Pre-flight: verify required TSV files exist */
  protected override validate(config: ImportConfig): void {
    super.validate(config);

    // Check a representative set of critical files
    const required: PfTsvKey[] = [
      "patientDemographics",
      "patientEncounters",
    ];

    for (const key of required) {
      const fp = tsvPath(config, key);
      if (!fs.existsSync(fp)) {
        throw new Error(`Required source file not found: ${fp}`);
      }
    }
  }

  protected getSteps(): ImportStep[] {
    const all: ImportStep[] = [
      // Phase 1
      new OrganizationStep(),
      new FacilitiesStep(),
      new ProvidersStep(),
      new PatientsStep(),
      new PatientDemographicsStep(),
      new PharmaciesStep(),
      new UserOfficeLocationsStep(),
      new VisitTypesStep(),
      // Phase 2
      new MedicationsStep(),
      new EncountersStep(),
      new PrescriptionsStep(),
      new LabOrdersStep(),
      // Phase 3
      new GlobalQuestionsStep(),
      new EncounterEventsStep(),
      new EncounterDiagnosesStep(),
      new EncounterAddendumsStep(),
      new EncounterObservationsStep(),
      new EncounterMedicationsStep(),
      new HealthConcernsStep(),
      new MedHistoryStep(),
      new PatientConditionsStep(),
      new PinnedNotesStep(),
      new LabResultNotesStep(),
      new LabOrderDiagnosesStep(),
      // Phase 4
      new LabsStep(),
      new LabSpecimensStep(),
      new LabResultDocumentsStep(),
      new LabOrderDocumentsStep(),
      new PatientDocumentsStep(),
      new SuperbillsStep(),
      new SuperbillProceduresStep(),
      new UpdateBillTotalsStep(),
    ];

    if (this.phases === "all") return all;

    const selectedPhases = Array.isArray(this.phases) ? this.phases : [this.phases as number];
    return all.filter((step) => selectedPhases.includes(step.phase));
  }
}

// ─── Registry registration ─────────────────────────────────────────────────────

ImporterRegistry.register(
  "practice-fusion",
  (config, logger) => new PracticeFusionPipeline(config, logger)
);
