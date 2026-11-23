// Manila calendar arithmetic for the list pages' summary cards. A row's day is
// the Manila day its timestamp falls on, so a 7 AM hearing counts as today
// from midnight Manila time, not from midnight UTC.

const DAY = 86_400_000;

/** YYYY-MM-DD in Manila. */
export function manilaDay(iso: string | Date): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
}

/** Whole days from Manila today to the day `iso` falls on (negative = past); null without a date. */
export function daysFromToday(iso: string | null | undefined, now: Date = new Date()): number | null {
  if (!iso) return null;
  const day = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : manilaDay(iso);
  return Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${manilaDay(now)}T00:00:00Z`)) / DAY);
}

/** "8:30 AM" in Manila, or null for a bare date. */
export function manilaTime(iso: string | null | undefined): string | null {
  if (!iso || /^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  return new Date(iso).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Manila' });
}

/** The parts that exist, joined with a middle dot. */
export const joinDetail = (...parts: (string | null | undefined | false)[]) => parts.filter(Boolean).join(' · ');
