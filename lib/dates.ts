/**
 * Manila calendar/clock helpers — the single source of truth for "what day is
 * it at the firm".
 *
 * Every date bug this codebase has hit is the same bug: reading a calendar day
 * off an instant in the wrong timezone. Two patterns cause it, and both are
 * banned in favour of the functions below:
 *
 *   new Date().toISOString().slice(0, 10)
 *     The UTC day. Manila is UTC+8, so from 00:00–08:00 local this is
 *     yesterday. Wrong on every host.
 *
 *   new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Manila' }))
 *     Formats to a wall-clock string, then re-parses it in the *host* zone.
 *     Correct on Vercel (UTC) and wrong in the browser — where the host zone
 *     already is Manila — so it fails only in client components, only before
 *     08:00, and never in local reasoning about the code.
 *
 * Everything here reads the calendar through Intl with an explicit timeZone,
 * so results do not depend on the host's zone: same answer on Vercel, on a
 * dev box, and in a lawyer's browser.
 *
 * The Philippines has observed no DST since 1978 — Asia/Manila is a fixed
 * +08:00. That is why a fixed-offset string is safe for range bounds.
 */

export const MANILA_TZ = 'Asia/Manila';
export const MANILA_OFFSET = '+08:00';

/** A calendar day as YYYY-MM-DD. */
export type DayString = string;

const DAY_MS = 86_400_000;

