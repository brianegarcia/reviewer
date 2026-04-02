-- ================================================================
-- Import: Practice Fusion
-- Organization: Omeed Ahadiat Dermatology
-- Generated: 2026-04-02T00:00:00.000Z
-- ================================================================
--
-- USAGE:
--   psql $DATABASE_URL -f practice_fusion_import.sql
--
-- SAFETY:
--   All statements use INSERT … ON CONFLICT DO UPDATE (upserts).
--   The file is idempotent — safe to run more than once.
--   The entire file runs inside a single transaction.
--   If any statement fails the whole import is rolled back.
--
-- REVIEW BEFORE RUNNING:
--   - Confirm organization_id matches your target organisation.
--   - Confirm source file paths and data quality.
--   - Review validation error report at the bottom of this file.
--
-- Validation errors: 3
-- ================================================================

BEGIN;

-- ────────────────────────────────────────────────────────────
-- Step: 01-organization
-- Phase 1
-- ────────────────────────────────────────────────────────────

-- Organization: Omeed Ahadiat Dermatology
INSERT INTO organizations (
  organization_id,
  name,
  status,
  created_at,
  updated_at
)
VALUES (
  'dr-omi-dermatology',
  'Omeed Ahadiat Dermatology',
  'active',
  NOW(),
  NOW()
)
ON CONFLICT (organization_id) DO UPDATE SET
  name = EXCLUDED.name,
  updated_at = EXCLUDED.updated_at;


-- ────────────────────────────────────────────────────────────
-- Step: 02-facilities
-- Phase 1
-- ────────────────────────────────────────────────────────────

-- Facility: Main Office (88080e82-7440-4df0-b71a-d3e44c55b9fb)
INSERT INTO office_locations (
  external_id,
  organization_id,
  name,
  street_name,
  street_name_2,
  city,
  state,
  postal_code,
  phone,
  timezone,
  primary_office,
  is_active,
  created_at,
  updated_at
)
VALUES (
  '88080e82-7440-4df0-b71a-d3e44c55b9fb',
  'dr-omi-dermatology',
  'Main Office',
  '123 Dermatology Lane',
  NULL,
  'Beverly Hills',
  'CA',
  '90210',
  '310-555-0100',
  'America/Los_Angeles',
  FALSE,
  TRUE,
  NOW(),
  NOW()
)
ON CONFLICT (external_id) DO UPDATE SET
  name = EXCLUDED.name,
  street_name = EXCLUDED.street_name,
  street_name_2 = EXCLUDED.street_name_2,
  city = EXCLUDED.city,
  state = EXCLUDED.state,
  postal_code = EXCLUDED.postal_code,
  phone = EXCLUDED.phone,
  timezone = EXCLUDED.timezone,
  updated_at = EXCLUDED.updated_at;


-- ────────────────────────────────────────────────────────────
-- Step: 03-providers
-- Phase 1
-- ────────────────────────────────────────────────────────────

-- IMPORTANT: After running this file, hash provider passwords:
--   UPDATE users SET password = crypt(password, gen_salt('bf')) WHERE data_source = 'local' AND role = 'doctor';
-- Or trigger the application's password migration flow for each provider.

-- Provider: Omeed Ahadiat (f15585dc-08c3-478b-bb78-fb12c52dcf66)
INSERT INTO users (
  third_party_id,
  organization_id,
  first_name,
  last_name,
  title,
  email,
  password,
  role,
  status,
  is_admin,
  data_source,
  created_at,
  updated_at
)
VALUES (
  'f15585dc-08c3-478b-bb78-fb12c52dcf66',
  'dr-omi-dermatology',
  'Omeed',
  'Ahadiat',
  'MD',
  'omeed.ahadiat@placeholder.subqdocs.com',
  'ch4ng3me1234!',
  'doctor',
  'active',
  TRUE,
  'local',
  NOW(),
  NOW()
)
ON CONFLICT (third_party_id, organization_id) DO UPDATE SET
  first_name = EXCLUDED.first_name,
  last_name = EXCLUDED.last_name,
  title = EXCLUDED.title,
  email = EXCLUDED.email,
  updated_at = EXCLUDED.updated_at;


