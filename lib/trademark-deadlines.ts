// Computed (derived) fields for trademarks. These mirror the Notion formula
// columns from the IP / Trademarks database. We don't persist them — the
// trademark row stores the raw dates, and the UI / API computes the rest.

import type { ExtensionDecision, InternationalRegistration, Trademark, TrademarkListing, TrademarkOfficeAction } from '@/types/notion';
import { addDays, addMonths, addYears, manilaToday } from '@/lib/dates';

// ── Date math ─────────────────────────────────────────────────────


// ── Deadline windows ──────────────────────────────────────────────

/**
 * An obligation's filing period. Most IPOPHL deadlines are windows rather
 * than points: the 5th-year DAU and the renewal cannot be filed before their
 * window opens, and several are extendible on request and payment of a fee.
 */
/**
 * How the extension to `extendedDue` is obtained. The distinction matters:
 * a `request` extension has to be applied for *before* the original period
 * lapses, whereas a `surcharge` one is simply a late filing that IPOPHL still
 * accepts on payment of the surcharge.
 */
export type ExtensionBasis = 'request' | 'surcharge';

export interface DeadlineWindow {
  /** First day a filing is accepted, or null when it may be filed any time up to `due`. */
  opens: string | null;
  /** Bar date — the last day to file without an extension. */
  due: string;
  /** Last day if the maximum extension is obtained; null when not extendible. */
  extendedDue: string | null;
  extensionBasis: ExtensionBasis | null;
}

function period(
  opens: string | null,
  due: string,
  extension: { until: string; basis: ExtensionBasis } | null = null,
): DeadlineWindow {
  return {
    opens,
    due,
    extendedDue: extension?.until ?? null,
    extensionBasis: extension?.basis ?? null,
  };
}

/**
 * Filings from this day paid the 1st publication fee with the filing fee, so
 * nothing is due on their Notice of Allowance.
 */
export const PUBLICATION_FEE_UPFRONT_FROM = '2023-02-14';

/** Whether this application still owes the 1st publication fee on its Notice of Allowance. */
export function owesFirstPublicationFee(filingDate: string | null): boolean {
  return !!filingDate && filingDate < PUBLICATION_FEE_UPFRONT_FROM;
}

/**
 * The 1st publication fee on a Notice of Allowance — 2 months from its
 * mailing date, on pain of abandonment. Only an application filed on or
 * before 13 Feb 2023 owes it (`owesFirstPublicationFee`).
 */
export function noiDeadline(noiDate: string | null): DeadlineWindow | null {
  return noiDate ? period(null, addMonths(noiDate, 2)) : null;
}

/**
 * The issuance and 2nd publication fees — 2 months from the mailing date of
 * the Notice of Issuance, sent once the opposition period passes unopposed
 * (Rule 610). Nothing is owed when they were paid in advance on allowance.
 */
export function issuanceFeeDeadline(issuanceNoticeDate: string | null): DeadlineWindow | null {
  return issuanceNoticeDate ? period(null, addMonths(issuanceNoticeDate, 2)) : null;
}

/**
 * Office Action response — 2 months from the mailing date (the date on the
 * document), extendible by a further 2 months on request and payment of the
 * fee, the request itself filed before the original period lapses (Rules 504,
 * 606). An appeal from a final rejection runs the same 2 + 2 months (Rule 1304).
 * An examiner may set a shorter period (Rule 612; 30 days for a prescribed
 * form, Rule 1006): that date stands, extended only for good cause, so no
 * routine extension is offered.
 */
export function oaResponseDeadline(oa: Pick<TrademarkOfficeAction, 'mailingDate' | 'respondBy'>): DeadlineWindow {
  if (oa.respondBy) return period(null, oa.respondBy);
  return period(null, addMonths(oa.mailingDate, 2), { until: addMonths(oa.mailingDate, 4), basis: 'request' });
}

/**
 * Where a request for extension stands. A request filed on time with the fee
 * is granted as of course, so it counts from the day it is filed; only a
 * recorded denial puts the deadline back to the original period.
 */
