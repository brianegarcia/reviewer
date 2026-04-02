/**
 * Miscellaneous utility functions used across the import framework.
 */

import { v4 as uuidv4 } from "uuid";

// ─── UUID ─────────────────────────────────────────────────────────────────────

export { uuidv4 };

// ─── Grouping ─────────────────────────────────────────────────────────────────

/**
 * Group an array of items by a key function.
 * Returns a Map<K, T[]>.
 */
export function groupBy<T, K>(items: T[], keyFn: (item: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(item);
  }
  return map;
}

// ─── Deduplication ────────────────────────────────────────────────────────────

/** Remove duplicate items from an array using a key function */
export function dedupe<T>(items: T[], keyFn: (item: T) => unknown): T[] {
  const seen = new Set<unknown>();
  return items.filter((item) => {
    const key = keyFn(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ─── Chunking ─────────────────────────────────────────────────────────────────

/** Split an array into chunks of `size` */
export function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

// ─── Zero-padded sequences ────────────────────────────────────────────────────

/** Format a number as a zero-padded sequence string, e.g. padSeq(5, 6) → "000005" */
export function padSeq(n: number, width: number): string {
  return String(n).padStart(width, "0");
}

// ─── Country code normalisation ───────────────────────────────────────────────

const COUNTRY_MAP: Record<string, string> = {
  "united states of america": "US",
  "united states": "US",
  "usa": "US",
  "us": "US",
  "canada": "CA",
  "mexico": "MX",
};

export function normalizeCountry(raw: string | null | undefined): string | null {
  if (!raw) return null;
  return COUNTRY_MAP[raw.trim().toLowerCase()] ?? raw.trim();
}

// ─── Billing status mapping ───────────────────────────────────────────────────

const BILLING_STATUS_MAP: Record<string, string> = {
  draft: "draft",
  ready: "finalized",
  submitted: "claim_filed",
  paid: "paid",
};

export function mapBillingStatus(raw: string | null | undefined): string {
  if (!raw) return "draft";
  return BILLING_STATUS_MAP[raw.toLowerCase()] ?? "draft";
}

// ─── Note HTML builder ────────────────────────────────────────────────────────

/** Build a visit note HTML string from SOAP sections */
export function buildNoteHtml(
  subjective: string,
  objective: string,
  assessment: string,
  plan: string
): string {
  const parts: string[] = [];
  if (subjective) parts.push(`<h3>Subjective</h3>${subjective}`);
  if (objective) parts.push(`<h3>Objective</h3>${objective}`);
  if (assessment) parts.push(`<h3>Assessment</h3>${assessment}`);
  if (plan) parts.push(`<h3>Plan</h3>${plan}`);
  return parts.join("\n");
}
