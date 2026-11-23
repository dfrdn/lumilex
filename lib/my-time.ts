import { addDays, type DayString } from '@/lib/dates';

/** Monday to Friday of the week starting `weekStart` (a Monday). */
export function workWeek(weekStart: DayString): DayString[] {
  return [0, 1, 2, 3, 4].map((n) => addDays(weekStart, n));
}

/**
 * Past working days this week with no time logged: weekdays before today
 * that are not a holiday or the person's leave. Today is still in progress,
 * so it never counts.
 */
export function daysWithoutTime(
  weekStart: DayString,
  today: DayString,
  hoursByDay: Record<DayString, number>,
  offDays: ReadonlySet<DayString>,
): DayString[] {
  return workWeek(weekStart).filter((d) => d < today && !offDays.has(d) && !(hoursByDay[d] > 0));
}

/** Every day from `start` to `end` inclusive, clipped to [from, to]. */
export function daysInSpan(start: DayString, end: DayString, from: DayString, to: DayString): DayString[] {
  const out: DayString[] = [];
  for (let d = start < from ? from : start; d <= end && d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}
