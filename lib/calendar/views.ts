import { addDays, addYears, isCalendarDay, manilaToday, type DayString } from '@/lib/dates';

/*
 * Calendar's tabs: the month calendar (the default) and the Hearings
 * and Meetings lists, chosen by `?tab=`. The lists were pages of their own
 * and redirect here; a hearing or meeting still opens at
 * /dashboard/hearings/<id> or /dashboard/meetings/<id>.
 *
 * A list reads a date window, never the whole table: by default every entry
 * from 90 days back on, so the cards' "past 90 days" counts stay whole and a
 * hearing set months ahead still shows. `?range=year` reaches a year back,
 * `?range=all` drops the window, and `?from=` / `?to=` (YYYY-MM-DD, Manila
 * days) set one by hand. A window open ahead also holds the entries with no
 * date yet, which still need one set.
 */

export const CALENDAR_TABS = [
  { key: 'calendar', label: 'Calendar' },
  { key: 'hearings', label: 'Hearings' },
  { key: 'meetings', label: 'Meetings' },
] as const;

export type CalendarTab = (typeof CALENDAR_TABS)[number]['key'];
export type ListTab = Exclude<CalendarTab, 'calendar'>;

const TAB_KEYS: ReadonlySet<string> = new Set(CALENDAR_TABS.map((t) => t.key));

export function parseCalendarTab(v: string | undefined): CalendarTab {
  return v && TAB_KEYS.has(v) ? (v as CalendarTab) : 'calendar';
}

/** The URL of a tab, with any extra query (a list's window or card). */
export function calendarHref(tab: CalendarTab, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams(tab === 'calendar' ? extra : { tab, ...extra });
  const qs = params.toString();
  return qs ? `/dashboard/calendar?${qs}` : '/dashboard/calendar';
}

export const DEFAULT_DAYS_BACK = 90;

export type WindowPreset = 'recent' | 'year' | 'all' | 'custom';

export const WINDOW_PRESETS: { key: Exclude<WindowPreset, 'custom'>; label: string }[] = [
  { key: 'recent', label: 'From 90 days ago' },
  { key: 'year', label: 'From a year ago' },
  { key: 'all', label: 'All dates' },
];

/** The days a list covers, both ends inclusive; a null end is open. */
export interface ListWindow {
  preset: WindowPreset;
  from: DayString | null;
  to: DayString | null;
}

export function parseListWindow(
  params: { range?: string; from?: string; to?: string },
  today: DayString = manilaToday(),
): ListWindow {
  const from = params.from && isCalendarDay(params.from) ? params.from : null;
  const to = params.to && isCalendarDay(params.to) ? params.to : null;
  if (from || to) {
    return from && to && from > to ? { preset: 'custom', from: to, to: from } : { preset: 'custom', from, to };
  }
  if (params.range === 'all') return { preset: 'all', from: null, to: null };
  if (params.range === 'year') return { preset: 'year', from: addYears(today, -1), to: null };
  return { preset: 'recent', from: addDays(today, -DEFAULT_DAYS_BACK), to: null };
}

/** The query that names a window; the default leaves it empty. */
export function windowQuery(w: Pick<ListWindow, 'preset' | 'from' | 'to'>): Record<string, string> {
  switch (w.preset) {
    case 'recent':
      return {};
    case 'year':
    case 'all':
      return { range: w.preset };
    case 'custom': {
      const q: Record<string, string> = {};
      if (w.from) q.from = w.from;
      if (w.to) q.to = w.to;
      return q;
    }
  }
}

/** The query for From / To set by hand; clearing both opens every date. */
export function datesQuery(from: string | null, to: string | null): Record<string, string> {
  return from || to ? windowQuery({ preset: 'custom', from, to }) : windowQuery({ preset: 'all', from: null, to: null });
}

/** Whether a window holds the undated entries: it does when it is open ahead. */
export function holdsUndated(w: Pick<ListWindow, 'to'>): boolean {
  return w.to === null;
}

/**
 * Whether a list opens on Upcoming. Only the default window does: a person who
 * chose a year back, every date or their own days asked to see past entries.
 */
export function opensOnUpcoming(w: Pick<ListWindow, 'preset'>): boolean {
  return w.preset === 'recent';
}

/** A key that changes with the window, so a list remounts on its defaults. */
export function windowKey(w: ListWindow): string {
  return `${w.preset}:${w.from ?? ''}:${w.to ?? ''}`;
}
