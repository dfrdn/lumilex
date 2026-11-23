import type { Corporation } from '@/types/corporations';

/**
 * The recurring obligations a company carries once it is registered, and the
 * rule for when each falls due.
 *
 * One catalog, three readers: the year-1 spawn at registration
 * (lib/corporation-deadlines.ts), the nightly roll-forward
 * (lib/corporations/roll-forward.ts), and the status engine
 * (lib/corporations/status.ts). Before this the rules lived only in the year-1
 * spawn, so nothing after a company's first year was ever raised.
 *
 * Periods are fiscal years, numbered by the calendar year the fiscal year
 * ends in. A December year-end company's FY 2025 runs Jan–Dec 2025; its GIS,
 * AFS and ITR for FY 2025 all fall due in 2026.
 */

export type ObligationKey = 'gis' | 'afs' | 'itr' | 'permit' | 'bo' | 'asm' | 'org_meeting';

export type DeliverableObligation = 'gis' | 'afs' | 'itr';

export interface ObligationDef {
  key: ObligationKey;
  label: string;
  track: 'housekeeping' | 'compliance';
  /**
   * How the obligation is recorded: a deliverable the firm drafts and files,
   * the company record itself (permit dates), or evidence on file (a meeting
   * row, an uploaded declaration).
   */
  source: 'deliverable' | 'record';
  deliverableType?: 'SEC GIS' | 'SEC AFS' | 'BIR Filing';
}

export const OBLIGATIONS: Record<ObligationKey, ObligationDef> = {
  gis: { key: 'gis', label: 'General Information Sheet', track: 'compliance', source: 'deliverable', deliverableType: 'SEC GIS' },
  afs: { key: 'afs', label: 'Audited Financial Statements', track: 'compliance', source: 'deliverable', deliverableType: 'SEC AFS' },
  itr: { key: 'itr', label: 'BIR annual income tax return', track: 'compliance', source: 'deliverable', deliverableType: 'BIR Filing' },
  permit: { key: 'permit', label: 'Business permit renewal', track: 'compliance', source: 'record' },
  asm: { key: 'asm', label: "Annual stockholders' meeting", track: 'housekeeping', source: 'record' },
  org_meeting: { key: 'org_meeting', label: 'Organizational board meeting', track: 'housekeeping', source: 'record' },
  // Filed with the SEC alongside the GIS — a filing, so compliance.
  bo: { key: 'bo', label: 'Beneficial ownership declaration', track: 'compliance', source: 'record' },
};

export const DELIVERABLE_OBLIGATIONS: DeliverableObligation[] = ['gis', 'afs', 'itr'];

/**
 * The reportorial requirements the firm may or may not file for a company,
 * one switch each (`corporations.firm_files`). Housekeeping and a retainer
 * don't imply any of them: the AFS and ITR are usually the auditor's or
 * accountant's, and the GIS is filed only for some of the companies the firm
 * carries. The beneficial-ownership declaration goes with the GIS.
 */
export type FirmFiling = 'gis' | 'afs' | 'itr' | 'permit';

export const FIRM_FILINGS: { key: FirmFiling; label: string }[] = [
  { key: 'gis', label: 'GIS' },
  { key: 'afs', label: 'AFS' },
  { key: 'itr', label: 'Annual ITR' },
  { key: 'permit', label: 'Business permit' },
];

export function isFirmFiling(v: unknown): v is FirmFiling {
  return FIRM_FILINGS.some((f) => f.key === v);
}

/**
 * Whether the firm carries the company's recurring obligations. Housekeeping
 * engagements and retainers do; an incorporation-only or post-incorporation-
 * only engagement does not — those companies' filings are shown as "not
 * ours" rather than chased.
 */
export function firmHandlesRecurring(c: Pick<Corporation, 'handlesHousekeeping' | 'isUnderRetainer'>): boolean {
  return c.handlesHousekeeping || c.isUnderRetainer;
}

/**
 * Whether the firm handles one obligation for the company: a filing when its
 * switch is on, a meeting when the firm carries the company's housekeeping.
 */
export function firmHandles(
  c: Pick<Corporation, 'handlesHousekeeping' | 'isUnderRetainer' | 'firmFiles'>,
  key: ObligationKey,
): boolean {
  if (key === 'asm' || key === 'org_meeting') return firmHandlesRecurring(c);
  return c.firmFiles.includes(key === 'bo' ? 'gis' : key);
}

// ── Dates ──────────────────────────────────────────────────────────────────

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function toISO(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

function ymd(year: number, month0: number, day: number): string {
  return toISO(new Date(Date.UTC(year, month0, day)));
}

function lastDayOfMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return toISO(d);
}

function fyEndMonth(c: Pick<Corporation, 'fiscalYearEndMonth'>): number {
  const m = c.fiscalYearEndMonth;
  return m && m >= 1 && m <= 12 ? m : 12;
}