-- ────────────────────────────────────────────────────────────
-- Step: 04-patients
-- Phase 1
-- ────────────────────────────────────────────────────────────

-- Patient: Jane Doe (120446d4-19cd-434d-af74-2303e3736233)
INSERT INTO patients (
  third_party_id,
  patient_id,
  organization_id,
  first_name,
  last_name,
  middle_name,
  preferred_name,
  gender,
  date_of_birth,
  street_address,
  city,
  state,
  zipcode,
  country,
  home_phone,
  cellphone,
  contact_no,
  email,
  ssn,
  sticky_note,
  data_source,
  existing_patient,
  is_deceased,
  created_at,
  updated_at
)
VALUES (
  '120446d4-19cd-434d-af74-2303e3736233',
  gen_random_uuid(),
  'dr-omi-dermatology',
  'Jane',
  'Doe',
  NULL,
  NULL,
  'female',
  '1985-03-15',
  '456 Patient St',
  'Los Angeles',
  'CA',
  '90001',
  'US',
  '213-555-0200',
  '213-555-0201',
  NULL,
  'jane.doe@example.com',
  NULL,
  NULL,
  'local',
  TRUE,
  FALSE,
  NOW(),
  NOW()
)
ON CONFLICT (third_party_id) DO UPDATE SET
  first_name = EXCLUDED.first_name,
  last_name = EXCLUDED.last_name,
  middle_name = EXCLUDED.middle_name,
  preferred_name = EXCLUDED.preferred_name,
  gender = EXCLUDED.gender,
  date_of_birth = EXCLUDED.date_of_birth,
  street_address = EXCLUDED.street_address,
  city = EXCLUDED.city,
  state = EXCLUDED.state,
  zipcode = EXCLUDED.zipcode,
  country = EXCLUDED.country,
  home_phone = EXCLUDED.home_phone,
  cellphone = EXCLUDED.cellphone,
  contact_no = EXCLUDED.contact_no,
  email = EXCLUDED.email,
  ssn = EXCLUDED.ssn,
  sticky_note = EXCLUDED.sticky_note,
  is_deceased = EXCLUDED.is_deceased,
  updated_at = EXCLUDED.updated_at;


-- ────────────────────────────────────────────────────────────
-- Step: 09-encounters
-- Phase 2
-- ────────────────────────────────────────────────────────────

-- Encounter: c1a2b3d4-0000-0000-0000-000000000001 patient=120446d4-... date=2025-11-10
INSERT INTO patient_visits (
  third_party_id,
  patient_id,
  visit_date,
  visit_time,
  status,
  visit_status,
  doctor_id,
  organization_id,
  office_location_id,
  visit_notes,
  visit_type,
  data_source,
  keep_transcript,
  finalized_at,
  finalized_by,
  created_at,
  updated_at
)
VALUES (
  'c1a2b3d4-0000-0000-0000-000000000001',
  (SELECT patient_id FROM patients WHERE third_party_id = '120446d4-19cd-434d-af74-2303e3736233' LIMIT 1),
  '2025-11-10',
  '2025-11-10T00:00:00'::timestamptz,
  'success',
  'finalized',
  (SELECT id FROM users WHERE third_party_id = 'f15585dc-08c3-478b-bb78-fb12c52dcf66' AND organization_id = 'dr-omi-dermatology' LIMIT 1),
  'dr-omi-dermatology',
  (SELECT id FROM office_locations WHERE external_id = '88080e82-7440-4df0-b71a-d3e44c55b9fb' LIMIT 1),
  'Skin check follow-up',
  'Office Visit',
  'local',
  FALSE,
  '2025-11-10T15:30:00.000Z',
  (SELECT id FROM users WHERE third_party_id = 'f15585dc-08c3-478b-bb78-fb12c52dcf66' AND organization_id = 'dr-omi-dermatology' LIMIT 1),
  NOW(),
  NOW()
)
ON CONFLICT (third_party_id) DO UPDATE SET
  visit_date = EXCLUDED.visit_date,
  visit_time = EXCLUDED.visit_time,
  status = EXCLUDED.status,
  visit_status = EXCLUDED.visit_status,
  doctor_id = EXCLUDED.doctor_id,
  office_location_id = EXCLUDED.office_location_id,
  visit_notes = EXCLUDED.visit_notes,
  visit_type = EXCLUDED.visit_type,
  finalized_at = EXCLUDED.finalized_at,
  finalized_by = EXCLUDED.finalized_by,
  updated_at = EXCLUDED.updated_at;

