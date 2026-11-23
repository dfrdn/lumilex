import type { ExtensionDecision, Trademark, TrademarkFileStep, TrademarkOfficeAction } from '@/types/notion';
import type { LetterParagraph } from '@/lib/docx/letter-body';
import { ABROAD_ACTIONS, NATIONAL_ONLY, type TrademarkAction } from '@/lib/trademarks/actions';
import {
  dau3Owed, dau3Window, dau5Window, designationStart, isAbroad, isNational, issuanceFeeDeadline, noiDeadline, oaResponseDeadline, oaResponseOwed, oppositionPeriod, owesFirstPublicationFee, pendingDeadlines, refNo,
  renewalDau5Window, renewalDauWindow, renewalWindow, type DeadlineKind,
} from '@/lib/trademark-deadlines';
import { addDays, addYears } from '@/lib/dates';
import { formatDate } from '@/lib/format-date';
import {
  BLANK, annexCopies, annexSentence, fileDocumentName, plain, reportLetter, splitDeadline,
  type CaptionRow, type ReportLetterFields, type ReportSignatory,
} from '@/lib/client-reports/letter';
import { countryInSentence, countryName, designatedOffice } from '@/lib/trademarks/countries';
import { fillWording, wordingFrom, wordingToParagraphs, type Wording } from './report-wording';

/**
 * The report the firm sends a client after a step on a mark: what was filed or
 * received, on what day, the papers attached as Annexes "A", "B", …, and the
 * next deadline it starts.
 *
 * Every date in it is read from the mark and every deadline computed by
 * lib/trademark-deadlines — the hand-made reports this replaces carried dates
 * copied from the wrong field and deadlines counted from the wrong anchor.
 */

export type ReportEvent =
  | 'filing' | 'oa_received' | 'oa_response' | 'oa_motex' | 'oa_motex_granted' | 'oa_motex_denied'
  | 'noi_received' | 'noi_paid' | 'published' | 'issuance_received' | 'issuance_paid' | 'cor'
  | 'dau_3' | 'dau_3_motex' | 'dau_3_motex_granted' | 'dau_3_motex_denied' | 'dau_5'
  | 'renewal' | 'renewal_dau' | 'renewal_dau_5'
  | 'protection';

interface EventSpec {
  /** The action whose recording calls for the report. */
  action: TrademarkAction;
  /** Where the paper that goes with it sits on the timeline — Annex "A" unless the person picks otherwise. */
  fileStep: TrademarkFileStep;
  /** The report's name in lists. */
  label: string;
  /** The caption's "Re" line. */
  re: string;
  /** What the email's subject calls the report, as the firm's own emails do: "NOA Report". */
  subjectName: string;
  /** The day the report is for — also how a sent report is matched to its step. */
  date: (t: Trademark) => string | null;
  /** The caption's "Upcoming Deadline", as "What — when". */
  upcoming: (t: Trademark) => string;
  /** What the step's paper is called in the letter. */
  annexDocument: string;
  /** What else this report needs from the mark. */
  needs?: (t: Trademark) => string[];
}

const quoted = (mark: string) => `“${mark}”`;
const day = (d: string | null | undefined) => (d ? formatDate(d) : '');

function applicant(t: Trademark): string {
  return t.owner?.trim() || t.clientName || BLANK('Applicant');
}

/**
 * "Application No." until the mark is registered, then "Registration No." —
 * the number field holds whichever IPOPHL last issued; a designation's is the
 * international registration's.
 */
function numberLabel(t: Trademark): string {
  if (!isNational(t)) return 'International Registration No.';
  return t.regDate ? 'Registration No.' : 'Application No.';
}

/** The caption's date row for when the mark began: filed, or for a designation, registered internationally or designated. */
function startRow(t: Trademark): CaptionRow {
  if (isNational(t)) return { label: 'Date Filed', value: t.filingDate ? formatDate(t.filingDate) : BLANK('Date filed') };
  const start = designationStart(t);
  return {
    label: t.designationDate ? 'Date of Designation' : 'Date of International Registration',
    value: start ? formatDate(start) : BLANK('International registration date'),
  };
}

/** Where a designation is: the Philippines, or the country designated abroad. */
const designatedIn = (t: Trademark) => (isAbroad(t) ? countryInSentence(t.country) : 'the Philippines');

/** The office that examines a designation, as the letter names it. */
const officeFor = (t: Trademark) =>
  isAbroad(t) ? designatedOffice(t.country) : 'the Intellectual Property Office of the Philippines (IPOPHL)';

function goodsByClass(t: Trademark): { cls: number; text: string | null }[] {
  return t.classes.map((cls) => ({ cls, text: t.goodsServices[String(cls)]?.trim() || null }));
}

// ── Office Action rounds ───────────────────────────────────────────

/** The round last received — the one an Office Action report is about. */
const latestRound = (t: Trademark): TrademarkOfficeAction | null => t.officeActions[t.officeActions.length - 1] ?? null;

