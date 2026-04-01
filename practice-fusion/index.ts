/**
 * Practice Fusion -> SubQDocs Data Import
 *
 * One-time import script for Dr. Omi's Practice Fusion EHR data.
 *
 * Usage:
 *   cd subqdocs-backend
 *   npx ts-node -P scripts/practice-fusion-import/tsconfig.json scripts/practice-fusion-import/index.ts [--phase1] [--phase2] [--phase3]
 *
 * Prerequisites:
 *   - DATABASE_URL set in .env
 *   - Practice Fusion export in resources/ directory
 *   - Provider emails configured in config.ts (PROVIDER_EMAILS)
 */

import { testConnection, closeConnection } from "./lib/db";
import { logger } from "./lib/logger";

// Phase 1
import { importOrganization } from "./phase1/01-organization";
import { importFacilities } from "./phase1/02-facilities";
import { importProviders } from "./phase1/03-providers";
import { importPatients } from "./phase1/04-patients";
import { importPatientDemographics } from "./phase1/05-patient-demographics";
import { importPharmacies } from "./phase1/06-pharmacies";
import { importUserOfficeLocations } from "./phase1/07-user-office-locations";

// Phase 2
import { importMedications } from "./phase2/08-medications";
import { importEncounters } from "./phase2/09-encounters";
import { importDiagnoses } from "./phase2/10-diagnoses";
import { importPrescriptions } from "./phase2/11-prescriptions";
import { importLabOrders } from "./phase2/12-lab-orders";

// Phase 3
import { importVisitTypes } from "./phase3/13-visit-types";
import { importGlobalQuestions } from "./phase3/14-global-questions";
import { importEncounterEvents } from "./phase3/15-encounter-events";
import { importEncounterDiagnoses } from "./phase3/16-encounter-diagnoses";
import { importEncounterAddendums } from "./phase3/17-encounter-addendums";
import { importEncounterObservations } from "./phase3/18-encounter-observations";
import { importEncounterMedications } from "./phase3/19-encounter-medications";
import { importHealthConcerns } from "./phase3/20-health-concerns";
import { importMedHistory } from "./phase3/21-med-history";
import { importPatientConditions } from "./phase3/22-patient-conditions";
import { importPinnedNotes } from "./phase3/23-pinned-notes";
import { importLabResultNotes } from "./phase3/24-lab-result-notes";
import { importLabOrderDiagnoses } from "./phase3/25-lab-order-diagnoses";

// Phase 4
import { importLabs } from "./phase4/26-labs";
import { importLabSpecimens } from "./phase4/27-lab-specimens";
import { importLabResultDocuments } from "./phase4/28-lab-result-documents";
import { importLabOrderDocuments } from "./phase4/29-lab-order-documents";
import { importPatientDocuments } from "./phase4/30-patient-documents";
import { importSuperbills } from "./phase4/31-superbills";
import { importSuperbillProcedures } from "./phase4/32-superbill-procedures";
import { updateBillTotals } from "./phase4/33-update-bill-totals";

// ID Maps (for re-runs that skip Phase 1)
import { IdMap } from "./lib/id-map";

async function runPhase1() {
    logger.info("main", "═══ PHASE 1: Core Data ═══");

    // Step 01: Organization
    await importOrganization();

    // Step 02: Facilities -> office_locations
    const facilityMap = await importFacilities();

    // Step 03: Providers -> users
    const { providerMap, profileMap, userMap } = await importProviders();

    // Step 04: Patients
    const patientMap = await importPatients();

    // Step 05: Race & Ethnicity
    await importPatientDemographics(patientMap);

    // Step 06: Pharmacies
    await importPharmacies(patientMap);

    // Step 07: Link providers to office locations
    await importUserOfficeLocations(facilityMap, providerMap);

    logger.info("main", "═══ PHASE 1 COMPLETE ═══");
    return { facilityMap, providerMap, profileMap, userMap, patientMap };
}