export type ExtensionState = 'pending' | ExtensionDecision;

export function extensionState(filed: boolean, decision: ExtensionDecision | null): ExtensionState | null {
  if (!filed) return null;
  return decision ?? 'pending';
}

/** The response as owed: once the extension is filed, it is due on the extended date, unless IPOPHL denies it. */
export function oaResponseOwed(oa: Pick<TrademarkOfficeAction, 'mailingDate' | 'respondBy' | 'motex' | 'motexDecision'>): DeadlineWindow {
  const w = oaResponseDeadline(oa);
  return oa.motex && oa.motexDecision !== 'denied' && w.extendedDue ? period(w.opens, w.extendedDue) : w;
}

/**
 * Revival of an abandoned application — within 3 months from the mailing
 * date of the notice of abandonment, on a showing of fraud, accident, mistake
 * or excusable negligence, with the proposed response (Rule 611). Not
 * extendible: after it the abandonment is final.
 */
export function revivalDeadline(noticeMailingDate: string | null): DeadlineWindow | null {
  return noticeMailingDate ? period(null, addMonths(noticeMailingDate, 3)) : null;
}

/**
 * The opposition period: 30 days from publication in the eGazette. With no
 * opposition the mark is deemed registered the next day (Rule 703) — unless
 * the Bureau of Legal Affairs extended the period, which a recorded
 * opposition or the COR's own date then supersedes.
 */
export function oppositionPeriod(publishedDate: string | null): { ends: string; deemedRegistered: string } | null {
  if (!publishedDate) return null;
  const ends = addDays(publishedDate, 30);
  return { ends, deemedRegistered: addDays(ends, 1) };
}

/**
 * 3rd-year DAU — IP Code s. 124.2: within 3 years from the *filing date* of
 * the application. Extendible by 6 months, on a request filed before the
 * original period lapses with payment of the fee.
 */
export function dau3Deadline(filingDate: string | null): DeadlineWindow | null {
  if (!filingDate) return null;
  const due = addYears(filingDate, 3);
  return period(null, due, { until: addMonths(due, 6), basis: 'request' });
}

/**
 * 5th-year DAU — IP Code s. 145: within one (1) year *from the fifth
 * anniversary of the date of the registration*. So it is anchored to
 * registration, not filing: the window opens at reg + 5yr and the bar date is
 * reg + 6yr. Unlike the 3rd-year DAU it is **not** extendible; missing it
 * removes the mark from the Register.
 */
export function dau5Period(regDate: string | null): DeadlineWindow | null {
  return regDate ? period(addYears(regDate, 5), addYears(regDate, 6)) : null;
}

/**
 * 10-year renewal — IP Code s. 146.2: filed within the 6 months *before*
 * expiry, or within 6 months *after* expiry on payment of the surcharge.
 */
export function renewalPeriod(regDate: string | null): DeadlineWindow | null {
  if (!regDate) return null;
  const expiry = addYears(regDate, 10);
  return period(addMonths(expiry, -6), expiry, { until: addMonths(expiry, 6), basis: 'surcharge' });
}

/**
 * The date a renewed term begins. IP Code s. 146.1 renews the registration
 * "for periods of ten (10) years at its expiration", so filing the request
 * early does not bring the renewal forward — the new term always starts when
 * the previous one expires.
 *
 * NOTE: this models the *first* renewal only. `renewal_filing_date` is a
 * single column, so a mark renewed twice cannot be represented; the second
 * cycle's declarations would need a renewals table.
 */
function renewalDate(regDate: string): string {
  return addYears(regDate, 10);
}

/**
 * DAU following renewal — MC 2023-001 Rule 204(c): within one (1) year from
 * the date of renewal. Not extendible. It may be filed from six months
 * before the registration expires (Rule 206).
 */
export function renewalDauPeriod(regDate: string | null): DeadlineWindow | null {
  if (!regDate) return null;
  const renewed = renewalDate(regDate);
  return period(addMonths(renewed, -6), addYears(renewed, 1));
}