/** The round last answered. */
function latestAnswered(t: Trademark): TrademarkOfficeAction | null {
  return [...t.officeActions].filter((o) => o.responseFiledDate)
    .sort((a, b) => a.responseFiledDate!.localeCompare(b.responseFiledDate!)).at(-1) ?? null;
}

/** The round last extended. */
const latestExtended = (t: Trademark): TrademarkOfficeAction | null => [...t.officeActions].filter((o) => o.motex).at(-1) ?? null;

/** The round whose extension IPOPHL last decided this way. */
function latestDecided(t: Trademark, decision: ExtensionDecision): TrademarkOfficeAction | null {
  return [...t.officeActions].filter((o) => o.motexDecision === decision && o.motexDecidedOn)
    .sort((a, b) => a.motexDecidedOn!.localeCompare(b.motexDecidedOn!)).at(-1) ?? null;
}

function roundName(oa: TrademarkOfficeAction): string {
  const titled = (name: string) => (oa.title?.trim() ? `${name} (${plain(oa.title.trim())})` : name);
  if (oa.kind === 'provisional_refusal') return titled('provisional refusal');
  return oa.kind === 'final_rejection' ? 'final rejection' : titled('Office Action');
}

// ── Deadlines, in the caption's words ──────────────────────────────

const DEADLINE_NAMES: Record<DeadlineKind, string> = {
  '1st Publication Fee': 'Payment of the 1st Publication Fee',
  'Issuance Fee': 'Payment of the Issuance and 2nd Publication Fees',
  'OA Response': 'Response to Office Action',
  'Revival': 'Revival of the Application',
  '3-DAU': 'Declaration of Actual Use (3rd Year)',
  '5-DAU': 'Declaration of Actual Use (5th Year)',
  'Renewal': 'Renewal of Registration',
  'Renewal DAU': 'Declaration of Actual Use (after Renewal)',
  'Renewal 5-DAU': 'Declaration of Actual Use (5th Year after Renewal)',
  'Local Filing': 'Filing before the Designated Office',
  'IR Renewal': 'Renewal of the International Registration',
};

const span = (opens: string | null, due: string) => (opens ? `${formatDate(opens)} to ${formatDate(due)}` : formatDate(due));

/** The earliest deadline the mark still owes, for a step that starts none of its own. */
function nextOwed(t: Trademark): string {
  const d = pendingDeadlines(t)[0];
  return d ? `${d.title ?? DEADLINE_NAMES[d.kind]} — ${span(d.opens, d.due)}` : 'None at present';
}

// ── The reports ────────────────────────────────────────────────────

