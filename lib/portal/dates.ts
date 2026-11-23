/**
 * Manila-anchored date helpers for client-facing screens. Every format here
 * renders in Asia/Manila so "tomorrow" matches the client's calendar, not the
 * (UTC) edge that served the page.
 */

const TZ = 'Asia/Manila';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Parse an ISO timestamp or a bare YYYY-MM-DD (as Manila midnight). */
export function parseManila(iso: string): Date {
  return new Date(DATE_ONLY.test(iso) ? `${iso}T00:00:00+08:00` : iso);
}

export function formatDate(iso: string): string {
  return parseManila(iso).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', timeZone: TZ });
}

export function formatDateLong(iso: string): string {
  return parseManila(iso).toLocaleDateString('en-PH', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', timeZone: TZ });
}

/** null for a date-only value — there is no time to show. */
export function formatTime(iso: string): string | null {
  if (DATE_ONLY.test(iso)) return null;
  return new Date(iso).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: TZ });
}

export function formatDateTime(iso: string): string {
  const t = formatTime(iso);
  return t ? `${formatDate(iso)} · ${t}` : formatDate(iso);
}

export function formatMonthYear(iso: string): string {
  return parseManila(iso).toLocaleDateString('en-PH', { month: 'long', year: 'numeric', timeZone: TZ });
}

/** "2026-05" — the Manila month an instant falls in. */
export function monthKey(iso: string): string {
  return parseManila(iso).toLocaleDateString('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit' });
}

/** Whole-day countdown in Manila, negative for the past. */
export function daysUntil(iso: string, now: Date = new Date()): number {
  const fmt = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
  const t = new Date(`${fmt(parseManila(iso))}T00:00:00+08:00`).getTime();
  const n = new Date(`${fmt(now)}T00:00:00+08:00`).getTime();
  return Math.round((t - n) / (1000 * 60 * 60 * 24));
}

export function countdownLabel(iso: string, now: Date = new Date()): string {
  const days = daysUntil(iso, now);
  if (days < 0) return `${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} ago`;
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days < 7) return `In ${days} days`;
  if (days < 14) return 'Next week';
  if (days < 30) return `In ${Math.round(days / 7)} weeks`;
  if (days < 365) {
    const months = Math.round(days / 30);
    return `In ${months} ${months === 1 ? 'month' : 'months'}`;
  }
  const years = Math.round(days / 365);
  return `In ${years} year${years === 1 ? '' : 's'}`;
}

/** Within the coming week, today included. */
export function isImminent(iso: string, now: Date = new Date()): boolean {
  const days = daysUntil(iso, now);
  return days >= 0 && days <= 7;
}
