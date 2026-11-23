/**
 * Facet helpers for the files listing. Kept free of React and Supabase so the
 * bucketing can be unit-tested with fake timers.
 */
export const RECEIVED_BUCKETS = [
  'Past 7 days',
  'Past 30 days',
  'Past 90 days',
  'Past year',
  'Older',
  'No date',
] as const;

export type ReceivedBucket = (typeof RECEIVED_BUCKETS)[number];

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Bucket a date into a relative age band. A date in the future (a clock skew,
 * a mistyped year) counts as recent rather than falling off the list.
 */
export function receivedBucket(iso: string | null | undefined, now: Date = new Date()): ReceivedBucket {
  if (!iso) return 'No date';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 'No date';
  const ageDays = (now.getTime() - t) / DAY_MS;
  if (ageDays <= 7) return 'Past 7 days';
  if (ageDays <= 30) return 'Past 30 days';
  if (ageDays <= 90) return 'Past 90 days';
  if (ageDays <= 365) return 'Past year';
  return 'Older';
}