export const REPORT_EVENTS: Record<ReportEvent, EventSpec> = {
  filing: {
    action: 'mark_as_filed',
    fileStep: 'filing',
    annexDocument: 'the application as filed',
    label: 'Filing report',
    re: 'Filing of Trademark Application',
    subjectName: 'Trademark Application Filing Report',
    date: (t) => t.filingDate,
    upcoming: (t) => {
      const w = dau3Window(t);
      return w ? `${DEADLINE_NAMES['3-DAU']} — ${formatDate(w.due)}` : BLANK('Deadline');
    },
    needs: (t) => {
      const missing = goodsByClass(t).filter((g) => !g.text).map((g) => g.cls);
      return missing.length ? [`No goods or services for Class${missing.length > 1 ? 'es' : ''} ${missing.join(', ')}.`] : [];
    },
  },

  oa_received: {
    action: 'oa_received',
    fileStep: 'office_action',
    annexDocument: 'the Office Action',
    label: 'Office Action report',
    re: 'Office Action Received',
    subjectName: 'Office Action Report',
    date: (t) => { const oa = latestRound(t); return oa ? oa.receivedDate ?? oa.mailingDate : null; },
    upcoming: (t) => {
      const oa = latestRound(t);
      return oa ? `${oa.kind === 'final_rejection' ? 'Appeal or Compliance' : DEADLINE_NAMES['OA Response']} — ${formatDate(oaResponseDeadline(oa).due)}` : BLANK('Deadline');
    },
  },

  oa_response: {
    action: 'oa_response_filed',
    fileStep: 'oa_response',
    annexDocument: 'the response as filed',
    label: 'Office Action response report',
    re: 'Response to Office Action',
    subjectName: 'Response Filing Report',
    date: (t) => latestAnswered(t)?.responseFiledDate ?? null,
    upcoming: nextOwed,
  },

  oa_motex: {
    action: 'oa_response_motex',
    fileStep: 'oa_motex',
    annexDocument: 'the request as filed',
    label: 'Office Action extension report',
    re: 'Extension of Time to Respond to Office Action',
    subjectName: 'Office Action Extension Report',
    // The extension isn't dated on the record; the round's own date names it.
    date: (t) => latestExtended(t)?.mailingDate ?? null,
    upcoming: (t) => {
      const oa = latestExtended(t);
      const w = oa ? oaResponseDeadline(oa) : null;
      return w ? `${DEADLINE_NAMES['OA Response']} — ${formatDate(w.extendedDue ?? w.due)}` : BLANK('Deadline');
    },
  },

  oa_motex_granted: {
    action: 'oa_motex_granted',
    fileStep: 'oa_motex_decision',
    annexDocument: 'IPOPHL’s order',
    label: 'Office Action extension granted report',
    re: 'Extension of Time to Respond to Office Action — Granted',
    subjectName: 'Office Action Extension Granted',
    date: (t) => latestDecided(t, 'granted')?.motexDecidedOn ?? null,
    upcoming: (t) => {
      const oa = latestDecided(t, 'granted');
      return oa ? `${DEADLINE_NAMES['OA Response']} — ${formatDate(oaResponseOwed(oa).due)}` : BLANK('Deadline');
    },
  },

  oa_motex_denied: {
    action: 'oa_motex_denied',
    fileStep: 'oa_motex_decision',
    annexDocument: 'IPOPHL’s order',
    label: 'Office Action extension denied report',
    re: 'Extension of Time to Respond to Office Action — Denied',
    subjectName: 'Office Action Extension Denied',
    date: (t) => latestDecided(t, 'denied')?.motexDecidedOn ?? null,
    upcoming: (t) => {
      const oa = latestDecided(t, 'denied');
      return oa ? `${DEADLINE_NAMES['OA Response']} — ${formatDate(oaResponseOwed(oa).due)}` : BLANK('Deadline');
    },
  },

  noi_received: {
    action: 'noi_received',
    fileStep: 'noi',
    annexDocument: 'the notice',
    label: 'Notice of Allowance report',
    re: 'Notice of Allowance',
    subjectName: 'NOA Report',
    date: (t) => t.noiDate,
    upcoming: (t) => {
      if (!owesFirstPublicationFee(t.filingDate)) return nextOwed(t);
      const w = noiDeadline(t.noiDate);
      return w ? `${DEADLINE_NAMES['1st Publication Fee']} — ${formatDate(w.due)}` : BLANK('Deadline');
    },
  },

  noi_paid: {
    action: 'noi_paid',
    fileStep: 'noi_payment',
    annexDocument: 'the official receipt',
    label: '1st publication fee payment report',
    re: 'Payment of the 1st Publication Fee',
    subjectName: 'Publication Fee Payment Report',
    date: (t) => t.noiPaymentDate,
    upcoming: nextOwed,
  },

  published: {
    action: 'published',
    fileStep: 'publication',
    annexDocument: 'the publication',
    label: 'Publication report',
    re: 'Publication for Opposition',
    subjectName: 'Publication Report',
    date: (t) => t.publishedDate,
    upcoming: (t) => {
      const p = oppositionPeriod(t.publishedDate);
      return p ? `End of the Opposition Period — ${formatDate(p.ends)}` : BLANK('Deadline');
    },
  },

  issuance_received: {
    action: 'issuance_received',
    fileStep: 'issuance',
    annexDocument: 'the notice',
    label: 'Notice of Issuance report',
    re: 'Notice of Issuance',
    subjectName: 'Notice of Issuance Report',
    date: (t) => t.issuanceNoticeDate,
    upcoming: (t) => {
      if (t.issuanceFeePaidDate) return nextOwed(t);
      const w = issuanceFeeDeadline(t.issuanceNoticeDate);
      return w ? `${DEADLINE_NAMES['Issuance Fee']} — ${formatDate(w.due)}` : BLANK('Deadline');
    },
  },

  issuance_paid: {
    action: 'issuance_paid',
    fileStep: 'issuance_payment',
    annexDocument: 'the official receipt',
    label: 'Issuance fee payment report',
    re: 'Payment of the Issuance and 2nd Publication Fees',
    subjectName: 'Issuance Fee Payment Report',
    date: (t) => t.issuanceFeePaidDate,
    upcoming: nextOwed,
  },

  cor: {
    action: 'cor_received',
    fileStep: 'cor',
    annexDocument: 'the Certificate of Registration',
    label: 'Registration report',
    re: 'Certificate of Registration',
    subjectName: 'Certificate of Registration Report',
    date: (t) => t.corReportedDate ?? t.regDate,
    upcoming: nextOwed,
    needs: (t) => (t.regDate ? [] : ['No registration date on the mark.']),
  },

  protection: {
    action: 'protection_granted',
    fileStep: 'cor',
    annexDocument: 'the statement of grant of protection',
    label: 'Protection report',
    re: 'Grant of Protection',
    subjectName: 'Grant of Protection Report',
    // Only a designation is granted protection; a national mark is registered.
    date: (t) => (isNational(t) ? null : t.corReportedDate ?? t.regDate),
    upcoming: nextOwed,
    needs: (t) => (t.regDate ? [] : ['No date of the grant of protection on the mark.']),
  },

  dau_3: {
    action: 'dau_3_filed',
    fileStep: 'dau_3',
    annexDocument: 'the DAU as filed',
    label: '3rd-year DAU report',
    re: 'Filing of the Declaration of Actual Use (3rd Year)',
    subjectName: '3rd DAU Report',
    date: (t) => t.dau3FilingDate,
    upcoming: (t) => {
      const w = dau5Window(t);
      return w
        ? `${DEADLINE_NAMES['5-DAU']} — ${span(w.opens, w.due)}`
        : `${DEADLINE_NAMES['5-DAU']} — within one year from the fifth anniversary of registration`;
    },
  },

  dau_3_motex: {
    action: 'dau_3_motex_filed',
    fileStep: 'dau_3_motex',
    annexDocument: 'the request as filed',
    label: '3rd-year DAU extension report',
    re: 'Extension of Time to File the Declaration of Actual Use (3rd Year)',
    subjectName: '3rd DAU Extension Report',
    // The extension isn't dated on the record; the deadline it extends names it.
    date: (t) => (t.dau3Motex ? dau3Window(t)?.due ?? null : null),
    upcoming: (t) => {
      const w = dau3Window(t);
      return w?.extendedDue ? `${DEADLINE_NAMES['3-DAU']} — ${formatDate(w.extendedDue)}` : BLANK('Deadline');
    },
  },

  dau_3_motex_granted: {
    action: 'dau_3_motex_granted',
    fileStep: 'dau_3_motex_decision',
    annexDocument: 'IPOPHL’s order',
    label: '3rd-year DAU extension granted report',
    re: 'Extension of Time to File the Declaration of Actual Use (3rd Year) — Granted',
    subjectName: '3rd DAU Extension Granted',
    date: (t) => (t.dau3MotexDecision === 'granted' ? t.dau3MotexDecidedOn : null),
    upcoming: (t) => {
      const w = dau3Owed(t);
      return w ? `${DEADLINE_NAMES['3-DAU']} — ${formatDate(w.due)}` : BLANK('Deadline');
    },
  },

  dau_3_motex_denied: {
    action: 'dau_3_motex_denied',
    fileStep: 'dau_3_motex_decision',
    annexDocument: 'IPOPHL’s order',
    label: '3rd-year DAU extension denied report',
    re: 'Extension of Time to File the Declaration of Actual Use (3rd Year) — Denied',
    subjectName: '3rd DAU Extension Denied',
    date: (t) => (t.dau3MotexDecision === 'denied' ? t.dau3MotexDecidedOn : null),
    upcoming: (t) => {
      const w = dau3Owed(t);
      return w ? `${DEADLINE_NAMES['3-DAU']} — ${formatDate(w.due)}` : BLANK('Deadline');
    },
  },

  dau_5: {
    action: 'dau_5_filed',
    fileStep: 'dau_5',
    annexDocument: 'the DAU as filed',
    label: '5th-year DAU report',
    re: 'Filing of the Declaration of Actual Use (5th Year)',
    subjectName: '5th DAU Report',
    date: (t) => t.dau5FilingDate,
    upcoming: (t) => {
      const w = renewalWindow(t);
      return w ? `${DEADLINE_NAMES.Renewal} — ${span(w.opens, w.due)}` : BLANK('Deadline');
    },
    needs: (t) => (t.regDate ? [] : ['No registration date on the mark.']),
  },

  renewal: {
    action: 'renewal_filed',
    fileStep: 'renewal',
    annexDocument: 'the request as filed',
    label: 'Renewal report',
    re: 'Renewal of Registration',
    subjectName: 'Renewal Report',
    date: (t) => t.renewalFilingDate,
    upcoming: (t) => {
      const w = renewalDauWindow(t);
      return w ? `${DEADLINE_NAMES['Renewal DAU']} — ${span(w.opens, w.due)}` : BLANK('Deadline');
    },
    needs: (t) => (t.regDate ? [] : ['No registration date on the mark.']),
  },

  renewal_dau: {
    action: 'renewal_dau_filed',
    fileStep: 'renewal_dau',
    annexDocument: 'the DAU as filed',
    label: 'Post-renewal DAU report',
    re: 'Filing of the Declaration of Actual Use after Renewal',
    subjectName: 'Post-Renewal DAU Report',
    date: (t) => t.renewalDauFiledDate,
    upcoming: (t) => {
      const w = renewalDau5Window(t);
      return w ? `${DEADLINE_NAMES['Renewal 5-DAU']} — ${span(w.opens, w.due)}` : BLANK('Deadline');
    },
    needs: (t) => (t.regDate ? [] : ['No registration date on the mark.']),
  },

  renewal_dau_5: {
    action: 'renewal_dau_5_filed',
    fileStep: 'renewal_dau_5',
    annexDocument: 'the DAU as filed',
    label: 'Post-renewal 5th-year DAU report',
    re: 'Filing of the Declaration of Actual Use (5th Year after Renewal)',
    subjectName: 'Post-Renewal 5th DAU Report',
    date: (t) => t.renewalDau5FiledDate,
    upcoming: (t) => (t.regDate ? `${DEADLINE_NAMES.Renewal} — ${formatDate(addYears(t.regDate, 20))}` : BLANK('Deadline')),
    needs: (t) => (t.regDate ? [] : ['No registration date on the mark.']),
  },
};

