import { daysBetween, type DayString } from '@/lib/dates';
import { DELIVERABLE_STATUS, isClosed, isOverdueFor } from '@/lib/deliverable-status';

/**
 * The dashboard's My deliverables list: what is with the person now, grouped
 * by the step it waits on them for. A reviewer's own review date counts as
 * their date, as it does for "overdue" everywhere else. Work waiting on the
 * client is shown apart and never counts as overdue on the person: there is
 * nothing they can do on it.
 */

export type MyDeliverableStep = 'review' | 'file' | 'draft' | 'client';

export const STEP_ORDER: MyDeliverableStep[] = ['review', 'file', 'draft', 'client'];

interface Row {
  status: string;
  currentlyWith: string[];
  reviewerIds: string[];
  externalDueDate: string | null;
  reviewDates: (string | null)[];
}

/** Still on the person's desk: with them, and not done. */
export function isWithMe(d: Pick<Row, 'status' | 'currentlyWith'>, me: string): boolean {
  return d.currentlyWith.includes(me) && !isClosed(d.status);
}

/** What the deliverable waits on the person for, read from its status. */
export function stepOf(status: string): MyDeliverableStep {
  switch (status) {
    case DELIVERABLE_STATUS.UNDER_REVIEW:
    case DELIVERABLE_STATUS.SUBMITTED:
      return 'review';
    case DELIVERABLE_STATUS.FINALIZING:
    case DELIVERABLE_STATUS.OUTBOX:
      return 'file';
    case DELIVERABLE_STATUS.AWAITING_CLIENT:
      return 'client';
    default:
      return 'draft';
  }
}

/** Their own (latest) review date, when they are a reviewer. */
export function myReviewDate(d: Pick<Row, 'reviewerIds' | 'reviewDates'>, me: string): string | null {
  const i = d.reviewerIds.lastIndexOf(me);
  return i >= 0 ? d.reviewDates[i] ?? null : null;
}

/** The date that binds the person: the earlier of the deadline and their own review date. */
export function myDate(d: Row, me: string): DayString | null {
  const dates = [d.externalDueDate, myReviewDate(d, me)].filter((x): x is string => !!x);
  return dates.length ? dates.sort()[0] : null;
}

/** Late on the person: with them, past their date, and not waiting on the client. */
export function countsAsOverdue(d: Row, me: string, today: DayString): boolean {
  return isWithMe(d, me) && stepOf(d.status) !== 'client' && isOverdueFor(d, me, today);
}

/** Days past the person's date, or 0 when it isn't past. */
export function daysLate(d: Row, me: string, today: DayString): number {
  const date = myDate(d, me);
  return date && date < today ? daysBetween(date, today) : 0;
}

/**
 * The person's deliverables by step. Within a step, overdue first and most
 * recently missed first (what just slipped can still be saved; a long-stale
 * backlog shouldn't bury it), then by date, undated last.
 */
export function groupMyDeliverables<T extends Row>(
  rows: T[],
  me: string,
  today: DayString,
  /** Court work goes ahead of other work on the same date. */
  isCourt: (d: T) => boolean = () => false,
): Record<MyDeliverableStep, T[]> {
  const out: Record<MyDeliverableStep, T[]> = { review: [], file: [], draft: [], client: [] };
  for (const d of rows) if (isWithMe(d, me)) out[stepOf(d.status)].push(d);
  const rank = (d: T) => {
    const date = myDate(d, me);
    const late = isOverdueFor(d, me, today);
    return { late, date: date ?? '9999-12-31' };
  };
  for (const step of STEP_ORDER) {
    out[step].sort((a, b) => {
      const ra = rank(a);
      const rb = rank(b);
      if (ra.late !== rb.late) return ra.late ? -1 : 1;
      const byDate = ra.late ? rb.date.localeCompare(ra.date) : ra.date.localeCompare(rb.date);
      return byDate || Number(isCourt(b)) - Number(isCourt(a));
    });
  }
  return out;
}

// ── Up next ─────────────────────────────────────────────────────

interface UpNextHearing {
  id: string;
  name: string;
  /** ISO start. */
  date: string | null;
  status: string;
}

export type UpNext<T> =
  | { kind: 'hearing'; hearing: UpNextHearing }
  | { kind: 'deliverable'; deliverable: T; reason: 'court-today' | 'overdue' | 'today' };

/** A hearing still counts as next for half an hour after it starts. */
const HEARING_GRACE_MS = 30 * 60 * 1000;

/**
 * The single most time-critical thing for the person right now: their next
 * hearing today; else court work due today; else what most recently went
 * overdue (court first on the same date); else anything due today.
 */
export function pickUpNext<T extends Row & { matterId: string | null }>(
  hearingsToday: UpNextHearing[],
  deliverables: T[],
  courtMatterIds: ReadonlySet<string>,
  me: string,
  today: DayString,
  now: Date,
): UpNext<T> | null {
  const next = hearingsToday
    .filter((h) => h.date && h.status !== 'Cancelled' && new Date(h.date).getTime() >= now.getTime() - HEARING_GRACE_MS)
    .sort((a, b) => a.date!.localeCompare(b.date!))[0];
  if (next) return { kind: 'hearing', hearing: next };

  const isCourt = (d: T) => !!d.matterId && courtMatterIds.has(d.matterId);
  const open = deliverables.filter((d) => isWithMe(d, me) && stepOf(d.status) !== 'client');
  const dueToday = open.filter((d) => myDate(d, me) === today);

  const courtToday = dueToday.find(isCourt);
  if (courtToday) return { kind: 'deliverable', deliverable: courtToday, reason: 'court-today' };

  const late = open
    .filter((d) => countsAsOverdue(d, me, today))
    .sort((a, b) => (myDate(b, me) ?? '').localeCompare(myDate(a, me) ?? '') || Number(isCourt(b)) - Number(isCourt(a)))[0];
  if (late) return { kind: 'deliverable', deliverable: late, reason: 'overdue' };

  return dueToday[0] ? { kind: 'deliverable', deliverable: dueToday[0], reason: 'today' } : null;
}
