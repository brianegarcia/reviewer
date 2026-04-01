import { GenderEnum, RaceEnum, EthnicityEnum } from "@utils/enum";

/**
 * Parse Practice Fusion date strings.
 * Formats: "M/D/YYYY H:MM:SS AM/PM" or "MM/DD/YYYY"
 * Returns Date or null if unparseable.
 */
export function parseDate(dateStr: string | null): Date | null {
    if (!dateStr || dateStr.trim() === "") return null;

    try {
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return null;

        // Filter out sentinel dates (01/01/1901, 12/31/9999)
        const year = d.getFullYear();
        if (year <= 1901 || year >= 9999) return null;

        return d;
    } catch {
        return null;
    }
}

/**
 * Parse date to YYYY-MM-DD string for DATE columns.
 */
export function parseDateString(dateStr: string | null): string | null {
    const d = parseDate(dateStr);
    if (!d) return null;
    return d.toISOString().split("T")[0];
}

/**
 * Map Practice Fusion gender ("M", "F") to SubQDocs GenderEnum.
 */
export function mapGender(pfGender: string | null): GenderEnum {
    if (!pfGender) return GenderEnum.OTHER;
    const g = pfGender.trim().toUpperCase();
    if (g === "M" || g === "MALE") return GenderEnum.MALE;
    if (g === "F" || g === "FEMALE") return GenderEnum.FEMALE;
    return GenderEnum.OTHER;
}

/**
 * Map Practice Fusion race name to SubQDocs RaceEnum.
 */
export function mapRace(pfRace: string | null): RaceEnum | null {
    if (!pfRace) return null;
    const r = pfRace.trim();

    const raceMap: Record<string, RaceEnum> = {
        "White": RaceEnum.WHITE,
        "Black or African American": RaceEnum.BLACK_AFRICAN_AMERICAN,
        "Asian": RaceEnum.ASIAN,
        "American Indian or Alaska Native": RaceEnum.AMERICAN_INDIAN_ALASKA_NATIVE,
        "Native Hawaiian or Other Pacific Islander": RaceEnum.NATIVE_HAWAIIAN_PACIFIC_ISLANDER,
        "Provider did not ask": RaceEnum.DECLINE_TO_ANSWER,
        "Declined": RaceEnum.DECLINE_TO_ANSWER,
        "Decline to specify": RaceEnum.DECLINE_TO_ANSWER,
    };

    return raceMap[r] ?? RaceEnum.OTHER;
}

/**
 * Map Practice Fusion ethnicity name to SubQDocs EthnicityEnum.
 */
export function mapEthnicity(pfEthnicity: string | null): EthnicityEnum | null {
    if (!pfEthnicity) return null;
    const e = pfEthnicity.trim();

    const ethMap: Record<string, EthnicityEnum> = {
        "Hispanic or Latino": EthnicityEnum.HISPANIC_LATINO,
        "Not Hispanic or Latino": EthnicityEnum.NOT_HISPANIC_LATINO,
        "Provider did not ask": EthnicityEnum.DECLINE_TO_ANSWER,
        "Declined": EthnicityEnum.DECLINE_TO_ANSWER,
        "Decline to specify": EthnicityEnum.DECLINE_TO_ANSWER,
    };

    return ethMap[e] ?? null;
}

/**
 * Extract ICD-10 code from Practice Fusion's DiagnosisCodeEquivalents.
 * Format: "706.1 (ICD9), L70.9 (ICD10), 11381005 (SNOMED)"
 */
export function extractIcd10(codeEquivalents: string | null): { code: string; name: string } | null {
    if (!codeEquivalents) return null;

    const match = codeEquivalents.match(/([A-Z]\d[\dA-Z]*\.?\d*)\s*\(ICD10\)/);
    if (match) {
        return { code: match[1], name: "" };
    }
    return null;
}

/**
 * Clean Practice Fusion HTML content (strip pf-rich-text wrapper div).
 */
export function cleanPfHtml(html: string | null): string {
    if (!html || html.trim() === "") return "";

    // Remove outer <div class="pf-rich-text"> wrapper if present
    let cleaned = html.trim();
    const wrapperMatch = cleaned.match(/^<div class="pf-rich-text">([\s\S]*)<\/div>$/);
    if (wrapperMatch) {
        cleaned = wrapperMatch[1].trim();
    }

    return cleaned;
}

/**
 * Truncate string to max length.
 */
export function truncate(str: string | null, maxLen: number): string | null {
    if (!str) return null;
    return str.length > maxLen ? str.substring(0, maxLen) : str;
}

/**
 * Convert empty strings to null.
 */
export function emptyToNull(str: string | null): string | null {
    if (!str || str.trim() === "") return null;
    return str.trim();
}