-- FullNote for encounter: c1a2b3d4-0000-0000-0000-000000000001
INSERT INTO full_note (
  patient_id,
  visit_id,
  visit_date,
  status,
  version,
  is_current,
  full_note_details,
  created_at,
  updated_at
)
VALUES (
  (SELECT patient_id FROM patients WHERE third_party_id = '120446d4-19cd-434d-af74-2303e3736233' LIMIT 1),
  (SELECT id FROM patient_visits WHERE third_party_id = 'c1a2b3d4-0000-0000-0000-000000000001' LIMIT 1),
  '2025-11-10',
  'success',
  1,
  TRUE,
  '{"subjective":"Patient reports mild itching on forearm","objective":"<h3>Objective</h3>Mild erythema noted on right forearm","assessment":"<h3>Assessment</h3>Contact dermatitis","plan":"<h3>Plan</h3>Prescribed topical corticosteroid","chiefComplaint":"Skin check follow-up","snapshotDiagnosis":"L25.9","snapshotMedications":""}'::jsonb,
  NOW(),
  NOW()
)
ON CONFLICT (visit_id) DO UPDATE SET
  full_note_details = EXCLUDED.full_note_details,
  updated_at = EXCLUDED.updated_at;


-- ────────────────────────────────────────────────────────────
-- Step: 10-diagnoses
-- Phase 2
-- ────────────────────────────────────────────────────────────

-- Diagnosis timeline for patient 120446d4-... (2 diagnoses)
INSERT INTO patient_diagnosis_timeline (patient_id, diagnosis_timeline, alerts, created_at, updated_at)
VALUES (
  (SELECT patient_id FROM patients WHERE third_party_id = '120446d4-19cd-434d-af74-2303e3736233' LIMIT 1),
  '[{"pf_diagnosis_guid":"diag-001","code":"L25.9","name":"Unspecified contact dermatitis","coding_system":"ICD-10","acuity":"Chronic","start_date":"2024-01-15","end_date":null},{"pf_diagnosis_guid":"diag-002","code":"L70.0","name":"Acne vulgaris","coding_system":"ICD-10","acuity":"Acute","start_date":"2025-03-10","end_date":null}]'::jsonb,
  '[]'::jsonb,
  NOW(),
  NOW()
)
ON CONFLICT (patient_id) DO UPDATE SET
  diagnosis_timeline = EXCLUDED.diagnosis_timeline,
  updated_at = NOW();


-- ────────────────────────────────────────────────────────────
-- Step: 15-encounter-events
-- Phase 3
-- ────────────────────────────────────────────────────────────

-- Encounter events for: c1a2b3d4-0000-0000-0000-000000000001
UPDATE full_note
SET
  full_note_details = jsonb_set(
    jsonb_set(
      COALESCE(full_note_details, '{}'::jsonb),
      '{vitals}'::text[],
      '[{"code":"8302-2","name":"Body Height","value":"165","date":"2025-11-10T14:00:00Z"},{"code":"29463-7","name":"Body Weight","value":"62","date":"2025-11-10T14:00:00Z"},{"code":"8480-6","name":"Systolic BP","value":"118","date":"2025-11-10T14:00:00Z"}]'::jsonb,
      true
    ),
    '{encounterEvents}'::text[],
    '[{"guid":"ev-001","name":"Skin Biopsy","description":"Punch biopsy right forearm","category":"Procedure","status":"Completed","value":null,"comments":"Sent to pathology","date":"2025-11-10T14:30:00Z"}]'::jsonb,
    true
  ),
  updated_at = NOW()
WHERE visit_id = (SELECT id FROM patient_visits WHERE third_party_id = 'c1a2b3d4-0000-0000-0000-000000000001' LIMIT 1)
  AND is_current = true AND deleted_at IS NULL;


-- ────────────────────────────────────────────────────────────
-- Step: 31-superbills
-- Phase 4
-- ────────────────────────────────────────────────────────────

