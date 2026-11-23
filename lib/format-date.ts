// The firm writes dates day-month-year — "1 October 2026" — never the
// month-first order en-PH / en-US print. Built by hand rather than with
// toLocaleDateString: en-GB is day-first but prints "Sept" for the short month.

import { manilaToday } from '@/lib/dates';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function parts(iso: string): { day: number; month: number; year: string } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  const month = Number(m[2]) - 1;
  if (month < 0 || month > 11) return null;
  return { day: Number(m[3]), month, year: m[1] };
}

/** "1 October 2026". Returns the input unchanged when it isn't a YYYY-MM-DD date. */
export function formatDate(iso: string): string {
  const p = parts(iso);
  return p ? `${p.day} ${MONTHS[p.month]} ${p.year}` : iso;
}

/** "1 Oct 2026" — for tables and other tight spots. */
export function formatDateShort(iso: string): string {
  const p = parts(iso);
  return p ? `${p.day} ${MONTHS[p.month].slice(0, 3)} ${p.year}` : iso;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Today in a shell's header: "Saturday, 21 November 2026", the Manila day. */
export function formatWeekdayDate(d: Date): string {
  const iso = manilaToday(d);
  const weekday = WEEKDAYS[new Date(`${iso}T00:00:00Z`).getUTCDay()];
  return `${weekday}, ${formatDate(iso)}`;
}

/** The same where the header is narrow: "21 Nov". */
export function formatDateCompact(d: Date): string {
  const p = parts(manilaToday(d));
  return p ? `${p.day} ${MONTHS[p.month].slice(0, 3)}` : '';
}
