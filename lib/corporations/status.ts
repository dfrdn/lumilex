import type { Corporation, CorporationFile, CorporationMeeting, CorporationPerson } from '@/types/corporations';
import { buildLifecyclePlan, postIncorporationItems, type ItemAction, type StageItem } from '@/lib/corporations/stages';
import { isFiled, yearOf } from '@/lib/corporations/filing-history';
import { DELIVERABLE_STATUS } from '@/lib/deliverable-status';
import { hasBusinessPermit } from '@/lib/corporations/permit-task';
import { spanOfDays } from '@/lib/dates';
import {
  OBLIGATIONS,
  dueDateInfo,
  firmHandles,
  firstFiscalYear,
  fiscalYearEnd,
  fiscalYearOf,
  obligationOfDeliverable,
  type FilingCalendarEntry,
  type ObligationKey,
} from '@/lib/corporations/obligations';
import { addDays } from '@/lib/dates';

/**
 * Where a company stands, as four tracks — application, registrations,
 * housekeeping, compliance — each a list of items in one vocabulary of
 * states. Derived entirely from the record on every read: nothing here is
 * stored, so the company page, the registry and the client portal cannot
 * disagree with each other or with the data.
 */

export type TrackKey = 'application' | 'registrations' | 'housekeeping' | 'compliance';

export type ItemState =
  | 'not_started'
  | 'in_progress'
  | 'waiting_on_client'
  | 'filed'
  | 'done'
  | 'overdue'
  | 'not_ours';

export type Health = 'red' | 'amber' | 'green' | 'grey';

export interface StatusItem {
  key: string;
  label: string;
  detail?: string;
  state: ItemState;
  dueDate: string | null;
  /** The due date is projected — the year's deadline isn't in the filing calendar yet. */
  provisional?: boolean;
  /** Fiscal year (filings, meetings) or permit year the item is for. */
  period?: number;
  deliverableId?: string | null;
  action?: ItemAction;
}

export interface TrackStatus {
  key: TrackKey;
  label: string;
  health: Health;
  items: StatusItem[];
  /** Items finished, of those the firm carries. */
  done: number;
  total: number;
  /** The most pressing unfinished item. */
  next: StatusItem | null;
  summary: string;
  /** A file request to the client is open on this track's matter. */
  waitingOnClient: boolean;
}

/**
 * Where the company is in its life. A company is applied for, then set up
 * (post-registration), then kept up (housekeeping and compliance) — one phase
 * at a time, not all four tracks at once.
 */
export type Phase = 'application' | 'post_registration' | 'ongoing' | 'dissolved';

export interface CorporationStatus {
  tracks: TrackStatus[];
  phase: Phase;
  /**
   * The tracks to put in front of someone: the current phase's, plus any later
   * track that already has something overdue, due soon or waiting — a first
   * GIS can fall due while post-registration is still open.
   */
  focus: TrackKey[];
  health: Health;
  overdue: number;
  dueSoon: number;
  waitingOnClient: boolean;
}

export interface StatusDeliverable {
  notionId: string;
  type: string;
  name: string;
  externalDueDate: string | null;
  status: string;
}

export interface StatusInput {
  corporation: Corporation;
  files: CorporationFile[];
  people: CorporationPerson[];
  /** The company's own compliance deliverables (getDeliverablesForCorporation). */
  deliverables: StatusDeliverable[];
  meetings: Pick<CorporationMeeting, 'meetingType' | 'meetingDate' | 'minutesStatus'>[];
  /** Matters with a file request to the client still open. */
  openRequestMatterIds?: string[];
  calendar?: FilingCalendarEntry[];
  /** YYYY-MM-DD, Manila. */
  today: string;
}

export const DUE_SOON_DAYS = 30;

/** Today in Manila, YYYY-MM-DD — the firm's calendar day, wherever this runs. */
export function manilaToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date());
}

const COMPLETE: ItemState[] = ['done', 'filed', 'not_ours'];

