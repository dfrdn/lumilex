import type { DTRSnapshot } from '@/lib/queries/effective-dtr';

/**
 * A DTR snapshot fanned out to one specific lawyer. The original `lawyerName`
 * is overwritten with the attendee's name so downstream rate lookups + per-lawyer
 * grouping pick up that lawyer's position rate. The remaining fields are unchanged.
 */
export type FannedSnapshot = DTRSnapshot;

/**
 * Each DTR represents the work of every lawyer who attended — not just the
 * principal who logged it. A 1.0h meeting attended by ADC, QZX, JKL bills as
 *   • ADC — 1.0h meeting
 *   • QZX — 1.0h meeting
 *   • JKL — 1.0h meeting
 * each at the attendee's own hourly rate.
 *
 * This helper expands one snapshot into N fanned snapshots — one per unique
 * lawyer (principal + with_names). De-duplicated by name so a lawyer who
 * appears as both principal and in `with_names` isn't double-counted.
 *
 * If the snapshot has no `lawyerName` and no `with_names`, returns a single
 * copy unchanged (defensive — billing code can still produce a row).
 */
export function fanOutByAttendees(s: DTRSnapshot): FannedSnapshot[] {
  const names = new Set<string>();
  const principal = (s.lawyerName ?? '').trim();
  if (principal) names.add(principal);
  for (const n of s.withNames ?? []) {
    const trimmed = (n ?? '').trim();
    if (trimmed) names.add(trimmed);
  }
  if (names.size === 0) return [s];
  return [...names].map((name) => ({ ...s, lawyerName: name }));
}

/** Convenience: fan out a list of snapshots in one pass. */
export function fanOutAll(snapshots: DTRSnapshot[]): FannedSnapshot[] {
  const out: FannedSnapshot[] = [];
  for (const s of snapshots) out.push(...fanOutByAttendees(s));
  return out;
}