/**
 * DAU at the fifth anniversary of a renewal — same rule 204: within one (1)
 * year from the fifth anniversary of each renewal. Not extendible.
 */
export function renewalDau5Period(regDate: string | null): DeadlineWindow | null {
  if (!regDate) return null;
  const renewed = renewalDate(regDate);
  return period(addYears(renewed, 5), addYears(renewed, 6));
}

// ── Designations (Madrid Protocol) ────────────────────────────────

type UpkeepBasis = Pick<
  TrademarkLifecycle,
  'origin' | 'filingDate' | 'irDate' | 'designationDate' | 'regDate'
  | 'dau5DueDate' | 'renewalDueDate' | 'renewalDauDueDate' | 'renewalDau5DueDate'
>;

export const isDesignation = (t: Pick<TrademarkLifecycle, 'origin'>) => t.origin === 'madrid_in';

/**
 * The date a designation's 3-year DAU counts from: the subsequent designation
 * of the Philippines when there was one, otherwise the international
 * registration (WIPO Information Notice 18/2013; IPOPHL MC 17-011).
 */
export function designationStart(t: Pick<TrademarkLifecycle, 'irDate' | 'designationDate'>): string | null {
  return t.designationDate ?? t.irDate;
}

/** A due date entered by hand: a bar date with no window and no extension on record. */
const manualDue = (due: string | null): DeadlineWindow | null => (due ? period(null, due) : null);

/**
 * The 3-year DAU, for either kind of mark. A designation's is extendible by
 * six months on request too: IPOPHL granted one on a designation in October
 * 2026 (fee T405, "DAU 3yr single ext.").
 */
export function dau3Window(t: UpkeepBasis): DeadlineWindow | null {
  if (!isDesignation(t)) return dau3Deadline(t.filingDate);
  const start = designationStart(t);
  if (!start) return null;
  const due = addYears(start, 3);
  return period(null, due, { until: addMonths(due, 6), basis: 'request' });
}

/** The 3-year DAU as owed: once the extension is filed, it is due on the extended date, unless IPOPHL denies it. */
export function dau3Owed(t: UpkeepBasis & Pick<TrademarkLifecycle, 'dau3Motex' | 'dau3MotexDecision'>): DeadlineWindow | null {
  const w = dau3Window(t);
  return w && t.dau3Motex && t.dau3MotexDecision !== 'denied' && w.extendedDue ? period(w.opens, w.extendedDue) : w;
}

/** The 5-year DAU: counted from registration, or for a designation due on the date entered by hand. */
export function dau5Window(t: UpkeepBasis): DeadlineWindow | null {
  return isDesignation(t) ? manualDue(t.dau5DueDate) : dau5Period(t.regDate);
}

/** The renewal: counted from registration, or for a designation (renewed through WIPO) due on the date entered by hand. */
export function renewalWindow(t: UpkeepBasis): DeadlineWindow | null {
  return isDesignation(t) ? manualDue(t.renewalDueDate) : renewalPeriod(t.regDate);
}

export function renewalDauWindow(t: UpkeepBasis): DeadlineWindow | null {
  return isDesignation(t) ? manualDue(t.renewalDauDueDate) : renewalDauPeriod(t.regDate);
}

export function renewalDau5Window(t: UpkeepBasis): DeadlineWindow | null {
  return isDesignation(t) ? manualDue(t.renewalDau5DueDate) : renewalDau5Period(t.regDate);
}

// ── International registrations (Madrid, outbound) ────────────────

export const isAbroad = (t: Pick<TrademarkLifecycle, 'origin'>) => t.origin === 'madrid_out';

/** An application filed with IPOPHL — not a designation in either direction. */
export const isNational = (t: Pick<TrademarkLifecycle, 'origin'>) => !isDesignation(t) && !isAbroad(t);

/**
 * An international registration's renewal with WIPO: every ten years from
 * the international registration date, or within six months after with the
 * surcharge (Protocol art. 7(1), (4)). One renewal covers every designation.
 */