async function runPhase2(maps: {
    facilityMap: IdMap;
    providerMap: IdMap;
    profileMap: IdMap;
    patientMap: IdMap;
}) {
    logger.info("main", "═══ PHASE 2: Medical History ═══");

    // Step 08: Medications
    await importMedications(maps.patientMap, maps.providerMap);

    // Step 09: Encounters -> visits + notes + full_note
    const encounterMap = await importEncounters(maps.patientMap, maps.providerMap, maps.facilityMap);

    // Step 10: Diagnoses
    await importDiagnoses(maps.patientMap);

    // Step 11: Prescriptions
    await importPrescriptions(maps.patientMap, maps.providerMap);

    // Step 12: Lab Orders
    await importLabOrders(maps.patientMap, maps.profileMap);

    logger.info("main", "═══ PHASE 2 COMPLETE ═══");
    return { encounterMap };
}

async function runPhase3(maps: {
    patientMap: IdMap;
    providerMap: IdMap;
    encounterMap: IdMap;
    labOrderMap: IdMap;
}) {
    logger.info("main", "═══ PHASE 3: Config & Clinical Enrichment ═══");

    // Step 13: Visit Types
    await importVisitTypes();

    // Step 14: Global Questions
    await importGlobalQuestions();

    // Step 15: Encounter Events (vitals, procedures) -> enrich full_note
    await importEncounterEvents(maps.patientMap, maps.encounterMap);

    // Step 16: Encounter-Diagnosis links -> enrich full_note
    await importEncounterDiagnoses(maps.encounterMap);

    // Step 17: Encounter Addendums -> enrich full_note
    await importEncounterAddendums(maps.encounterMap, maps.providerMap);

    // Step 18: Encounter Observations (physical exam) -> enrich full_note
    await importEncounterObservations(maps.encounterMap);

    // Step 19: Encounter-Medication links -> enrich full_note
    await importEncounterMedications(maps.encounterMap);

    // Step 20: Health Concerns -> diagnosis_timeline.alerts
    await importHealthConcerns(maps.patientMap);

    // Step 21: Medical History -> patient_medical_history
    await importMedHistory(maps.patientMap);

    // Step 22: Patient Conditions -> conditions table
    await importPatientConditions(maps.patientMap);

    // Step 23: Pinned Notes -> diagnosis_timeline.personal_note
    await importPinnedNotes(maps.patientMap);

    // Step 24: Lab Result Notes -> enrich lab_orders.comment
    await importLabResultNotes(maps.labOrderMap, maps.patientMap);

    // Step 25: Lab Order Item Diagnoses -> enrich lab_orders.order_diagnosis
    await importLabOrderDiagnoses(maps.labOrderMap);

    logger.info("main", "═══ PHASE 3 COMPLETE ═══");
}

async function runPhase4(maps: {
    patientMap: IdMap;
    providerMap: IdMap;
    profileMap: IdMap;
    encounterMap: IdMap;
    labOrderMap: IdMap;
    facilityMap: IdMap;
}) {
    logger.info("main", "═══ PHASE 4: Documents & Billing ═══");

    // Step 26: Labs reference data + backfill lab_id
    await importLabs(maps.labOrderMap);

    // Step 27: Lab specimens
    await importLabSpecimens(maps.labOrderMap);

    // Step 28: Lab result documents (PDFs -> S3 -> lab_order_files)
    await importLabResultDocuments(maps.labOrderMap);

    // Step 29: Lab order documents (PDFs -> S3 -> lab_order_files)
    await importLabOrderDocuments(maps.labOrderMap);

    // Step 30: Patient documents (PDFs -> S3 -> attachments)
    await importPatientDocuments(maps.patientMap, maps.providerMap);

    // Step 31: Superbills -> bills
    const billingHeaderMap = await importSuperbills(
        maps.patientMap, maps.profileMap, maps.encounterMap, maps.facilityMap
    );

    // Step 32: Superbill procedures -> bill_services
    await importSuperbillProcedures(billingHeaderMap);

    // Step 33: Recalculate bill totals
    await updateBillTotals(billingHeaderMap);

    logger.info("main", "═══ PHASE 4 COMPLETE ═══");
}

