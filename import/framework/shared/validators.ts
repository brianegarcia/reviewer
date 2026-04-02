/**
 * Common data-normalisation helpers shared across all source systems.
 *
 * These are pure functions – no side effects, no logging – so they are safe
 * to use inside mappers without worrying about context threading.
 */

// ─── Date helpers ─────────────────────────────────────────────────────────────

/**
 * Parse a date string into a JS Date, returning null for:
 *   - empty/null input
 *   - non-parseable strings
 *   - sentinel dates (≤ 1901 or ≥ 9999)
 */
export function parseDate(raw: string | null | undefined): Date | null {
  if (!raw || raw.trim() === "") return null;
  try {
    const d = new Date(raw.trim());
    if (isNaN(d.getTime())) return null;
    const year = d.getFullYear();
    if (year <= 1901 || year >= 9999) return null;
    return d;
  } catch {
    return null;
  }
}

/** Parse to a YYYY-MM-DD date string for DATE columns */
export function parseDateString(raw: string | null | undefined): string | null {
  const d = parseDate(raw);
  return d ? d.toISOString().split("T")[0] : null;
}

/** Parse to a full ISO-8601 timestamp string for TIMESTAMPTZ columns */
export function parseDateTimeString(raw: string | null | undefined): string | null {
  const d = parseDate(raw);
  return d ? d.toISOString() : null;
}

// ─── String helpers ───────────────────────────────────────────────────────────

/** Convert empty or whitespace-only strings to null */
export function emptyToNull(raw: string | null | undefined): string | null {
  if (!raw || raw.trim() === "") return null;
  return raw.trim();
}

/** Truncate string to maxLen; returns null if input is null */
export function truncate(raw: string | null | undefined, maxLen: number): string | null {
  if (!raw) return null;
  return raw.length > maxLen ? raw.substring(0, maxLen) : raw;
}

/** emptyToNull + truncate in one call */
export function normalizeStr(
  raw: string | null | undefined,
  maxLen?: number
): string | null {
  const v = emptyToNull(raw);
  return maxLen !== undefined ? truncate(v, maxLen) : v;
}

// ─── Enum mappings (gender / race / ethnicity) ────────────────────────────────

export type GenderValue = "male" | "female" | "other";
export type RaceValue =
  | "White"
  | "Black or African American"
  | "Asian"
  | "American Indian or Alaska Native"
  | "Native Hawaiian or Other Pacific Islander"
  | "Two or More Races"
  | "Other"
  | "Decline to Answer";
export type EthnicityValue = "Hispanic or Latino" | "Not Hispanic or Latino" | "Decline to Answer" | null;

export function mapGender(raw: string | null | undefined): GenderValue {
  const g = (raw ?? "").trim().toUpperCase();
  if (g === "M" || g === "MALE") return "male";
  if (g === "F" || g === "FEMALE") return "female";
  return "other";
}

const RACE_MAP: Record<string, RaceValue> = {
  "white": "White",
  "black or african american": "Black or African American",
  "asian": "Asian",
  "american indian or alaska native": "American Indian or Alaska Native",
  "native hawaiian or other pacific islander": "Native Hawaiian or Other Pacific Islander",
  "two or more races": "Two or More Races",
  "provider did not ask": "Decline to Answer",
  "declined": "Decline to Answer",
  "decline to specify": "Decline to Answer",
};

export function mapRace(raw: string | null | undefined): RaceValue | null {
  if (!raw) return null;
  return RACE_MAP[raw.trim().toLowerCase()] ?? "Other";
}

const ETHNICITY_MAP: Record<string, EthnicityValue> = {
  "hispanic or latino": "Hispanic or Latino",
  "not hispanic or latino": "Not Hispanic or Latino",
  "provider did not ask": "Decline to Answer",
  "declined": "Decline to Answer",
  "decline to specify": "Decline to Answer",
};

export function mapEthnicity(raw: string | null | undefined): EthnicityValue {
  if (!raw) return null;
  return ETHNICITY_MAP[raw.trim().toLowerCase()] ?? null;
}

// ─── ICD-10 extraction ────────────────────────────────────────────────────────

/**
 * Extract the ICD-10 code from a Practice Fusion DiagnosisCodeEquivalents string.
 * Format: "706.1 (ICD9), L70.9 (ICD10), 11381005 (SNOMED)"
 */
export function extractIcd10(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const match = raw.match(/([A-Z]\d[\dA-Z]*\.?\d*)\s*\(ICD10\)/);
  return match ? match[1] : null;
}

// ─── HTML cleaning ────────────────────────────────────────────────────────────

/**
 * Strip the outer <div class="pf-rich-text"> wrapper that Practice Fusion
 * wraps all rich-text fields in.
 */
export function cleanPfHtml(raw: string | null | undefined): string {
  if (!raw || raw.trim() === "") return "";
  const s = raw.trim();
  const match = s.match(/^<div class="pf-rich-text">([\s\S]*)<\/div>$/);
  return match ? match[1].trim() : s;
}

// ─── Number helpers ───────────────────────────────────────────────────────────

export function parseFloat2(raw: string | null | undefined): number {
  if (!raw) return 0;
  const n = parseFloat(raw);
  return isNaN(n) ? 0 : n;
}

export function parseInt2(raw: string | null | undefined): number {
  if (!raw) return 0;
  const n = parseInt(raw, 10);
  return isNaN(n) ? 0 : n;
}

/** Parse and clamp to minimum 1 */
export function parseQuantity(raw: string | null | undefined): number {
  return Math.max(1, Math.round(parseFloat2(raw)));
}