/** Last day of the fiscal year `fy`. */
export function fiscalYearEnd(c: Pick<Corporation, 'fiscalYearEndMonth'>, fy: number): string {
  const m = fyEndMonth(c);
  return ymd(fy, m - 1, lastDayOfMonth(fy, m));
}

/** The fiscal year a date falls in. */
export function fiscalYearOf(c: Pick<Corporation, 'fiscalYearEndMonth'>, iso: string): number {
  const y = Number(iso.slice(0, 4));
  return iso.slice(0, 10) <= fiscalYearEnd(c, y) ? y : y + 1;
}

/** The company's first fiscal year: the one its registration falls in. */
export function firstFiscalYear(c: Pick<Corporation, 'fiscalYearEndMonth' | 'secRegistrationDate'>): number | null {
  const reg = c.secRegistrationDate;
  return reg ? fiscalYearOf(c, reg) : null;
}

/**
 * The by-laws annual meeting that reports on fiscal year `fy`: the first
 * by-laws date after the year closes. Null when the by-laws date isn't on
 * record.
 */
export function bylawsMeetingFor(
  c: Pick<Corporation, 'fiscalYearEndMonth' | 'annualMeetingMonth' | 'annualMeetingDay'>,
  fy: number,
): string | null {
  const month1 = c.annualMeetingMonth;
  const day = c.annualMeetingDay;
  if (!month1 || !day) return null;
  const after = fiscalYearEnd(c, fy);
  for (let year = fy; year <= fy + 1; year++) {
    const candidate = ymd(year, month1 - 1, Math.min(day, lastDayOfMonth(year, month1)));
    if (candidate > after) return candidate;
  }
  return null;
}

// ── The filing calendar ────────────────────────────────────────────────────

/**
 * A deadline the SEC or BIR set for one year's filings by December year-end
 * companies (`compliance_calendar`). These move year to year — SEC MC No.
 * 9-2026 replaced the AFS stagger by registration digit with one date, then
 * the Commission extended it — so they are data the firm keeps current, not
 * rules in code.
 */
export interface FilingCalendarEntry {
  obligation: 'afs' | 'itr';
  /** The calendar year the filing is due in. */
  filingYear: number;
  dueDate: string | null;
  /** The date as the circular first set it, when an extension has since moved `dueDate`. */
  originalDueDate?: string | null;
  /** Last digit of the SEC registration number → "MM-DD" within filingYear. */
  digitSchedule: Record<string, string> | null;
  source: string | null;
}

/** The SRC Rule 68 stagger by registration digit, used before any calendar entry. */
const LEGACY_AFS_SCHEDULE: Record<string, string> = {
  '1': '04-30', '2': '04-30',
  '3': '05-15', '4': '05-15',
  '5': '05-30', '6': '05-30',
  '7': '06-15', '8': '06-15',
  '9': '06-30', '0': '06-30',
};

function regDigit(regNo: string | null | undefined): string {
  const d = (regNo ?? '').replace(/\D/g, '').slice(-1);
  return d || '0';
}

function fromEntry(
  entry: Pick<FilingCalendarEntry, 'dueDate' | 'originalDueDate' | 'digitSchedule'>,
  year: number,
  regNo: string | null | undefined,
  { asFirstSet = false } = {},
): string | null {
  const fixed = (asFirstSet && entry.originalDueDate) || entry.dueDate;
  if (fixed) return `${year}${fixed.slice(4, 10)}`;
  const md = entry.digitSchedule?.[regDigit(regNo)];
  return md ? `${year}-${md}` : null;
}

export interface DueInfo {
  date: string | null;
  /**
   * The year's deadline hasn't been entered in the filing calendar; the date
   * is projected from the latest year that has.
   */
  provisional: boolean;
  source: string | null;
}

/**
 * A December year-end company's AFS or ITR deadline in `year`: the calendar
 * entry for that year when there is one.
 *
 * Otherwise the AFS is projected from the latest earlier entry as its circular
 * first set it — an extension is a one-off, and projecting it forward would
 * show the board a later date than the SEC is likely to set. The ITR is not
 * projected at all: the statutory 15 April stands until that year's extension,
 * if any, is entered. With no entry at all the AFS falls back to the old
 * registration-digit stagger.
 */
function calendarDue(
  obligation: 'afs' | 'itr',
  year: number,
  regNo: string | null | undefined,
  calendar: FilingCalendarEntry[],
): DueInfo {
  const rows = calendar.filter((e) => e.obligation === obligation);
  const exact = rows.find((e) => e.filingYear === year);
  if (exact) return { date: fromEntry(exact, year, regNo), provisional: false, source: exact.source };
  if (obligation === 'itr') return { date: `${year}-04-15`, provisional: false, source: 'NIRC §77 (15 April)' };
  const earlier = rows.filter((e) => e.filingYear < year).sort((a, b) => b.filingYear - a.filingYear)[0];
  if (earlier) {
    return {
      date: fromEntry(earlier, year, regNo, { asFirstSet: true }),
      provisional: true,
      source: `Projected from ${earlier.filingYear}${earlier.source ? ` (${earlier.source})` : ''}`,
    };
  }
  return { date: `${year}-${LEGACY_AFS_SCHEDULE[regDigit(regNo)]}`, provisional: false, source: null };
}