export function irRenewalPeriod(ir: Pick<InternationalRegistration, 'irDate'>): DeadlineWindow | null {
  if (!ir.irDate) return null;
  const due = addYears(ir.irDate, 10);
  return period(null, due, { until: addMonths(due, 6), basis: 'surcharge' });
}

/**
 * The last day the international registration depends on the basic mark:
 * five years from its date (Protocol art. 6(3)). A refusal, cancellation or
 * lapse of the basic mark before then takes the IR down with it.
 */
export function dependencyEnds(ir: Pick<InternationalRegistration, 'irDate'>): string | null {
  return ir.irDate ? addYears(ir.irDate, 5) : null;
}

/**
 * When the IR ceased because the basic mark fell, each designation can be
 * transformed into a national application within three months, keeping its
 * date (Protocol art. 9quinquies).
 */
export function transformationDeadline(ir: Pick<InternationalRegistration, 'ceasedDate'>): string | null {
  return ir.ceasedDate ? addMonths(ir.ceasedDate, 3) : null;
}

/**
 * About when a designated country's office runs out of time to refuse — 12 or
 * 18 months (Protocol art. 5(2)). The period runs from WIPO's notification of
 * the designation, which follows the IR (or later designation) date by a few
 * weeks, so the date counted here is a little early, never late.
 */
export function refusalPeriodEnds(t: Pick<TrademarkLifecycle, 'irDate' | 'designationDate'> & { refusalPeriodMonths: 12 | 18 | null }): string | null {
  const start = t.designationDate ?? t.irDate;
  return start ? addMonths(start, t.refusalPeriodMonths ?? 12) : null;
}

/** The renewals owed on the international registrations this mark is the basic mark of. */
function internationalRenewals(t: Pick<TrademarkLifecycle, 'internationalRegistrations'>): PendingDeadline[] {
  return t.internationalRegistrations.flatMap((ir) => {
    const w = !ir.ceasedDate && !ir.renewalFilingDate ? irRenewalPeriod(ir) : null;
    return w ? [{ kind: 'IR Renewal' as const, ...w, irId: ir.id }] : [];
  });
}

// ── Ref. No. ──────────────────────────────────────────────────────

/**
 * Computed Ref. No. — `{client_code}-{client_index}-{country}-{reg_ir_no}`.
 *
 * `client_index` is zero-padded to 2 digits (Lumilex convention; differs
 * from Notion which used un-padded indexes — Lumilex is the source of truth
 * going forward).
 */
export function refNo(
  t: Pick<Trademark | TrademarkListing, 'clientCode' | 'clientIndex' | 'country' | 'regIrNo'>,
): string {
  const code = t.clientCode != null ? String(t.clientCode) : '';
  const index = String(t.clientIndex ?? 0).padStart(2, '0');
  const ctry = t.country || '';
  const regNo = (t.regIrNo ?? '').trim();
  return `${code}-${index}-${ctry}-${regNo}`;
}

// ── Next deliverable / upcoming deadlines ─────────────────────────

/** What a deadline is for, beyond its kind: the round, the hand-entered filing, or the international registration. */
interface DeadlineSubject {
  officeAction?: { id: string; final: boolean };
  /** A `Local Filing`'s own name, as entered. */
  title?: string;
  localDeadlineId?: string;
  /** The international registration an `IR Renewal` renews. */
  irId?: string;
}

export interface DeadlineEntry extends DeadlineWindow, DeadlineSubject {
  label: string;
  /** Where a request to extend it stands, when one was filed. */
  extension?: ExtensionState;
}

/** The lifecycle dates the deadline math reads — both the detail row and the listing carry them. */
export type LifecycleOfficeAction = Pick<TrademarkOfficeAction, 'id' | 'kind' | 'mailingDate' | 'respondBy' | 'motex' | 'motexDecision' | 'responseFiledDate'>;