-- Superbills: 1 record
DO $$
DECLARE
  _seq INTEGER;
  _patient_id UUID;
  _visit_id INTEGER;
  _provider_id INTEGER;
  _facility_id INTEGER;
  _dos DATE;
  _created_by INTEGER;
BEGIN
  -- Get current max bill sequence
  SELECT COALESCE(MAX(CAST(SUBSTRING(bill_readable_id FROM 4) AS INTEGER)), 0)
  INTO _seq
  FROM bills WHERE bill_readable_id ~ '^BL-\d{6}$';

  -- Fallback created_by: first user in org
  SELECT id INTO _created_by FROM users WHERE organization_id = 'dr-omi-dermatology' ORDER BY id LIMIT 1;

  -- Bill: billing-header-guid-001
  _patient_id  := (SELECT patient_id FROM patients WHERE third_party_id = '120446d4-19cd-434d-af74-2303e3736233' LIMIT 1);
  _visit_id    := (SELECT id FROM patient_visits WHERE third_party_id = 'c1a2b3d4-0000-0000-0000-000000000001' LIMIT 1);
  _provider_id := COALESCE((SELECT id FROM users WHERE third_party_id = 'f15585dc-08c3-478b-bb78-fb12c52dcf66' AND organization_id = 'dr-omi-dermatology' LIMIT 1), _created_by);
  _facility_id := (SELECT id FROM office_locations WHERE external_id = '88080e82-7440-4df0-b71a-d3e44c55b9fb' LIMIT 1);
  _dos := COALESCE((SELECT visit_date FROM patient_visits WHERE third_party_id = 'c1a2b3d4-0000-0000-0000-000000000001' LIMIT 1)::text, '2025-11-10')::date;

  IF NOT EXISTS (
    SELECT 1 FROM bills
    WHERE patient_id = _patient_id
      AND (visit_id = _visit_id OR (visit_id IS NULL AND _visit_id IS NULL))
  ) THEN
    _seq := _seq + 1;
    INSERT INTO bills (
      bill_readable_id, organization_id, patient_id, visit_id,
      primary_provider_id, location_id, date_of_service, status,
      total_charges, balance, diagnoses, created_by, created_at, updated_at
    ) VALUES (
      'BL-' || LPAD(_seq::text, 6, '0'),
      'dr-omi-dermatology',
      _patient_id, _visit_id, _provider_id, _facility_id, _dos,
      'finalized', 0, 0,
      '[{"code":"L25.9","label":"Unspecified contact dermatitis"}]'::jsonb,
      _created_by, NOW(), NOW()
    );
  END IF;

END $$;


-- ────────────────────────────────────────────────────────────
-- Step: 32-superbill-procedures
-- Phase 4
-- ────────────────────────────────────────────────────────────

-- Bill service: 99213 for billing-header-guid-001
INSERT INTO bill_services (
  bill_id,
  cpt_code,
  description,
  units,
  unit_charge,
  total_charge,
  diagnosis_pointers,
  modifiers,
  status,
  sort_order,
  created_at,
  updated_at
)
VALUES (
  (SELECT b.id FROM bills b JOIN patients p ON b.patient_id = p.patient_id JOIN patient_visits pv ON b.visit_id = pv.id WHERE p.third_party_id = '120446d4-19cd-434d-af74-2303e3736233' AND pv.third_party_id = 'c1a2b3d4-0000-0000-0000-000000000001' AND b.organization_id = 'dr-omi-dermatology' LIMIT 1),
  '99213',
  'Office Visit - Established Patient, Moderate Complexity',
  1,
  150.00,
  150.00,
  '["L25.9"]'::jsonb,
  '[]'::jsonb,
  'unposted',
  0,
  NOW(),
  NOW()
)
ON CONFLICT (bill_id, cpt_code) DO UPDATE SET
  description = EXCLUDED.description,
  units = EXCLUDED.units,
  unit_charge = EXCLUDED.unit_charge,
  total_charge = EXCLUDED.total_charge,
  diagnosis_pointers = EXCLUDED.diagnosis_pointers,
  updated_at = EXCLUDED.updated_at;


-- ────────────────────────────────────────────────────────────
-- Step: 33-update-bill-totals
-- Phase 4
-- ────────────────────────────────────────────────────────────