export const REPORT_EVENT_KEYS = Object.keys(REPORT_EVENTS) as ReportEvent[];

/** What a report on a designation is called instead: its rounds are refusals, answered by the date on the notice. */
const DESIGNATION_SPEC: Partial<Record<ReportEvent, Partial<EventSpec>>> = {
  oa_received: {
    label: 'Refusal report',
    re: 'Provisional Refusal Received',
    subjectName: 'Provisional Refusal Report',
    annexDocument: 'the notice of provisional refusal',
    upcoming: (t) => {
      const oa = latestRound(t);
      return oa ? `Response to the Refusal — ${formatDate(oaResponseDeadline(oa).due)}` : BLANK('Deadline');
    },
  },
  oa_response: {
    label: 'Refusal response report',
    re: 'Response to Provisional Refusal',
    subjectName: 'Refusal Response Report',
  },
};

/** A report's spec for this mark: a designation's names where it has its own. */
export function reportSpec(t: Pick<Trademark, 'origin'>, event: ReportEvent): EventSpec {
  return isNational(t) ? REPORT_EVENTS[event] : { ...REPORT_EVENTS[event], ...DESIGNATION_SPEC[event] };
}

/**
 * What a paper picked as an annex is first called in the letter: its step's
 * own words — a designation's, given the mark — else its file name.
 */