export type TrademarkLifecycle = Pick<
  Trademark,
  | 'origin' | 'irDate' | 'designationDate'
  | 'dau5DueDate' | 'renewalDueDate' | 'renewalDauDueDate' | 'renewalDau5DueDate'
  | 'filingDate' | 'noiDate' | 'noiPaymentDate' | 'issuanceNoticeDate' | 'issuanceFeePaidDate'
  | 'regDate' | 'dau3FilingDate' | 'dau3Motex' | 'dau3MotexDecision' | 'dau5FilingDate'
  | 'renewalFilingDate' | 'renewalDauFiledDate' | 'renewalDau5FiledDate'
  | 'abandonmentMailingDate' | 'revivalFiledDate' | 'revivalDeclined'
  | 'localDeadlines' | 'internationalRegistrations'
> & { officeActions: LifecycleOfficeAction[]; status?: string | null };

/**
 * The deadline that needs attention first: the earliest one still owed,
 * which is an overdue one whenever anything has slipped. Powers the list's
 * "Next deadline" column and the detail page's next step.
 */
export function nextDeliverable(t: TrademarkLifecycle): DeadlineEntry | null {
  return upcomingDeadlines(t)[0] ?? null;
}

export type DeadlineKind =
  | '1st Publication Fee'
  | 'Issuance Fee'
  | 'OA Response'
  | 'Revival'
  | '3-DAU'
  | '5-DAU'
  | 'Renewal'
  | 'Renewal DAU'
  | 'Renewal 5-DAU'
  | 'Local Filing'
  | 'IR Renewal';

export interface PendingDeadline extends DeadlineWindow, DeadlineSubject {
  kind: DeadlineKind;
  /** Where a request to extend this deadline stands, when one was filed. */
  extension?: ExtensionState;
}

/**
 * Every deadline a mark still owes, earliest first — the one list the detail
 * page, the list, the deadline dashboard and the stored status all read.
 * A deadline drops off once the step that satisfies it is recorded (the
 * issuance fees once `issuanceFeePaidDate` is set, and so on). Registration
 * settles prosecution: a registered mark owes no fee or OA response, whichever of the
 * status or the registration date says so. Each open Office Action round owes
 * its own response.
 *
 * An abandoned mark owes nothing — except, after IPOPHL's notice of
 * abandonment, the revival, until it is filed or the firm decides not to.
 */
export function pendingDeadlines(t: TrademarkLifecycle): PendingDeadline[] {
  const irRenewals = internationalRenewals(t);
  if (t.status === 'Abandoned') {
    const revival = revivalDeadline(t.abandonmentMailingDate);
    // An international registration outlives an abandoned basic mark only once past its first five years;
    // within them it falls too. Without IPOPHL's notice, the mark fell no later than today.
    const fell = t.abandonmentMailingDate ?? manilaToday();
    const outlived = irRenewals.filter((r) => {
      const ends = dependencyEnds(t.internationalRegistrations.find((ir) => ir.id === r.irId)!);
      return !!ends && ends <= fell;
    });
    return [
      ...(revival && !t.revivalFiledDate && !t.revivalDeclined ? [{ kind: 'Revival' as const, ...revival }] : []),
      ...outlived,
    ].sort((a, b) => a.due.localeCompare(b.due));
  }
  const prosecuting = !t.regDate && t.status !== 'Registered';
  // A designation's fees are paid to WIPO, so IPOPHL sends it no fee notices.
  const national = isNational(t);
  // A country designated abroad keeps none of the Philippine declarations or renewal: its own filings are entered by hand.
  const philippine = !isAbroad(t);
  const responses: PendingDeadline[] = prosecuting
    ? t.officeActions
        .filter((oa) => !oa.responseFiledDate)
        .map((oa) => ({
          kind: 'OA Response' as const,
          ...oaResponseOwed(oa),
          officeAction: { id: oa.id, final: oa.kind === 'final_rejection' },
          ...withExtension(extensionState(oa.motex, oa.motexDecision)),
        }))
    : [];
  const candidates: { kind: DeadlineKind; window: DeadlineWindow | null; pending: boolean }[] = [
    { kind: '1st Publication Fee', window: noiDeadline(t.noiDate), pending: national && prosecuting && owesFirstPublicationFee(t.filingDate) && !!t.noiDate && !t.noiPaymentDate },
    { kind: 'Issuance Fee', window: issuanceFeeDeadline(t.issuanceNoticeDate), pending: national && prosecuting && !!t.issuanceNoticeDate && !t.issuanceFeePaidDate },
    { kind: '3-DAU', window: dau3Owed(t), pending: philippine && !t.dau3FilingDate },
    // Anchored on registration (or protection), so it only exists once registered.
    { kind: '5-DAU', window: dau5Window(t), pending: philippine && !!t.regDate && !t.dau5FilingDate },
    { kind: 'Renewal', window: renewalWindow(t), pending: philippine && !!t.regDate && !t.renewalFilingDate },
    // The renewal DAUs only exist once the renewal has been filed.
    { kind: 'Renewal DAU', window: renewalDauWindow(t), pending: philippine && !!t.regDate && !!t.renewalFilingDate && !t.renewalDauFiledDate },
    { kind: 'Renewal 5-DAU', window: renewalDau5Window(t), pending: philippine && !!t.regDate && !!t.renewalFilingDate && !t.renewalDau5FiledDate },
  ];
  const local: PendingDeadline[] = t.localDeadlines
    .filter((d) => !d.filedDate)
    .map((d) => ({ kind: 'Local Filing', ...period(null, d.dueDate), title: d.label, localDeadlineId: d.id }));
  return [
    ...responses,
    ...candidates
      .filter((c): c is { kind: DeadlineKind; window: DeadlineWindow; pending: true } => c.pending && !!c.window)
      .map((c): PendingDeadline => ({
        kind: c.kind,
        ...c.window,
        ...(c.kind === '3-DAU' ? withExtension(extensionState(t.dau3Motex, t.dau3MotexDecision)) : {}),
      })),
    ...local,
    ...irRenewals,
  ].sort((a, b) => a.due.localeCompare(b.due));
}

