/**
 * access.ts
 *
 * Helpers for the comma-separated allowlists configured through environment
 * variables (`ARBITRATOR_ADDRESSES`, `CORS_ORIGIN`).
 *
 * Both parsers are deliberately forgiving about the shape people paste in
 * (spaces, trailing commas, duplicates) and never throw, so a typo in an env
 * var degrades to "empty list" — which the callers treat as "deny", not
 * "allow everything".
 */

/** Split a comma-separated env var into a trimmed, de-duplicated list. */
export function parseList(raw: string | undefined | null): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  for (const entry of raw.split(",")) {
    const value = entry.trim();
    if (value) seen.add(value);
  }
  return [...seen];
}

/** Case-insensitive membership check. */
export function isListed(value: string | undefined, list: string[]): boolean {
  if (!value) return false;
  const needle = value.toLowerCase();
  return list.some((entry) => entry.toLowerCase() === needle);
}

/**
 * CORS origin matching. Origins are compared case-insensitively, and the
 * wildcard `*` (or an empty list, handled by the caller) means "no
 * restriction".
 */
export function isAllowedOrigin(origin: string | undefined, allowed: string[]): boolean {
  if (allowed.length === 0) return true;
  if (allowed.includes("*")) return true;
  if (!origin) return true; // same-origin / server-to-server requests send no Origin
  return isListed(origin, allowed);
}
