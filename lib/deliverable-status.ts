// ── The deliverable status vocabulary ──────────────────────────────
//
// Every value `deliverables.status` holds is named here, and nowhere else.
// Code asks what a status *means* — finalized, delivered, closed, handed off —
// through the roles below instead of listing strings, because a dozen places
// listing their own subset is how "what counts as done" came to have six
// different answers. `npm run verify:status-literal` fails on a new bare
// status string outside this module.
//
// The strings are the stored values, not labels. `deliverables.status` is plain
// text with no CHECK constraint, and four SQL sites (two trigger functions
// among them) match on these exact values, so renaming one is a data migration,
// not an edit here. Per-firm labels are phase 2 of the plan in
// docs/multitenancy-followups.md → "Per-firm deliverable statuses".
//
// Client-safe: imports only lib/dates (Intl, no IO) and the shared colour
// tones; used by client components.

import { isCalendarDay, manilaToday, type DayString } from '@/lib/dates';
import { PILL_TONE, TONE_DOT, TONE_TEXT, type PillTone } from '@/components/ui/tone';

export const DELIVERABLE_STATUS = {
  NOT_STARTED: 'Not started',
  DRAFTING: 'Drafting',
  UNDER_REVIEW: 'Under Review',
  REVISING: 'Revising',
  FINALIZING: 'Finalizing',
  PRE_FINALIZED: 'Pre-finalized',
  OUTBOX: 'Outbox',
  FILED_OR_SENT_OUT: 'Filed or Sent out',
  AWAITING_CLIENT: 'Awaiting Client',
  SUBMITTED: 'Submitted',
  ACKNOWLEDGED: 'Acknowledged',
  ARCHIVED: 'Archived',
} as const;

export type DeliverableStatus = (typeof DELIVERABLE_STATUS)[keyof typeof DELIVERABLE_STATUS];

const S = DELIVERABLE_STATUS;

/** Every value `deliverables.status` may hold, in pipeline order. */
export const DELIVERABLE_STATUSES: readonly DeliverableStatus[] = [
  S.NOT_STARTED, S.DRAFTING, S.UNDER_REVIEW, S.REVISING, S.FINALIZING, S.PRE_FINALIZED,
  S.OUTBOX, S.AWAITING_CLIENT, S.FILED_OR_SENT_OUT, S.SUBMITTED, S.ACKNOWLEDGED, S.ARCHIVED,
];

export function isDeliverableStatus(value: unknown): value is DeliverableStatus {
  return typeof value === 'string' && (DELIVERABLE_STATUSES as readonly string[]).includes(value);
}

/**
 * The statuses a deliverable of this type can hold. Internal deliverables skip
 * review and finalization — Drafting → Submitted → Acknowledged — and have no
 * client to wait on or archive for (lib/deliverable-actions.ts). Every other
 * type runs the external pipeline, which never uses Submitted or Acknowledged.
 */
export const EXTERNAL_PIPELINE_STATUSES: readonly DeliverableStatus[] = [
  S.NOT_STARTED, S.DRAFTING, S.UNDER_REVIEW, S.REVISING, S.FINALIZING, S.PRE_FINALIZED,
  S.OUTBOX, S.AWAITING_CLIENT, S.FILED_OR_SENT_OUT, S.ARCHIVED,
];
export const INTERNAL_PIPELINE_STATUSES: readonly DeliverableStatus[] = [
  S.NOT_STARTED, S.DRAFTING, S.SUBMITTED, S.ACKNOWLEDGED,
];

export function statusesForType(type: string | null | undefined): readonly DeliverableStatus[] {
  return type === 'Internal' ? INTERNAL_PIPELINE_STATUSES : EXTERNAL_PIPELINE_STATUSES;
}

/**
 * The statuses a person may pick for a deliverable of this type from a status
 * dropdown. Archived is left out: archiving clears everyone's queue and has
 * its own confirmed action.
 */
export function pickableStatusesForType(type: string | null | undefined): readonly DeliverableStatus[] {
  return statusesForType(type).filter((s) => s !== S.ARCHIVED);
}

// ── Roles ──────────────────────────────────────────────────────────

/**
 * The work product is final: sent to the court or client, or acknowledged by
 * its internal recipients. Mirrors `deliverable_status_is_finalized()` in the
 * database, which the analysis triggers call — change both together.
 */
export const FINALIZED_STATUSES: readonly DeliverableStatus[] = [S.FILED_OR_SENT_OUT, S.ACKNOWLEDGED];

/** It reached the court or the client. What the portal shows as delivered. */
export const DELIVERED_STATUSES: readonly DeliverableStatus[] = [S.FILED_OR_SENT_OUT];