/** AFS: the filing calendar for December year-ends; 120 days after year end otherwise. */
function afsDue(c: Pick<Corporation, 'fiscalYearEndMonth' | 'secRegistrationNo'>, fy: number, calendar: FilingCalendarEntry[]): DueInfo {
  if (fyEndMonth(c) !== 12) return { date: addDays(fiscalYearEnd(c, fy), 120), provisional: false, source: null };
  return calendarDue('afs', fy + 1, c.secRegistrationNo, calendar);
}

/**
 * ITR: the filing calendar for December year-ends; otherwise the 15th day of
 * the fourth month after year end (NIRC §77).
 */
function itrDue(c: Pick<Corporation, 'fiscalYearEndMonth' | 'secRegistrationNo'>, fy: number, calendar: FilingCalendarEntry[]): DueInfo {
  const m = fyEndMonth(c);
  if (m === 12) return calendarDue('itr', fy + 1, c.secRegistrationNo, calendar);
  const total = m - 1 + 4; // 0-based month index, may roll into next year
  return { date: ymd(fy + Math.floor(total / 12), total % 12, 15), provisional: false, source: null };
}

export interface DueInput {
  corporation: Corporation;
  /**
   * The annual meeting actually held for this fiscal year, when one is on
   * record — it, not the by-laws date, starts the GIS clock.
   */
  heldAnnualMeeting?: string | null;
  calendar?: FilingCalendarEntry[];
}

/**
 * When obligation `key` for fiscal year `fy` falls due. Null when the record
 * doesn't hold what the rule needs (no by-laws meeting date for the meetings).
 */
export function dueDate(key: ObligationKey, fy: number, input: DueInput): string | null {
  return dueDateInfo(key, fy, input).date;
}

/** `dueDate`, with whether the date is provisional and where it comes from. */
export function dueDateInfo(key: ObligationKey, fy: number, { corporation: c, heldAnnualMeeting, calendar = [] }: DueInput): DueInfo {
  if (key === 'afs') return afsDue(c, fy, calendar);
  if (key === 'itr') return itrDue(c, fy, calendar);
  return { date: ruleDue(key, fy, c, heldAnnualMeeting ?? null), provisional: false, source: null };
}

function ruleDue(key: Exclude<ObligationKey, 'afs' | 'itr'>, fy: number, c: Corporation, heldAnnualMeeting: string | null): string | null {
  switch (key) {
    case 'gis':
    case 'bo': {
      // SEC MC 01-2025: 30 days after the annual meeting actually held. Before
      // it is held the by-laws date is the forecast; without one, year end.
      const meeting = heldAnnualMeeting ?? bylawsMeetingFor(c, fy) ?? fiscalYearEnd(c, fy);
      return addDays(meeting, 30);
    }
    case 'asm':
    case 'org_meeting':
      return heldAnnualMeeting ?? bylawsMeetingFor(c, fy);
    case 'permit':
      // LGC §167: renew within the first twenty days of January. Permits are
      // calendar-year, so "fy" here is the permit year being renewed into.
      return `${fy}-01-20`;
  }
}

// ── Names ──────────────────────────────────────────────────────────────────

export function companyName(c: Pick<Corporation, 'approvedName' | 'proposedNames'>): string {
  return c.approvedName ?? c.proposedNames?.[0] ?? 'Corporation';
}

/**
 * The deliverable name for a filing. Every name carries the company — several
 * companies can share a billing matter — and ends in the period, which
 * `yearOf` (filing-history.ts) reads back.
 */
export function deliverableName(key: DeliverableObligation, c: Corporation, fy: number): string {
  const who = companyName(c);
  switch (key) {
    case 'gis': return `SEC GIS — ${who} (${fy})`;
    case 'afs': return `SEC AFS — ${who} (FY ${fy})`;
    case 'itr': return `BIR 1702-RT (Annual Income Tax) — ${who} (FY ${fy})`;
  }
}

/**
 * Which obligation a compliance deliverable is, or null for one outside the
 * catalog (the repealed BIR 0605, ad-hoc "Other Compliance" items).
 */
export function obligationOfDeliverable(d: { type: string; name: string }): DeliverableObligation | null {
  if (d.type === 'SEC GIS') return 'gis';
  if (d.type === 'SEC AFS') return 'afs';
  if (d.type === 'BIR Filing' && /1702/.test(d.name)) return 'itr';
  return null;
}
