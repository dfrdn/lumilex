// Schedule ranges for the assistant's schedule tool. The calendar math is
// lib/dates'; this only maps a preset onto it. Colocated tests in dates.test.ts.

import { manilaDate, manilaToday, monthRange, weekRange } from '@/lib/dates';

export { manilaDate, manilaToday, monthRange, weekRange };

export type SchedulePreset = 'today' | 'tomorrow' | 'this_week' | 'next_week' | 'this_month';

/**
 * Resolve a schedule range. Explicit start+end win; otherwise a preset is
 * applied; otherwise it defaults to today.
 */
export function resolveRange(
  preset?: string,
  start?: string,
  end?: string,
  now: Date = new Date(),
): { start: string; end: string } {
  if (start && end) return { start, end };
  switch (preset) {
    case 'tomorrow': {
      const t = manilaDate(1, now);
      return { start: t, end: t };
    }
    case 'this_week':
      return weekRange(0, now);
    case 'next_week':
      return weekRange(7, now);
    case 'this_month':
      return monthRange(now);
    case 'today':
    default: {
      const t = manilaToday(now);
      return { start: t, end: t };
    }
  }
}