/** Nothing is left for anyone to do: finalized, or abandoned. Everything else is open work. */
export const CLOSED_STATUSES: readonly DeliverableStatus[] = [S.FILED_OR_SENT_OUT, S.ACKNOWLEDGED, S.ARCHIVED];

/**
 * Out of the drafting team's hands: closed, or an internal deliverable
 * submitted and waiting only for its recipients to acknowledge it. The view a
 * lawyer's own queue takes of "done".
 */
export const HANDED_OFF_STATUSES: readonly DeliverableStatus[] = [...CLOSED_STATUSES, S.SUBMITTED];

const within = (set: readonly string[]) => (status: string | null | undefined): boolean =>
  !!status && set.includes(status);

export const isFinalized = within(FINALIZED_STATUSES);
export const isDelivered = within(DELIVERED_STATUSES);
export const isClosed = within(CLOSED_STATUSES);
export const isHandedOff = within(HANDED_OFF_STATUSES);

/**
 * The day a deliverable went out, as `date_done` stores it. The person marking
 * it may name an earlier day (it is often recorded after the fact); with none,
 * it is today in Manila. A malformed, impossible or future day is refused (null).
 */
export function filedOnDay(value: unknown, today: DayString = manilaToday()): DayString | null {
  if (value === undefined || value === null || value === '') return today;
  if (typeof value !== 'string' || !isCalendarDay(value) || value > today) return null;
  return value;
}

// ── Board presentation ─────────────────────────────────────────────

/**
 * Board *layout*, not the status set: the columns an active-work board shows,
 * in order. Closed and internal-only statuses are deliberately absent.
 */
export const STATUS_ORDER: readonly DeliverableStatus[] = [
  S.NOT_STARTED, S.DRAFTING, S.UNDER_REVIEW, S.REVISING, S.FINALIZING, S.PRE_FINALIZED,
  S.AWAITING_CLIENT, S.OUTBOX,
];

/**
 * A deliverable's stage as a tone, read the same on every surface: blue while
 * it's being written, navy in review, amber while it waits on the client
 * (as a company's "Waiting on client" does), emerald once it's out.
 */
export const DELIVERABLE_STATUS_TONE: Record<string, PillTone> = {
  [S.NOT_STARTED]: 'neutral',
  [S.DRAFTING]: 'blue',
  [S.UNDER_REVIEW]: 'navy',
  [S.REVISING]: 'violet',
  [S.FINALIZING]: 'teal',
  [S.PRE_FINALIZED]: 'teal',
  [S.AWAITING_CLIENT]: 'amber',
  [S.OUTBOX]: 'sky',
  [S.FILED_OR_SENT_OUT]: 'emerald',
  [S.SUBMITTED]: 'navy',
  [S.ACKNOWLEDGED]: 'emerald',
  [S.ARCHIVED]: 'muted',
};

export function deliverableStatusTone(status: string | null | undefined): PillTone {
  return DELIVERABLE_STATUS_TONE[status ?? ''] ?? 'neutral';
}

function colorsFor(tone: PillTone) {
  return { dot: TONE_DOT[tone], text: TONE_TEXT[tone], badge: `border ${PILL_TONE[tone]}` };
}

export const STATUS_COLORS: Record<string, { dot: string; text: string; badge: string }> = Object.fromEntries(
  Object.entries(DELIVERABLE_STATUS_TONE).map(([status, tone]) => [status, colorsFor(tone)]),
);

export const DEFAULT_STATUS_COLOR = colorsFor('neutral');

export type StatusGroup = { status: string; items: { status: string; [key: string]: unknown }[] };

export function groupByStatus<T extends { status: string }>(items: T[]): { status: string; items: T[] }[] {
  const map = new Map<string, T[]>();
  for (const d of items) {
    const key = d.status || 'Unknown';
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(d);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => {
      const ai = (STATUS_ORDER as readonly string[]).indexOf(a);
      const bi = (STATUS_ORDER as readonly string[]).indexOf(b);
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    })
    .map(([status, items]) => ({ status, items }));
}

/**
 * Whether a deliverable is late for `personId`: its external deadline has
 * passed, or their own review date has. A reviewer listed more than once
 * answers to their latest date; other reviewers' dates are not theirs to miss.
 */
export function isOverdueFor(
  d: { externalDueDate: string | null; reviewerIds: string[]; reviewDates: (string | null)[] },
  personId: string,
  today: string,
): boolean {
  if (d.externalDueDate && d.externalDueDate < today) return true;
  const own = d.reviewerIds.lastIndexOf(personId);
  const reviewDate = own >= 0 ? d.reviewDates[own] : null;
  return !!reviewDate && reviewDate < today;
}