const dayParts = new Intl.DateTimeFormat('en-US', {
  timeZone: MANILA_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const clockParts = new Intl.DateTimeFormat('en-US', {
  timeZone: MANILA_TZ,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

function part(fmt: Intl.DateTimeFormat, at: Date, type: Intl.DateTimeFormatPartTypes): string {
  return fmt.formatToParts(at).find((p) => p.type === type)?.value ?? '';
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const ZONELESS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;

/**
 * A date or date-time string pinned to Manila, for writing to a timestamptz
 * column. A bare YYYY-MM-DD becomes Manila midnight and a zoneless date-time is
 * read as the Manila wall clock; a value that already carries Z or an offset is
 * returned unchanged. Without this, Postgres reads a zoneless value in its
 * session zone and JavaScript in the host's — neither is reliably Manila.
 */
export function toManilaInstant(value: string): string {
  if (DATE_ONLY.test(value)) return `${value}T00:00:00${MANILA_OFFSET}`;
  if (ZONELESS.test(value)) return `${value}${MANILA_OFFSET}`;
  return value;
}

function toInstant(at: Date | string | number): Date {
  return at instanceof Date ? at : new Date(typeof at === 'string' ? toManilaInstant(at) : at);
}

/**
 * The Manila calendar day containing `at`. A bare YYYY-MM-DD is already a
 * calendar day and comes back as is, so this is safe on a mix of date and
 * timestamptz columns — never take `.slice(0, 10)` of a timestamp instead.
 */
export function toManilaDay(at: Date | string | number = new Date()): DayString {
  if (typeof at === 'string' && DATE_ONLY.test(at)) return at;
  const d = toInstant(at);
  return `${part(dayParts, d, 'year')}-${part(dayParts, d, 'month')}-${part(dayParts, d, 'day')}`;
}

const wallClockParts = new Intl.DateTimeFormat('en-US', {
  timeZone: MANILA_TZ,
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

/** The Manila wall clock at an instant, as a zoneless YYYY-MM-DDTHH:mm:ss. */
export function toManilaWallClock(at: Date | string | number): string {
  const d = toInstant(at);
  const t = (type: Intl.DateTimeFormatPartTypes) => part(wallClockParts, d, type);
  return `${toManilaDay(d)}T${t('hour')}:${t('minute')}:${t('second')}`;
}

/**
 * True when the instant falls exactly on a Manila midnight. Meetings and
 * hearings have no all-day flag; one entered without a time is stored at
 * Manila midnight, and that is how it is recognised.
 */
export function isManilaMidnight(at: Date | string | number): boolean {
  return toManilaWallClock(at).endsWith('T00:00:00');
}

/**
 * True for a meeting or hearing entered as a day with no time. Writers pin a
 * bare day to Manila midnight; rows saved before that hold it at midnight UTC
 * (08:00 Manila), and the two look the same to anyone reading them.
 */
export function isDateOnly(at: Date | string | number): boolean {
  if (typeof at === 'string' && DATE_ONLY.test(at)) return true;
  const d = toInstant(at);
  return isManilaMidnight(d) || d.toISOString().endsWith('T00:00:00.000Z');
}

/** Today, in Manila. */
export function manilaToday(now: Date = new Date()): DayString {
  return toManilaDay(now);
}

/** Today shifted by whole calendar days — `manilaDate(1)` is tomorrow. */
export function manilaDate(offsetDays = 0, now: Date = new Date()): DayString {
  return addDays(manilaToday(now), offsetDays);
}

/** Hour of the Manila clock (0–23) — for greetings and time-of-day branches. */
export function manilaHour(now: Date = new Date()): number {
  // en-US hour12:false renders midnight as "24"; fold it back to 0.
  return Number(part(clockParts, now, 'hour')) % 24;
}

/** The Manila calendar month as YYYY-MM. */
export function manilaMonth(now: Date = new Date()): string {
  return manilaToday(now).slice(0, 7);
}

/** Four-digit Manila calendar year. */
export function manilaYear(now: Date = new Date()): number {
  return Number(manilaToday(now).slice(0, 4));
}

/** Manila calendar month as a 0-based index, for indexing month-name arrays. */
export function manilaMonthIndex(now: Date = new Date()): number {
  return Number(manilaToday(now).slice(5, 7)) - 1;
}

/** Day of week in Manila: 0=Sunday … 6=Saturday. */
export function manilaDayOfWeek(day: DayString | Date = new Date()): number {
  const d = typeof day === 'string' ? day : toManilaDay(day);
  return new Date(`${d}T00:00:00Z`).getUTCDay();
}

/**
 * First instant of a Manila day, as an offset-qualified ISO string.
 * Use as the lower bound when filtering a timestamptz column by calendar day.
 */
export function manilaDayStart(day: DayString): string {
  return `${day}T00:00:00.000${MANILA_OFFSET}`;
}

/**
 * Last instant of a Manila day, as an offset-qualified ISO string.
 * Use as the upper bound when filtering a timestamptz column by calendar day —
 * a bare YYYY-MM-DD would compare against midnight and drop the whole day.
 */
export function manilaDayEnd(day: DayString): string {
  return `${day}T23:59:59.999${MANILA_OFFSET}`;
}

/**
 * The YYYY-MM-DD of a Date that holds a calendar day at UTC midnight — one
 * built from `${day}T00:00:00Z` or Date.UTC and moved with the setUTC*
 * methods. Day arithmetic anchored in UTC is host-independent; this is the
 * only sanctioned way back to a string. Never pass it an instant (now, a
 * timestamptz): that is toManilaDay's job.
 */
export function utcCalendarDay(d: Date): DayString {
  return d.toISOString().slice(0, 10);
}

/** A YYYY-MM-DD as a Date at UTC midnight, for arithmetic with the setUTC* methods. */
function utcDate(day: DayString): Date {
  return new Date(`${day}T00:00:00Z`);
}

/** Calendar arithmetic on a YYYY-MM-DD, with month/year rollover. */
export function addDays(day: DayString, n: number): DayString {
  return utcCalendarDay(new Date(utcDate(day).getTime() + n * DAY_MS));
}

/**
 * `n` calendar months on. Overflow rolls forward the way Date does: Jan 31
 * plus one month is Mar 3 (Mar 2 in a leap year).
 */
export function addMonths(day: DayString, n: number): DayString {
  const d = utcDate(day);
  d.setUTCMonth(d.getUTCMonth() + n);
  return utcCalendarDay(d);
}

/** `n` calendar years on. Feb 29 plus one year is Mar 1. */
export function addYears(day: DayString, n: number): DayString {
  const d = utcDate(day);
  d.setUTCFullYear(d.getUTCFullYear() + n);
  return utcCalendarDay(d);
}

/** Last day of a YYYY-MM month: "2026-02" → "2026-02-28". */
export function lastDayOfMonth(month: string): DayString {
  const [y, m] = month.split('-').map(Number);
  return utcCalendarDay(new Date(Date.UTC(y, m, 0)));
}

/** True for a YYYY-MM-DD that names a real day — 2026-02-30 is shaped right and is not one. */
export function isCalendarDay(s: string): boolean {
  if (!DATE_ONLY.test(s)) return false;
  const d = utcDate(s);
  return !Number.isNaN(d.getTime()) && utcCalendarDay(d) === s;
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: DayString, to: DayString): number {
  return Math.round(
    (new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / DAY_MS,
  );
}

/** A gap in days as people say it: "12 days", "3 months", "2 years". */
export function spanOfDays(days: number): string {
  const abs = Math.abs(days);
  if (abs >= 730) return `${Math.floor(abs / 365)} years`;
  if (abs >= 60) return `${Math.floor(abs / 30)} months`;
  return `${abs} day${abs === 1 ? '' : 's'}`;
}

/** Mon–Sun range of the week containing today shifted by `offsetDays`. */
export function weekRange(offsetDays = 0, now: Date = new Date()): { start: DayString; end: DayString } {
  const base = manilaDate(offsetDays, now);
  const dow = manilaDayOfWeek(base);
  const start = addDays(base, dow === 0 ? -6 : 1 - dow);
  return { start, end: addDays(start, 6) };
}

/** First-to-last calendar day of the Manila month containing `now`. */
export function monthRange(now: Date = new Date()): { start: DayString; end: DayString } {
  const [y, m] = manilaToday(now).split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const mm = String(m).padStart(2, '0');
  return { start: `${y}-${mm}-01`, end: `${y}-${mm}-${String(last).padStart(2, '0')}` };
}

/** Display formatting at the firm's locale. Defaults to "Sep 2, 2026". */
export function formatManila(
  at: Date | string | number,
  opts: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'short', day: 'numeric' },
): string {
  return new Date(at).toLocaleDateString('en-PH', { timeZone: MANILA_TZ, ...opts });
}

const SCHEDULE_DATE: Intl.DateTimeFormatOptions = {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
  timeZone: MANILA_TZ,
};
const SCHEDULE_TIME: Intl.DateTimeFormatOptions = {
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
  timeZone: MANILA_TZ,
};

/** A time of day in Manila: "9:00 AM". Null when there is no usable timestamp. */
export function formatManilaTime(iso: string | null): string | null {
  if (!iso) return null;
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? null : at.toLocaleTimeString('en-PH', SCHEDULE_TIME);
}

/**
 * When a meeting or hearing happens: "Tue, Oct 6, 2026, 9:00 AM – 10:00 AM".
 * The end repeats the date only when it falls on a different Manila day.
 * Null when there is no usable start.
 */
export function formatManilaSchedule(startIso: string | null, endIso?: string | null): string | null {
  if (!startIso) return null;
  const start = new Date(startIso);
  if (Number.isNaN(start.getTime())) return null;
  const startText = start.toLocaleString('en-PH', SCHEDULE_DATE);
  const end = endIso ? new Date(endIso) : null;
  if (!end || Number.isNaN(end.getTime()) || end.getTime() <= start.getTime()) return startText;
  const endText =
    toManilaDay(start) === toManilaDay(end)
      ? end.toLocaleTimeString('en-PH', SCHEDULE_TIME)
      : end.toLocaleString('en-PH', SCHEDULE_DATE);
  return `${startText} – ${endText}`;
}

export type CountdownTone = 'late' | 'today' | 'soon' | 'later';

/**
 * A day as lawyers count it: "3 days late", "Today", "Tomorrow", "in 4 days".
 * More than a month out, the date itself reads better ("Nov 30").
 */
export function dayCountdown(day: DayString, today: DayString): { label: string; tone: CountdownTone } {
  const n = daysBetween(today, day);
  if (n < 0) return { label: `${-n} ${n === -1 ? 'day' : 'days'} late`, tone: 'late' };
  if (n === 0) return { label: 'Today', tone: 'today' };
  if (n === 1) return { label: 'Tomorrow', tone: 'soon' };
  if (n <= 7) return { label: `in ${n} days`, tone: 'soon' };
  if (n <= 31) return { label: `in ${n} days`, tone: 'later' };
  return { label: formatManila(`${day}T00:00:00+08:00`, { month: 'short', day: 'numeric' }), tone: 'later' };
}

/** Whole days elapsed since an ISO timestamp, or null when it is missing or unparseable. */
export function daysSince(iso: string | null, now: Date = new Date()): number | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  return Math.floor((now.getTime() - then) / 86_400_000);
}

// ── Names the app already imports ──────────────────────────────────

/** Today in Manila as YYYY-MM-DD. */
export function todayISO(): DayString {
  return manilaToday();
}

/** Mon–Sun range of the current Manila week. */
export function thisWeekRange(): { start: DayString; end: DayString } {
  return weekRange();
}
