// Manila-time greeting helpers for the client portal. Run server-side at
// request time so the salutation reflects the client's local hour, not the
// (UTC) edge they happen to hit.

const MANILA_TZ = 'Asia/Manila';

export function getManilaHour(): number {
  // Intl returns a string like "07" / "23"; pad-safe via Number().
  const parts = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    hour12: false,
    timeZone: MANILA_TZ,
  }).formatToParts(new Date());
  const h = parts.find((p) => p.type === 'hour')?.value;
  return h ? Number(h) % 24 : 0;
}

export function getGreeting(hour: number = getManilaHour()): string {
  if (hour < 5) return 'Good evening';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

/** First word of a full name, trimmed. Empty string if unparseable. */
export function getFirstName(fullName: string | null | undefined): string {
  if (!fullName) return '';
  const first = fullName.trim().split(/\s+/)[0] ?? '';
  return first;
}
