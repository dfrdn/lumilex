import { toManilaDay, type DayString } from '@/lib/dates';
import { isOverdueFor } from '@/lib/deliverable-status';

/**
 * The dashboard reads each kind of item once, over the widest span it shows,
 * and cuts the narrower lists from it here: today out of the week, the user's
 * own out of the firm's. Each cut uses the filter its own query used to run.
 */

/** Items whose timestamp falls on `day` in Manila — never a slice of the ISO string, which is UTC. */
export function onManilaDay<T extends { date: string | null }>(items: T[], day: DayString): T[] {
  return items.filter((i) => !!i.date && toManilaDay(i.date) === day);
}

/** Items that list `personId` — as attendee for meetings and hearings, as currently-with for filings. */
export function involving<T extends { attendeeIds: string[] }>(items: T[], personId: string): T[] {
  return items.filter((i) => i.attendeeIds.includes(personId));
}

/** High, then Medium, then Low, then unset — the column holds labels, so it can't be sorted as text. */
const PRIORITY_RANK: Record<string, number> = { High: 0, Medium: 1, Low: 2 };

export function byPriority<T extends { priority: string | null }>(a: T, b: T): number {
  return (PRIORITY_RANK[a.priority ?? ''] ?? 3) - (PRIORITY_RANK[b.priority ?? ''] ?? 3);
}

/** Open tasks split into those due today (highest priority first) and those due within the week. */
export function taskSlices<T extends { dueDate: string | null; priority: string | null }>(
  open: T[],
  today: DayString,
  week: { start: DayString; end: DayString },
): { today: T[]; week: T[] } {
  return {
    today: open
      .filter((t) => t.dueDate === today)
      .sort(byPriority),
    week: open.filter((t) => !!t.dueDate && t.dueDate >= week.start && t.dueDate <= week.end),
  };
}

interface SliceableDeliverable {
  currentlyWith: string[];
  externalDueDate: string | null;
  reviewerIds: string[];
  reviewDates: (string | null)[];
}

/**
 * From the active deliverables a person is involved in: those currently with
 * them, those of these due today (deadline or a review date), and those of
 * these overdue for them.
 */
export function deliverableSlices<T extends SliceableDeliverable>(
  involved: T[],
  personId: string,
  today: DayString,
): { mine: T[]; dueToday: T[]; overdue: T[] } {
  const mine = involved.filter((d) => d.currentlyWith.includes(personId));
  return {
    mine,
    dueToday: mine.filter((d) => d.externalDueDate === today || d.reviewDates.includes(today)),
    overdue: mine.filter((d) => isOverdueFor(d, personId, today)),
  };
}

/** By deadline, undated last — the order the list queries used to return. */
export function byDueDate<T extends { externalDueDate: string | null }>(a: T, b: T): number {
  return (a.externalDueDate ?? '9999-12-31').localeCompare(b.externalDueDate ?? '9999-12-31');
}
