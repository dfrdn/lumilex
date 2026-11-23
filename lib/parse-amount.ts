/**
 * Parse a user-typed numeric amount ("1,000,000", "₱1,500.50", " 25 ") into a
 * number, or null when empty/unparseable. `Number()` alone turns comma-grouped
 * input into NaN, which JSON-serializes to null and silently wipes the field.
 */
export function parseAmount(input: string | null | undefined): number | null {
  if (input == null) return null;
  const cleaned = input.replace(/[₱,\s]/g, '');
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** Like parseAmount but rounds to an integer (share counts, etc.). */
export function parseCount(input: string | null | undefined): number | null {
  const n = parseAmount(input);
  return n == null ? null : Math.round(n);
}
