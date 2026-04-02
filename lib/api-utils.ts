/**
 * Shared utility functions for admin API routes.
 */

/**
 * Parse a string to a positive integer with a fallback and optional max.
 * Returns at least 1. If the value is not a finite number, returns fallback.
 */
export function parsePositiveInt(value: string | null | undefined, fallback: number, max?: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const normalized = Math.max(Math.floor(parsed), 1);
  if (typeof max === "number") return Math.min(normalized, max);
  return normalized;
}

/**
 * Normalize a nullable string: undefined stays undefined, empty string becomes null.
 */
export function normalizeNullableString(value: string | null | undefined) {
  if (value === undefined) return undefined;
  if (value === "") return null;
  return value;
}

/**
 * Parse a boolean query-string value ("true"/"false") to boolean or undefined.
 */
export function parseBoolean(value?: string | null) {
  if (!value) return undefined;
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}
