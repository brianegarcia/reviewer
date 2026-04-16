/**
 * Step 05 – Patient Race & Ethnicity
 *
 * Updates the patients table to set race/ethnicity values.
 * Race and ethnicity come from separate TSV files; both reference PatientPracticeGuid.
 *
 * Natural key for update: patients.third_party_id = PatientPracticeGuid
 */

import { PipelineContext, StepResult, ValidationError } from "../../../core/types";
import { BasePfStep } from "./base.step";
import { PfPatientRaceRow, PfPatientEthnicityRow } from "../types";
import { mapRace, mapEthnicity } from "../../../shared/validators";
import { sqlLiteral } from "../../../core/sql-builder";

export class PatientDemographicsStep extends BasePfStep {
  readonly name = "05-patient-demographics";
  readonly phase = 1;

  async execute(ctx: PipelineContext): Promise<StepResult> {
    const errors: ValidationError[] = [];
    const raceRows = (await this.loadFile(ctx, "patientRace")) as PfPatientRaceRow[];
    const ethRows = (await this.loadFile(ctx, "patientEthnicity")) as PfPatientEthnicityRow[];

    let generated = 0;
    let skipped = 0;

    // Race
    for (let i = 0; i < raceRows.length; i++) {
      const row = raceRows[i];
      const guid = row.PatientPracticeGuid;
      const race = mapRace(row.RaceName);

      if (!guid) { skipped++; continue; }
      if (!race) { skipped++; continue; }

      this.emit(ctx, {
        sql: [
          `-- Race: ${row.RaceName} for patient ${guid}`,
          `UPDATE patient`,
          `SET race = ${sqlLiteral(race)}, updated_at = NOW()`,
          `WHERE third_party_id = ${sqlLiteral(guid)};`,
        ].join("\n"),
      });
      generated++;
    }

    // Ethnicity
    for (let i = 0; i < ethRows.length; i++) {
      const row = ethRows[i];
      const guid = row.PatientPracticeGuid;
      const eth = mapEthnicity(row.EthnicityName);

      if (!guid) { skipped++; continue; }
      if (!eth) { skipped++; continue; }

      this.emit(ctx, {
        sql: [
          `-- Ethnicity: ${row.EthnicityName} for patient ${guid}`,
          `UPDATE patient`,
          `SET ethnicity = ${sqlLiteral(eth)}, updated_at = NOW()`,
          `WHERE third_party_id = ${sqlLiteral(guid)};`,
        ].join("\n"),
      });
      generated++;
    }

    return this.result(raceRows.length + ethRows.length, generated, skipped, errors);
  }
}