export function annexDocumentFor(file: { name: string; step: TrademarkFileStep | null }, t?: Pick<Trademark, 'origin'>): string {
  const designation = !!t && !isNational(t);
  const event = designation && file.step === 'cor' ? 'protection' : REPORT_EVENT_KEYS.find((e) => REPORT_EVENTS[e].fileStep === file.step);
  if (!event) return fileDocumentName(file.name);
  return (t ? reportSpec(t, event) : REPORT_EVENTS[event]).annexDocument;
}


export function isReportEvent(v: unknown): v is ReportEvent {
  return typeof v === 'string' && v in REPORT_EVENTS;
}

/** The report a recorded action calls for, if any. */
export function reportEventForAction(action: TrademarkAction): ReportEvent | null {
  return REPORT_EVENT_KEYS.find((e) => REPORT_EVENTS[e].action === action) ?? null;
}

/**
 * The steps on this mark that have a report, with the day each is for. A
 * designation takes none of the national-only steps (filing, allowance, the
 * fee notices, the COR), so their reports — worded for those papers — don't
 * apply to it; a country designated abroad takes no Philippine upkeep either.
 */
export function reportableEvents(t: Trademark): { event: ReportEvent; date: string }[] {
  return REPORT_EVENT_KEYS.flatMap((event) => {
    const action = REPORT_EVENTS[event].action;
    if (!isNational(t) && NATIONAL_ONLY.has(action)) return [];
    if (isAbroad(t) && !ABROAD_ACTIONS.has(action)) return [];
    const date = REPORT_EVENTS[event].date(t);
    return date ? [{ event, date }] : [];
  });
}

/** How long after a step its report is offered as owed; older steps can still be reported from the full list. */
export const REPORT_DUE_DAYS = 60;

/**
 * The days a sent report for this step may have been logged under. An Office
 * Action's report is dated the day it was received, or the date on it while
 * that day is unconfirmed, so a report sent before the receipt day was filled
 * in is still this round's report.
 */
function loggedUnder(t: Trademark, event: ReportEvent, date: string): string[] {
  if (event !== 'oa_received') return [date];
  const oa = latestRound(t);
  return oa ? [date, oa.mailingDate] : [date];
}

/**
 * Whether a step is recent enough to offer its report. An Office Action whose
 * receipt day is unconfirmed is dated by the paper, which may have taken weeks
 * to arrive, so it stays current while its response can still be filed.
 */
function stillCurrent(t: Trademark, event: ReportEvent, date: string, since: string, today: string): boolean {
  if (date >= since) return true;
  if (event !== 'oa_received') return false;
  const oa = latestRound(t);
  if (!oa || oa.receivedDate || oa.responseFiledDate) return false;
  const w = oaResponseDeadline(oa);
  return (w.extendedDue ?? w.due) >= today;
}