const withExtension = (state: ExtensionState | null): { extension?: ExtensionState } => (state ? { extension: state } : {});

/**
 * The bar dates a mark owes for one kind of deadline right now — several for
 * Office Action responses when more than one round is open. A client report
 * checks its deadline against these before it goes out.
 */
export function owedDues(t: TrademarkLifecycle, kind: DeadlineKind): string[] {
  return pendingDeadlines(t).filter((d) => d.kind === kind).map((d) => d.due);
}

/** All forward-looking deadlines for a trademark, sorted by date ascending, labelled by kind. */
export function upcomingDeadlines(t: TrademarkLifecycle): DeadlineEntry[] {
  return pendingDeadlines(t).map(({ kind, ...w }) => ({ label: kind, ...w }));
}

// ── Dashboard aggregation ─────────────────────────────────────────

export type DeadlineUrgency =
  | 'overdue'
  | 'due_this_week'
  | 'due_this_month'
  | 'due_within_90'
  | 'future';

/** Minimal trademark shape needed by the dashboard aggregator. Mirrors
 * `TrademarkListing` plus the lifecycle "completed" flags (noiPaymentDate,
 * each round's response, dau3FilingDate, dau5FilingDate, renewalFilingDate)
 * so we can correctly skip deadlines that have already been satisfied. */
export interface DashboardTrademarkInput {
  id: string;
  mark: string;
  type: string | null;
  classes: number[];
  status: string;
  matterId: string | null;
  matterName: string;
  clientId: string | null;
  clientName: string;
  clientCode: number | null;
  clientIndex: number;
  country: string;
  contactEmail: string | null;
  markImagePath: string | null;
  regIrNo: string | null;

  origin: TrademarkLifecycle['origin'];
  localDeadlines: TrademarkLifecycle['localDeadlines'];
  internationalRegistrations: TrademarkLifecycle['internationalRegistrations'];
  irDate: string | null;
  designationDate: string | null;
  dau5DueDate: string | null;
  renewalDueDate: string | null;
  renewalDauDueDate: string | null;
  renewalDau5DueDate: string | null;
  filingDate: string | null;
  noiDate: string | null;
  noiPaymentDate: string | null;
  issuanceNoticeDate: string | null;
  issuanceFeePaidDate: string | null;
  officeActions: LifecycleOfficeAction[];
  abandonmentMailingDate: string | null;
  revivalFiledDate: string | null;
  revivalDeclined: boolean;
  regDate: string | null;
  dau3FilingDate: string | null;
  dau3Motex: boolean;
  dau3MotexDecision: ExtensionDecision | null;
  dau5FilingDate: string | null;
  renewalFilingDate: string | null;
  renewalDauFiledDate: string | null;
  renewalDau5FiledDate: string | null;
}