async function main() {
    const args = process.argv.slice(2);
    const runOnlyPhase1 = args.includes("--phase1");
    const runOnlyPhase2 = args.includes("--phase2");
    const runOnlyPhase3 = args.includes("--phase3");
    const runOnlyPhase4 = args.includes("--phase4");
    const runAll = !runOnlyPhase1 && !runOnlyPhase2 && !runOnlyPhase3 && !runOnlyPhase4;

    logger.info("main", "╔══════════════════════════════════════════╗");
    logger.info("main", "║  Practice Fusion -> SubQDocs Import      ║");
    logger.info("main", "╚══════════════════════════════════════════╝");

    // Test DB connection
    try {
        await testConnection();
        logger.info("main", "Database connection successful");
    } catch (err: any) {
        logger.error("main", `Database connection failed: ${err.message}`);
        process.exit(1);
    }

    try {
        if (runAll || runOnlyPhase1) {
            const maps = await runPhase1();

            if (runAll) {
                const phase2Result = await runPhase2(maps);
                const labOrderMap = new IdMap("lab-order-map");
                await runPhase3({
                    patientMap: maps.patientMap,
                    providerMap: maps.providerMap,
                    encounterMap: phase2Result.encounterMap,
                    labOrderMap,
                });
                await runPhase4({
                    patientMap: maps.patientMap,
                    providerMap: maps.providerMap,
                    profileMap: maps.profileMap,
                    encounterMap: phase2Result.encounterMap,
                    labOrderMap,
                    facilityMap: maps.facilityMap,
                });
            }
        } else if (runOnlyPhase2) {
            // Load existing maps from Phase 1
            logger.info("main", "Loading existing ID maps from Phase 1...");
            const facilityMap = new IdMap("facility-map");
            const providerMap = new IdMap("provider-map");
            const profileMap = new IdMap("profile-map");
            const patientMap = new IdMap("patient-map");

            if (patientMap.size() === 0) {
                logger.error("main", "No patient map found. Run Phase 1 first.");
                process.exit(1);
            }

            logger.info("main", `Loaded maps: ${patientMap.size()} patients, ${providerMap.size()} providers, ${facilityMap.size()} facilities`);

            await runPhase2({ facilityMap, providerMap, profileMap, patientMap });
        } else if (runOnlyPhase3) {
            // Resolve org ID (same as Phase 1 step 01)
            await importOrganization();

            // Load existing maps from Phase 1 & 2
            logger.info("main", "Loading existing ID maps from Phase 1 & 2...");
            const patientMap = new IdMap("patient-map");
            const providerMap = new IdMap("provider-map");
            const encounterMap = new IdMap("encounter-map");
            const labOrderMap = new IdMap("lab-order-map");

            if (patientMap.size() === 0) {
                logger.error("main", "No patient map found. Run Phase 1 first.");
                process.exit(1);
            }
            if (encounterMap.size() === 0) {
                logger.error("main", "No encounter map found. Run Phase 2 first.");
                process.exit(1);
            }

            logger.info("main", `Loaded maps: ${patientMap.size()} patients, ${providerMap.size()} providers, ${encounterMap.size()} encounters, ${labOrderMap.size()} lab orders`);

            await runPhase3({ patientMap, providerMap, encounterMap, labOrderMap });
        } else if (runOnlyPhase4) {
            // Resolve org ID (same as Phase 1 step 01)
            await importOrganization();

            // Load existing maps from Phase 1, 2 & 3
            logger.info("main", "Loading existing ID maps from Phase 1, 2 & 3...");
            const patientMap = new IdMap("patient-map");
            const providerMap = new IdMap("provider-map");
            const profileMap = new IdMap("profile-map");
            const facilityMap = new IdMap("facility-map");
            const encounterMap = new IdMap("encounter-map");
            const labOrderMap = new IdMap("lab-order-map");

            if (patientMap.size() === 0) {
                logger.error("main", "No patient map found. Run Phase 1 first.");
                process.exit(1);
            }
            if (labOrderMap.size() === 0) {
                logger.error("main", "No lab order map found. Run Phase 2 first.");
                process.exit(1);
            }

            logger.info("main", `Loaded maps: ${patientMap.size()} patients, ${providerMap.size()} providers, ${encounterMap.size()} encounters, ${labOrderMap.size()} lab orders, ${facilityMap.size()} facilities`);

            await runPhase4({ patientMap, providerMap, profileMap, encounterMap, labOrderMap, facilityMap });
        }

        logger.info("main", "╔══════════════════════════════════════════╗");
        logger.info("main", "║  IMPORT COMPLETE                         ║");
        logger.info("main", "╚══════════════════════════════════════════╝");
    } catch (err: any) {
        logger.error("main", `Fatal error: ${err.message}`);
        logger.error("main", err.stack || "");
        process.exit(1);
    } finally {
        await closeConnection();
        logger.close();
    }
}

main();