/** Steps from the last REPORT_DUE_DAYS whose report hasn't gone to the client. */
export function owedReportEvents(
  t: Trademark,
  sent: { event: string | null; eventDate: string | null }[],
  today: string,
): { event: ReportEvent; date: string }[] {
  const logged = new Set(sent.filter((r) => r.event && r.eventDate).map((r) => `${r.event}|${r.eventDate}`));
  const since = addDays(today, -REPORT_DUE_DAYS);
  return reportableEvents(t).filter(
    (s) => stillCurrent(t, s.event, s.date, since, today) && !loggedUnder(t, s.event, s.date).some((d) => logged.has(`${s.event}|${d}`)),
  );
}

export interface ClientReport {
  event: ReportEvent;
  eventDate: string;
  /** Email subject, also the letter's file name stem. */
  subject: string;
  caption: CaptionRow[];
  /** The covering email's caption, in the layout of the firm's own report emails. */
  emailCaption: CaptionRow[];
  signatory: ReportSignatory;
  /** The letter, for buildLetterBody. */
  paragraphs: LetterParagraph[];
  /** The covering email's opening, which the person may edit before sending. */
  message: string;
  /** What is missing from the mark, said before the report goes out. */
  problems: string[];
}

function captionRows(t: Trademark, event: ReportEvent): CaptionRow[] {
  const spec = reportSpec(t, event);
  const rows: CaptionRow[] = [
    { label: 'Applicant', value: applicant(t) },
    { label: 'Subject Mark', value: t.mark || BLANK('Mark') },
    { label: numberLabel(t), value: t.regIrNo?.trim() || BLANK(numberLabel(t)) },
    startRow(t),
  ];
  if (isAbroad(t)) rows.push({ label: 'Designated Country', value: countryName(t.country) });
  if (t.regDate) rows.push({ label: isNational(t) ? 'Date Registered' : 'Date Protection Granted', value: formatDate(t.regDate) });
  rows.push(
    { label: t.classes.length === 1 ? 'Class' : 'Classes', value: t.classes.join(', ') || BLANK('Classes') },
    { label: 'Re', value: spec.re },
    { label: 'Upcoming Deadline', value: spec.upcoming(t) },
  );
  return rows;
}

/** How the firm's emails name a deadline inside "Upcoming Deadline (…)". */
const SHORT_DEADLINE: Record<string, string> = {
  [DEADLINE_NAMES['1st Publication Fee']]: 'Publication Fee',
  [DEADLINE_NAMES['Issuance Fee']]: 'Issuance Fees',
  [DEADLINE_NAMES['OA Response']]: 'Response to OA',
  [DEADLINE_NAMES.Revival]: 'Revival',
  [DEADLINE_NAMES['3-DAU']]: '3rd Year DAU',
  [DEADLINE_NAMES['5-DAU']]: '5th Year DAU',
  [DEADLINE_NAMES.Renewal]: 'Renewal',
  [DEADLINE_NAMES['Renewal DAU']]: 'DAU after Renewal',
  [DEADLINE_NAMES['Renewal 5-DAU']]: '5th Year DAU after Renewal',
  'End of the Opposition Period': 'Opposition Period',
  'Response to the Refusal': 'Response to Refusal',
};

/**
 * The caption the firm's report emails open with: the applicant (registrant
 * once registered), the mark, its number, filing date and classes, then the
 * next deadline named in brackets with its date in bold.
 */
function emailCaptionRows(t: Trademark, event: ReportEvent): CaptionRow[] {
  const upcoming = reportSpec(t, event).upcoming(t);
  const [what, when] = splitDeadline(upcoming);
  const deadline = when
    ? { label: `Upcoming Deadline (${SHORT_DEADLINE[what] ?? what})`, value: when }
    : { label: 'Upcoming Deadline', value: upcoming };
  return [...markEmailCaption(t), { ...deadline, bold: true }];
}

/** The email caption's rows that describe the mark, for a report on paper the team wrote itself. */
export function markEmailCaption(t: Trademark): CaptionRow[] {
  return [
    { label: t.regDate ? 'Registrant' : 'Applicant', value: applicant(t) },
    { label: 'Mark', value: t.mark || BLANK('Mark'), bold: true },
    { label: numberLabel(t), value: t.regIrNo?.trim() || BLANK(numberLabel(t)) },
    startRow(t),
    ...(isAbroad(t) ? [{ label: 'Designated Country', value: countryName(t.country) }] : []),
    { label: t.classes.length === 1 ? 'Class' : 'Classes', value: t.classes.join(', ') || BLANK('Classes') },
  ];
}

const MARK_TYPE: Record<string, string> = { Wordmark: 'Word mark', Combined: 'Combined mark', Device: 'Device mark' };

/** "[042] Harbour Lantern (Word mark) | NOA Report (4-2026-500042)" — the subject line the firm's reports carry. */
function reportSubject(t: Trademark, event: ReportEvent): string {
  const name = reportSpec(t, event).subjectName;
  return markReportSubject(t, isAbroad(t) ? `${name} — ${countryName(t.country)}` : name);
}