-- Recalculate bill totals for organization
-- Recalculate total_charges and balance for all bills in this org
UPDATE bills
SET
  total_charges = COALESCE(svc.total, 0),
  balance       = COALESCE(svc.total, 0),
  updated_at    = NOW()
FROM (
  SELECT bill_id, SUM(total_charge) AS total
  FROM bill_services
  GROUP BY bill_id
) AS svc
WHERE bills.id = svc.bill_id
  AND bills.organization_id = 'dr-omi-dermatology';


COMMIT;

-- ================================================================
-- IMPORT SUMMARY
-- ================================================================
--
-- Steps:
--   [Phase 1] 01-organization                         generated=    1  skipped=    0  errors=   0
--   [Phase 1] 02-facilities                           generated=    1  skipped=    0  errors=   0
--   [Phase 1] 03-providers                            generated=    1  skipped=    0  errors=   0
--   [Phase 1] 04-patients                             generated= 3542  skipped=    2  errors=   2
--   [Phase 1] 05-patient-demographics                 generated= 2891  skipped=   12  errors=   0
--   [Phase 1] 06-pharmacies                           generated=  148  skipped=    0  errors=   0
--   [Phase 1] 07-user-office-locations                generated=    1  skipped=    0  errors=   0
--   [Phase 2] 08-medications                          generated= 8231  skipped=    0  errors=   0
--   [Phase 2] 09-encounters                           generated=14820  skipped=    8  errors=   1
--   [Phase 2] 10-diagnoses                            generated= 3401  skipped=    0  errors=   0
--   [Phase 2] 11-prescriptions                        generated=12048  skipped=    0  errors=   0
--   [Phase 2] 12-lab-orders                           generated=  891  skipped=    0  errors=   0
--   [Phase 3] 13-visit-types                          generated=    8  skipped=    0  errors=   0
--   [Phase 3] 14-global-questions                     generated=    6  skipped=    0  errors=   0
--   [Phase 3] 15-encounter-events                     generated= 6284  skipped=    0  errors=   0
--   [Phase 3] 16-encounter-diagnoses                  generated= 4120  skipped=    0  errors=   0
--   [Phase 3] 17-encounter-addendums                  generated=  238  skipped=    0  errors=   0
--   [Phase 3] 18-encounter-observations               generated= 1842  skipped=    0  errors=   0
--   [Phase 3] 19-encounter-medications                generated= 2091  skipped=    0  errors=   0
--   [Phase 3] 20-health-concerns                      generated=  641  skipped=    0  errors=   0
--   [Phase 3] 21-med-history                          generated=  904  skipped=    0  errors=   0
--   [Phase 3] 22-patient-conditions                   generated= 1240  skipped=    0  errors=   0
--   [Phase 3] 23-pinned-notes                         generated=  312  skipped=    0  errors=   0
--   [Phase 3] 24-lab-result-notes                     generated=  487  skipped=    0  errors=   0
--   [Phase 3] 25-lab-order-diagnoses                  generated=  318  skipped=    0  errors=   0
--   [Phase 4] 26-labs                                 generated=   24  skipped=    0  errors=   0
--   [Phase 4] 27-lab-specimens                        generated=  612  skipped=    0  errors=   0
--   [Phase 4] 28-lab-result-documents                 generated=  401  skipped=    0  errors=   0
--   [Phase 4] 29-lab-order-documents                  generated=  289  skipped=    0  errors=   0
--   [Phase 4] 30-patient-documents                    generated= 2814  skipped=   14  errors=   0
--   [Phase 4] 31-superbills                           generated= 1204  skipped=    3  errors=   0
--   [Phase 4] 32-superbill-procedures                 generated= 3812  skipped=    0  errors=   0
--   [Phase 4] 33-update-bill-totals                   generated=    1  skipped=    0  errors=   0
--
-- Validation errors (rows skipped):
--   [04-patients] row 201: first_name/last_name – Patient must have first and last name (value: "bad-guid-001")
--   [04-patients] row 874: first_name/last_name – Patient must have first and last name (value: "bad-guid-002")
--   [09-encounters] row 1042: DateOfService – Invalid date: "" (value: "missing-date-enc-guid")
-- ================================================================
