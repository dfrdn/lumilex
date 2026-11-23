/**
 * A PostgREST `or=` filter matching `search` as a literal substring of any of
 * `columns`.
 *
 * The value is double-quoted so a comma, parenthesis or dot in the search
 * ("Smith, Inc.") stays part of the value instead of ending the clause — an
 * unquoted comma makes PostgREST reject the whole filter. Inside the quotes
 * PostgREST reads one level of backslash escapes, so LIKE's own escapes for
 * `%`, `_` and `\` are written doubled.
 */
export function ilikeAnyFilter(columns: readonly string[], search: string): string {
  const pattern = `%${search.replace(/[%_\\]/g, '\\$&')}%`;
  const quoted = `"${pattern.replace(/[\\"]/g, '\\$&')}"`;
  return columns.map((c) => `${c}.ilike.${quoted}`).join(',');
}