export interface ClientReportRow {
  trademarkId: string;
  deadlineKind: DeadlineKind;
  deadlineDue: string;
  sentAt: string;
  sentBy: string;
  recipientEmail: string;
}

export interface DashboardDeadline {
  trademark: DashboardTrademarkInput;
  kind: DeadlineKind;
  /** The round an `OA Response` answers. */
  officeAction?: { id: string; final: boolean };
  /** A `Local Filing`'s own name. */
  title?: string;
  localDeadlineId?: string;
  /** Bar date (YYYY-MM-DD) — also the report-history key for this deadline. */
  due: string;
  /** First day the filing is accepted, or null when there is no opening date. */
  opens: string | null;
  /** Bar date if the maximum extension is obtained; null when not extendible. */
  extendedDue: string | null;
  extensionBasis: ExtensionBasis | null;
  /** Where a request to extend it stands, when one was filed. */
  extension?: ExtensionState;
  /** True when `opens` is still in the future — the filing can't be made yet. */
  notYetOpen: boolean;
  daysRemaining: number;  // negative if overdue
  urgency: DeadlineUrgency;
  lastReport: ClientReportRow | null;
}

function daysBetween(from: string, to: string): number {
  const a = Date.UTC(
    Number(from.slice(0, 4)),
    Number(from.slice(5, 7)) - 1,
    Number(from.slice(8, 10)),
  );
  const b = Date.UTC(
    Number(to.slice(0, 4)),
    Number(to.slice(5, 7)) - 1,
    Number(to.slice(8, 10)),
  );
  return Math.round((b - a) / 86_400_000);
}

function bucketForDays(days: number): DeadlineUrgency {
  if (days < 0) return 'overdue';
  if (days <= 7) return 'due_this_week';
  if (days <= 30) return 'due_this_month';
  if (days <= 90) return 'due_within_90';
  return 'future';
}

/**
 * Expand a set of trademarks into a flat list of pending deadlines, joined
 * with the most recent client report for each (trademark, kind, due) tuple.
 *
 * Skips any deadline that has already been satisfied (e.g. the issuance
 * fees once `issuanceFeePaidDate` is set); an abandoned mark contributes only an open
 * revival. Sort order is by due date ascending.
 */
export function allDeadlinesForDashboard(
  trademarks: DashboardTrademarkInput[],
  reports: ClientReportRow[],
): DashboardDeadline[] {
  // Index reports by (trademarkId, kind, due) → newest first
  const reportIdx = new Map<string, ClientReportRow>();
  for (const r of reports) {
    const key = `${r.trademarkId}|${r.deadlineKind}|${r.deadlineDue}`;
    const prev = reportIdx.get(key);
    if (!prev || r.sentAt > prev.sentAt) reportIdx.set(key, r);
  }

  const today = manilaToday();
  const out: DashboardDeadline[] = [];

  for (const tm of trademarks) {
    for (const c of pendingDeadlines(tm)) {
      const { opens, due, extendedDue, extensionBasis } = c;
      const days = daysBetween(today, due);
      out.push({
        trademark: tm,
        kind: c.kind,
        officeAction: c.officeAction,
        title: c.title,
        localDeadlineId: c.localDeadlineId,
        due,
        opens,
        extendedDue,
        extensionBasis,
        extension: c.extension,
        notYetOpen: !!opens && opens > today,
        daysRemaining: days,
        urgency: bucketForDays(days),
        lastReport: reportIdx.get(`${tm.id}|${c.kind}|${due}`) ?? null,
      });
    }
  }

  return out.sort((a, b) => a.due.localeCompare(b.due));
}