/** The firm's subject line for a report named `name` — a step's, or one the team titled itself. */
export function markReportSubject(t: Trademark, name: string): string {
  const code = t.clientCode != null ? `[${t.clientCode}] ` : '';
  const type = t.type && MARK_TYPE[t.type] ? ` (${MARK_TYPE[t.type]})` : '';
  const number = t.regIrNo?.trim() ? ` (${t.regIrNo.trim()})` : '';
  return `${code}${t.mark || 'Trademark'}${type} | ${name}${number}`;
}

/** What the mark lacks for this report, in the words the person fixing it will look for. */
function problemsFor(t: Trademark, event: ReportEvent): string[] {
  const out: string[] = [];
  if (!t.regIrNo?.trim()) out.push(`No ${numberLabel(t).toLowerCase()} on the mark.`);
  if (!(isNational(t) ? t.filingDate : designationStart(t))) {
    out.push(isNational(t) ? 'No filing date on the mark.' : 'No international registration date on the mark.');
  }
  if (t.classes.length === 0) out.push('No Nice classes on the mark.');
  out.push(...(reportSpec(t, event).needs?.(t) ?? []));
  if (!t.owner?.trim()) out.push('No applicant (owner) on the mark — the client’s name is used.');
  return out;
}

/** The one round a report is about, for the reports on Office Actions. */
/** The Office Action round a report is about, for the reports that are about one. */
export function roundFor(t: Trademark, event: ReportEvent): TrademarkOfficeAction | null {
  if (event === 'oa_received') return latestRound(t);
  if (event === 'oa_response') return latestAnswered(t);
  if (event === 'oa_motex') return latestExtended(t);
  if (event === 'oa_motex_granted') return latestDecided(t, 'granted');
  if (event === 'oa_motex_denied') return latestDecided(t, 'denied');
  return null;
}

/**
 * What the wording's {{fields}} are filled with for this report. A field the
 * mark has no value for is blank, so a `[[ … ]]` around it drops out; every
 * date is computed by lib/trademark-deadlines.
 */
export function reportFields(t: Trademark, event: ReportEvent, eventDate: string, annexes: string[]): Record<string, string> {
  const oa = roundFor(t, event);
  const oaWindow = oa ? oaResponseDeadline(oa) : null;
  const dau3 = dau3Window(t);
  const dau5 = dau5Window(t);
  const renewal = renewalWindow(t);
  const renewalDau = renewalDauWindow(t);
  const renewalDau5 = renewalDau5Window(t);
  const opposition = oppositionPeriod(t.publishedDate);
  const expiry = t.regDate ? addYears(t.regDate, 10) : null;
  const received = oa ? oa.receivedDate
    : event === 'noi_received' ? t.noiReceivedDate
    : event === 'issuance_received' ? t.issuanceNoticeReceivedDate
    : null;
  return {
    mark: quoted(t.mark || BLANK('Mark')),
    applicant: applicant(t),
    applicationNo: t.regIrNo?.trim() ?? '',
    filingDate: day(t.filingDate),
    eventDate: day(eventDate),
    receivedDate: day(received),
    annexes: annexSentence(annexes),
    annexCopies: annexCopies(annexes),
    oaName: oa ? roundName(oa) : '',
    oaDate: day(oa?.mailingDate),
    responseWhat: oa?.kind === 'final_rejection' ? 'appeal from, or compliance with,' : 'response to',
    responseDue: day(oaWindow?.due),
    responseExtendedDue: day(oaWindow?.extendedDue),
    examinerPeriod: oa?.respondBy ? ', a period the examiner set, which may be extended only for good cause' : '',
    office: isNational(t) ? '' : officeFor(t),
    country: isNational(t) ? '' : designatedIn(t),
    irNo: isNational(t) ? '' : t.regIrNo?.trim() ?? '',
    irDate: isNational(t) ? '' : day(t.irDate),
    noiDate: day(t.noiDate),
    feesDue: owesFirstPublicationFee(t.filingDate) ? day(noiDeadline(t.noiDate)?.due) : '',
    issuanceNoticeDate: day(t.issuanceNoticeDate),
    issuanceFeesDue: day(issuanceFeeDeadline(t.issuanceNoticeDate)?.due),
    issuanceFeesPaid: day(t.issuanceFeePaidDate),
    publishedDate: day(t.publishedDate),
    oppositionEnds: day(opposition?.ends),
    deemedRegistered: day(opposition?.deemedRegistered),
    regDate: day(t.regDate),
    registrationNo: t.regDate ? t.regIrNo?.trim() ?? '' : '',
    expiryDate: day(expiry),
    renewedExpiry: day(t.regDate ? addYears(t.regDate, 20) : null),
    dau3Due: day(dau3?.due),
    dau3ExtendedDue: t.dau3Motex ? '' : day(dau3?.extendedDue),
    dau5Opens: day(dau5?.opens),
    dau5Due: day(dau5?.due),
    renewalOpens: day(renewal?.opens),
    renewalDue: day(renewal?.due),
    renewalGraceEnds: day(renewal?.extendedDue),
    renewalDauOpens: day(renewalDau?.opens),
    renewalDauDue: day(renewalDau?.due),
    renewalDau5Opens: day(renewalDau5?.opens),
    renewalDau5Due: day(renewalDau5?.due),
    // The date the client is asked for proof by: the DAU this report is about.
    proofDue: day(event === 'renewal' ? renewalDau?.due : dau3Owed(t)?.due),
  };
}