export const TRACK_LABEL: Record<TrackKey, string> = {
  application: 'Application',
  registrations: 'Registrations',
  housekeeping: 'Housekeeping',
  compliance: 'Compliance',
};

/** "3 days overdue", "Due today", "In 12 days", "Due 15 Jun 2027". */
export function relativeDue(due: string | null, today: string): string | null {
  if (!due) return null;
  const d = Math.round((Date.parse(`${due}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  if (d === 0) return 'Due today';
  if (d < 0) return `${spanOfDays(d)} overdue`;
  if (d === 1) return 'Due tomorrow';
  if (d < 45) return `In ${d} days`;
  return `Due ${shortDate(due)}`;
}

/** "15 Jun 2027" — Manila locale, date-only. */
export function shortDate(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  return d.toLocaleDateString('en-PH', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

// ── Item builders ──────────────────────────────────────────────────────────

function fromStageItem(i: StageItem, carried: boolean): StatusItem {
  return {
    key: i.key,
    label: i.label,
    detail: i.detail,
    state: i.done ? 'done' : carried ? 'not_started' : 'not_ours',
    dueDate: null,
    action: i.action,
  };
}

/** The annual meeting held for fiscal year `fy`, if one is on record. */
function heldMeeting(input: StatusInput, type: CorporationMeeting['meetingType'], fy: number) {
  const c = input.corporation;
  return input.meetings
    .filter((m) => m.meetingType === type && m.meetingDate && fiscalYearOf(c, m.meetingDate) - 1 === fy)
    .sort((a, b) => a.meetingDate.localeCompare(b.meetingDate))[0];
}

function stateByDate(due: string | null, today: string, fallback: ItemState = 'not_started'): ItemState {
  return due && due < today ? 'overdue' : fallback;
}

/** One obligation for one period. */
function obligationItem(key: ObligationKey, fy: number, input: StatusInput, carried: boolean): StatusItem {
  const { corporation: c, today } = input;
  const def = OBLIGATIONS[key];
  const asm = heldMeeting(input, 'Annual Stockholders', fy);
  const info = dueDateInfo(key, fy, { corporation: c, heldAnnualMeeting: asm?.meetingDate ?? null, calendar: input.calendar });
  const base: StatusItem = {
    key: `${key}-${fy}`,
    label: key === 'permit' ? `${def.label} ${fy}` : `${def.label} FY ${fy}`,
    state: 'not_started',
    dueDate: info.date,
    provisional: info.provisional || undefined,
    period: fy,
  };

  if (def.source === 'deliverable') {
    const rows = input.deliverables.filter(
      (d) => obligationOfDeliverable(d) === key && yearOf({ ...d }) === fy,
    );
    // A double-spawned year: the row that was acted on is the record.
    const row = rows.find((d) => isFiled(d.status)) ?? rows.find((d) => d.status !== DELIVERABLE_STATUS.ARCHIVED) ?? rows[0];
    const evidence = (key === 'gis' || key === 'afs')
      && input.files.some((f) => f.category === (key === 'gis' ? 'GIS' : 'AFS') && f.filingYear === fy);
    if (row) {
      base.deliverableId = row.notionId;
      base.dueDate = row.externalDueDate ?? base.dueDate;
      base.provisional = row.externalDueDate ? undefined : base.provisional;
    }
    if (evidence) return { ...base, state: 'done' };
    if (row && isFiled(row.status)) return { ...base, state: 'filed', detail: key === 'itr' ? undefined : 'Filed copy not uploaded' };
    if (row?.status === DELIVERABLE_STATUS.ARCHIVED) return { ...base, state: 'not_ours', detail: DELIVERABLE_STATUS.ARCHIVED };
    if (!carried) return { ...base, state: 'not_ours' };
    const working = row && row.status !== DELIVERABLE_STATUS.NOT_STARTED ? 'in_progress' : 'not_started';
    const state = stateByDate(base.dueDate, today, working);
    return { ...base, state, detail: state === 'overdue' && !row ? 'No filing on record' : undefined };
  }

  if (!carried) return { ...base, state: 'not_ours' };

  switch (key) {
    case 'asm': {
      if (asm) {
        return asm.minutesStatus === 'Signed'
          ? { ...base, state: 'done', dueDate: asm.meetingDate }
          : { ...base, state: 'in_progress', dueDate: asm.meetingDate, detail: 'Held — minutes not yet signed' };
      }
      if (!base.dueDate) return { ...base, detail: 'Annual meeting date not on the record', action: { kind: 'field', tab: 'overview' } };
      return { ...base, state: stateByDate(base.dueDate, today) };
    }
    case 'org_meeting': {
      const after = asm?.meetingDate ?? fiscalYearEnd(c, fy);
      const org = input.meetings
        .filter((m) => m.meetingType === 'Organizational' && m.meetingDate > after && fiscalYearOf(c, m.meetingDate) - 1 === fy)
        .sort((a, b) => a.meetingDate.localeCompare(b.meetingDate))[0];
      if (org) {
        return org.minutesStatus === 'Signed'
          ? { ...base, state: 'done', dueDate: org.meetingDate }
          : { ...base, state: 'in_progress', dueDate: org.meetingDate, detail: 'Held — minutes not yet signed' };
      }
      if (!base.dueDate) return { ...base, detail: 'Follows the annual meeting' };
      return { ...base, state: stateByDate(base.dueDate, today) };
    }
    case 'bo': {
      // The beneficial-ownership information sheet is part of the GIS (SEC MC
      // 15-2019), so a filed GIS carries that year's declaration; a separate
      // declaration on file counts too.
      const declared = input.files.some((f) => f.category === 'Beneficial Ownership Declaration' && f.filingYear === fy);
      const gis = obligationItem('gis', fy, input, carried);
      if (declared || gis.state === 'done') return { ...base, state: 'done' };
      if (gis.state === 'filed') return { ...base, state: 'filed', detail: 'With the GIS' };
      return { ...base, state: stateByDate(base.dueDate, today), action: { kind: 'upload', category: 'Beneficial Ownership Declaration' } };
    }
    case 'permit': {
      // Permits are calendar-year; one issued in `fy` is the renewal for `fy`.
      const issuedYear = Number((c.businessPermitIssuedDate ?? '').slice(0, 4)) || null;
      if (issuedYear !== null && issuedYear >= fy) return { ...base, state: 'done' };
      const state = stateByDate(base.dueDate, today);
      return { ...base, state, detail: state === 'overdue' ? `No ${fy} permit on record` : undefined, action: { kind: 'field', tab: 'registrations' } };
    }
    default:
      return base;
  }
}

/**
 * The periods worth showing for an obligation: the next one still to fall due,
 * and the one before it while it is unfinished — plus any older period whose
 * deliverable is still open.
 */
function obligationItems(key: ObligationKey, input: StatusInput, carried: boolean): StatusItem[] {
  const c = input.corporation;
  const fy0 = firstFiscalYear(c);
  if (fy0 === null) return [];

  if (key === 'permit') {
    if (!hasBusinessPermit(c)) return [];
    // The renewal after the last permit on record — or, when years have gone
    // unrecorded, this year's, which is the one that still matters.
    const issued = c.businessPermitIssuedDate ?? c.businessPermitExpiryDate;
    const lastYear = Number((issued ?? input.today).slice(0, 4));
    const thisYear = Number(input.today.slice(0, 4));
    return [obligationItem('permit', Math.max(lastYear + 1, thisYear), input, carried)];
  }

  const start = Math.max(fy0, fiscalYearOf(c, input.today) - 2);
  let next = start;
  for (let fy = start; fy <= start + 4; fy++) {
    const due = obligationItem(key, fy, input, carried).dueDate;
    next = fy;
    if (due && due >= input.today) break;
    if (!due && fy >= fiscalYearOf(c, input.today) - 1) break;
  }

  const fys = new Set<number>([next]);
  if (next - 1 >= fy0) fys.add(next - 1);
  if (OBLIGATIONS[key].source === 'deliverable') {
    for (const d of input.deliverables) {
      if (obligationOfDeliverable(d) !== key || isFiled(d.status) || d.status === DELIVERABLE_STATUS.ARCHIVED) continue;
      const fy = yearOf({ ...d });
      if (fy !== null && fy >= fy0 && fy < next) fys.add(fy);
    }
  }

  return [...fys]
    .sort((a, b) => a - b)
    .map((fy) => obligationItem(key, fy, input, carried))
    // An earlier period stays only while unfinished, and only when it has a
    // date — an undated meeting would otherwise repeat once per year.
    .filter((item) => item.period === next || (!COMPLETE.includes(item.state) && item.dueDate !== null));
}

// ── Tracks ─────────────────────────────────────────────────────────────────

function track(key: TrackKey, items: StatusItem[], input: StatusInput, opts: { waitingOnClient?: boolean; emptySummary?: string } = {}): TrackStatus {
  const { today } = input;
  const waiting = !!opts.waitingOnClient;
  const live = items.map((i) =>
    waiting && (i.state === 'not_started' || i.state === 'in_progress') ? { ...i, state: 'waiting_on_client' as const } : i,
  );
  const carried = live.filter((i) => i.state !== 'not_ours');
  const done = carried.filter((i) => i.state === 'done' || i.state === 'filed').length;
  const open = carried.filter((i) => !COMPLETE.includes(i.state));
  const soon = addDays(today, DUE_SOON_DAYS);
  const overdue = open.filter((i) => i.state === 'overdue');
  const dueSoon = open.filter((i) => i.state !== 'overdue' && i.dueDate && i.dueDate <= soon);

  let health: Health;
  if (carried.length === 0) health = 'grey';
  else if (overdue.length) health = 'red';
  else if (dueSoon.length || open.some((i) => i.state === 'waiting_on_client')) health = 'amber';
  else health = 'green';

  const rank = (i: StatusItem) => (i.state === 'overdue' ? 0 : 1);
  const next = [...open].sort((a, b) => rank(a) - rank(b) || (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'))[0] ?? null;

  let summary: string;
  if (carried.length === 0) summary = items.length ? 'Not handled by the firm' : opts.emptySummary ?? 'Nothing to do';
  else if (overdue.length) summary = `${overdue.length} overdue`;
  else if (next?.state === 'waiting_on_client') summary = 'Waiting on client';
  else if (next) summary = next.dueDate ? `${next.label} — due ${shortDate(next.dueDate)}` : next.label;
  else summary = 'All current';

  return { key, label: TRACK_LABEL[key], health, items: live, done, total: carried.length, next, summary, waitingOnClient: waiting };
}

function openOn(input: StatusInput, ...matterIds: (string | null)[]): boolean {
  const open = new Set(input.openRequestMatterIds ?? []);
  return matterIds.some((m) => m && open.has(m));
}

export function buildCorporationStatus(input: StatusInput): CorporationStatus {
  const c = input.corporation;

  if (c.status === 'Dissolved') {
    const tracks = (Object.keys(TRACK_LABEL) as TrackKey[]).map((k) => track(k, [], input, { emptySummary: 'Dissolved' }));
    return { tracks, phase: 'dissolved', focus: [], health: 'grey', overdue: 0, dueSoon: 0, waitingOnClient: false };
  }

  const registered = !!c.secRegistrationDate;
  const plan = buildLifecyclePlan(input);

  // Application: the pre-registration stages. Once registered it is history,
  // so its items are complete whatever the record kept of them.
  const applicationItems = plan.stages
    .filter((s) => s.key === 'pre_incorporation' || s.key === 'in_sec' || s.key === 'registered')
    .flatMap((s) => s.items)
    .map((i) => (registered ? { ...fromStageItem(i, true), state: 'done' as const } : fromStageItem(i, c.handlesIncorporation)));
  const application = registered
    ? { ...track('application', applicationItems, input), summary: `Registered ${shortDate(c.secRegistrationDate!)}` }
    : track('application', applicationItems, input, { waitingOnClient: openOn(input, c.incorporationMatterId) });

  const registrations = registered
    ? track('registrations', postIncorporationItems(c, input.files).map((i) => fromStageItem(i, c.handlesPostIncorporation)), input, {
        waitingOnClient: openOn(input, c.postIncorporationMatterId),
      })
    : track('registrations', [], input, { emptySummary: 'Starts after SEC registration' });

  const recurringWaiting = openOn(input, c.housekeepingMatterId, c.retainerMatterId);
  const housekeeping = registered
    ? track('housekeeping', (['asm', 'org_meeting'] as const).flatMap((k) => obligationItems(k, input, firmHandles(c, k))), input, {
        waitingOnClient: recurringWaiting,
      })
    : track('housekeeping', [], input, { emptySummary: 'Starts after SEC registration' });
  const compliance = registered
    ? track('compliance', (['gis', 'afs', 'itr', 'bo', 'permit'] as const).flatMap((k) => obligationItems(k, input, firmHandles(c, k))), input, {
        waitingOnClient: recurringWaiting,
      })
    : track('compliance', [], input, { emptySummary: 'Starts after SEC registration' });

  const tracks = [application, registrations, housekeeping, compliance];

  const registrationsOpen = registrations.items.some((i) => !COMPLETE.includes(i.state));
  const phase: Phase = !registered ? 'application' : registrationsOpen ? 'post_registration' : 'ongoing';
  const urgent = (t: TrackStatus) => t.health === 'red' || t.health === 'amber';
  const focus: TrackKey[] =
    phase === 'application'
      ? ['application']
      : phase === 'post_registration'
        ? ['registrations', ...[housekeeping, compliance].filter(urgent).map((t) => t.key)]
        : ['housekeeping', 'compliance'];
  const healths = tracks.map((t) => t.health);
  const health: Health = healths.includes('red') ? 'red' : healths.includes('amber') ? 'amber' : healths.includes('green') ? 'green' : 'grey';
  const soon = addDays(input.today, DUE_SOON_DAYS);
  const all = tracks.flatMap((t) => t.items);
  return {
    tracks,
    phase,
    focus,
    health,
    overdue: all.filter((i) => i.state === 'overdue').length,
    dueSoon: all.filter((i) => !COMPLETE.includes(i.state) && i.state !== 'overdue' && i.dueDate && i.dueDate <= soon).length,
    waitingOnClient: tracks.some((t) => t.waitingOnClient),
  };
}

// ── Compliance grid ────────────────────────────────────────────────────────

export const GRID_COLUMNS = ['gis', 'afs', 'itr', 'bo', 'asm'] as const;
export type GridColumn = (typeof GRID_COLUMNS)[number];

export interface ComplianceGridRow {
  fy: number;
  cells: Record<GridColumn, StatusItem>;
}

/**
 * Fiscal year × recurring obligation, newest first: the current fiscal year
 * (whose filings fall due next) and up to `years - 1` before it, never earlier
 * than the company's first.
 */
export function buildComplianceGrid(input: StatusInput, years = 5): ComplianceGridRow[] {
  const c = input.corporation;
  const fy0 = firstFiscalYear(c);
  if (fy0 === null || !c.secRegistrationDate || c.status === 'Dissolved') return [];
  const current = fiscalYearOf(c, input.today);
  const rows: ComplianceGridRow[] = [];
  for (let fy = current; fy >= Math.max(fy0, current - years + 1); fy--) {
    const cells = {} as Record<GridColumn, StatusItem>;
    for (const key of GRID_COLUMNS) cells[key] = obligationItem(key, fy, input, firmHandles(c, key));
    rows.push({ fy, cells });
  }
  return rows;
}
