/**
 * A PostgREST `in` list for `.not(column, 'in', …)` and `.or(…)` filters:
 * `("Filed or Sent out","Archived")`. Each value is quoted, because status
 * values contain spaces and PostgREST splits an unquoted list on them.
 */
export function pgInList(values: readonly string[]): string {
  return `(${values.map((v) => `"${v.replace(/"/g, '\\"')}"`).join(',')})`;
}