/** The lists and shared blocks a block field brings in, filled for this report. */
function blockParagraphs(t: Trademark, wording: Wording, fields: Record<string, string>) {
  const shared = (key: string) => wordingToParagraphs(wording[key], fields, blocks);
  function blocks(key: string): LetterParagraph[] {
    switch (key) {
      case 'goodsByClass':
        return goodsByClass(t).map(({ cls, text }): LetterParagraph => ({
          text: `**Class ${cls}** — ${text ? plain(text) : BLANK(`Goods or services in Class ${cls}`)}`,
          indent: 720,
          style: 'BodyText',
        }));
      case 'proofOfUse': return shared('shared.proof_of_use');
      case 'dau3Reminder': return t.dau3FilingDate || !t.filingDate ? [] : shared('shared.dau3_reminder');
      case 'dau5Reminder': return shared(t.regDate ? 'shared.dau5_reminder' : 'shared.dau5_pending');
      case 'renewalReminder': return t.regDate ? shared('shared.renewal_reminder') : [];
      case 'awaitingRegistration': return t.regDate ? [] : shared('shared.awaiting_registration');
      case 'allowanceFees': return shared(owesFirstPublicationFee(t.filingDate) ? 'shared.allowance_first_fee' : 'shared.allowance_no_fee');
      default: return [];
    }
  }
  return blocks;
}

/** Reports whose wording on a designation is its own: the rounds are refusals, and the office may be abroad. */
const DESIGNATION_WORDING = new Set<ReportEvent>(['oa_received', 'oa_response']);

/** The letter body's wording key: a final rejection has its own, and so does a designation's refusal. */
function bodyKey(t: Trademark, event: ReportEvent): string {
  if (!isNational(t) && DESIGNATION_WORDING.has(event)) return `${event}.body_madrid`;
  return event === 'oa_received' && latestRound(t)?.kind === 'final_rejection' ? 'oa_received.body_final' : `${event}.body`;
}

/** The covering email's wording key. */
function messageKey(t: Trademark, event: ReportEvent): string {
  return !isNational(t) && DESIGNATION_WORDING.has(event) ? `${event}.message_madrid` : `${event}.message`;
}

export function buildClientReport(
  mark: Trademark,
  event: ReportEvent,
  opts: {
    today: string;
    signatory: ReportSignatory;
    letter?: ReportLetterFields;
    /** What each attached paper is called in the letter, in annex order: Annex "A" first. */
    annexes: string[];
    /** The firm's saved wording; the defaults when not given. */
    wording?: Wording;
  },
): ClientReport {
  // A name typed with a stray space would print inside the quotes: “SAMPLE MARK ”.
  const t: Trademark = { ...mark, mark: mark.mark.trim(), clientName: mark.clientName.trim() };
  const spec = reportSpec(t, event);
  const eventDate = spec.date(t);
  if (!eventDate) throw new Error(`${spec.label}: the step is not recorded on this mark`);

  const caption = captionRows(t, event);
  const letter = opts.letter ?? {};
  const addressee = letter.addressee?.trim() || t.clientName || BLANK('Addressee');
  const wording = opts.wording ?? wordingFrom();
  const fields = reportFields(t, event, eventDate, opts.annexes);
  const blocks = blockParagraphs(t, wording, fields);

  const paragraphs = reportLetter({
    today: opts.today,
    addressee,
    caption,
    refNo: refNo(t),
    letter,
    body: [
      ...wordingToParagraphs(wording[bodyKey(t, event)], fields, blocks),
      ...wordingToParagraphs(wording['shared.closing'], fields, blocks),
    ],
    signatory: opts.signatory,
  });

  const message = fillWording(wording[messageKey(t, event)], fields).replace(/\*/g, '');

  return {
    event,
    eventDate,
    subject: reportSubject(t, event),
    caption,
    emailCaption: emailCaptionRows(t, event),
    signatory: opts.signatory,
    paragraphs,
    message,
    problems: [
      ...problemsFor(t, event),
      ...(addressee === BLANK('Addressee') ? ['No client on the mark — fill in who the letter is addressed to.'] : []),
    ],
  };
}
