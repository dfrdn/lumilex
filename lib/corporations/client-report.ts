import type { Corporation, CorporationMeeting, Resolution } from '@/types/corporations';
import type { LetterParagraph } from '@/lib/docx/letter-body';
import { formatDate } from '@/lib/format-date';
import {
  BLANK, annexCopies, annexSentence, plain, reportLetter, splitDeadline,
  type CaptionRow, type ReportLetterFields, type ReportSignatory,
} from '@/lib/client-reports/letter';
import { fillWording, wordingToParagraphs } from '@/lib/client-reports/wording';
import { companyName, obligationOfDeliverable, type DeliverableObligation } from './obligations';

/**
 * The report the firm sends a client after something is done for one of its
 * companies: registered with the SEC, the BIR, the city or an agency; a
 * compliance item filed; a meeting held; a resolution or Secretary's
 * Certificate signed. Like the trademark reports (lib/trademarks/client-report.ts)
 * it is built from the record — every date is read from the company or the
 * item, and the next deadlines are the company's open compliance items as the
 * app computed them — and shares their letter and email.
 */

export type CorporateReportEvent =
  | 'sec_registration' | 'bir_registration' | 'bir_books' | 'bir_atp' | 'business_permit'
  | 'sss' | 'philhealth' | 'pagibig'
  | 'compliance' | 'meeting' | 'resolution';

/** Events about one item on the company, not the company's own record. */
export const ITEM_EVENTS = new Set<CorporateReportEvent>(['compliance', 'meeting', 'resolution']);

/** A compliance item (a filing deliverable on the company) as the report reads it. */
export interface ComplianceItem {
  id: string;
  name: string;
  /** The deliverable's type: 'SEC GIS', 'SEC AFS', 'BIR Filing', … */
  type: string | null;
  status: string;
  dueDate: string | null;
  doneOn: string | null;
}

/** What the report is built from: the company and, for an item's report, the item. */
export interface CorporateReportContext {
  corporation: Corporation;
  /** The client the letter is addressed to by default. */
  clientName: string;
  /** The matter's code, else the client's. */
  refNo: string;
  /** Open compliance items, soonest first: the next deadlines the report names. */
  upcoming: ComplianceItem[];
  compliance?: ComplianceItem;
  meeting?: CorporationMeeting;
  resolution?: Resolution;
}

interface EventSpec {
  label: string;
  /** The email subject's name for it, after the company. */
  subjectName: (c: CorporateReportContext) => string;
  /** The caption's "Re" line. */
  re: (c: CorporateReportContext) => string;
  /** The day the report is for; null when it isn't recorded. */
  date: (c: CorporateReportContext) => string | null;
  /** The file categories whose newest paper goes as Annex "A" by default. */
  annexCategories: string[];
  /** What the letter calls that paper. */
  annexDocument: string;
  /** What the record lacks, said before the report goes out. */
  needs?: (c: CorporateReportContext) => string[];
}

const company = (c: CorporateReportContext) => companyName(c.corporation) || BLANK('Company');

/** A compliance item's name without the company, which every such name carries: "SEC GIS (2023)". */
export function itemShortName(name: string, company: string): string {
  return name.replace(` — ${company}`, '').replace(/\s+/g, ' ').trim();
}

const FILING_WORDS: Record<DeliverableObligation, (period: string) => string> = {
  gis: (p) => `General Information Sheet (GIS) for ${p}`,
  afs: (p) => `Audited Financial Statements (AFS) for fiscal year ${p}`,
  itr: (p) => `annual income tax return (BIR Form No. 1702-RT) for fiscal year ${p}`,
};

/** What the letter calls a filing: in words for the catalog's own, else its name without the company. */
export function filingWords(item: Pick<ComplianceItem, 'name' | 'type'>, company: string): string {
  const obligation = obligationOfDeliverable({ type: item.type ?? '', name: item.name });
  const period = /\((?:FY )?(\d{4})\)\s*$/.exec(item.name)?.[1];
  if (obligation && period) return FILING_WORDS[obligation](period);
  return itemShortName(item.name, company);
}

const MEETING_NAMES: Record<string, string> = {
  Organizational: 'organizational meeting',
  'Regular Board': 'regular meeting of the Board of Directors',
  'Special Board': 'special meeting of the Board of Directors',
  'Annual Stockholders': 'annual meeting of the stockholders',
  'Special Stockholders': 'special meeting of the stockholders',
};
const meetingName = (m: CorporationMeeting | undefined) => (m ? MEETING_NAMES[m.meetingType] ?? 'meeting' : 'meeting');
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Who files a compliance item, from its type. */
function agencyOf(type: string | null): string {
  if (type?.startsWith('SEC')) return 'Securities and Exchange Commission (SEC)';
  if (type?.startsWith('BIR')) return 'Bureau of Internal Revenue (BIR)';
  return '';
}

const registered = (label: string, date: (k: Corporation) => string | null, categories: string[], document: string, re: string, subject: string): EventSpec => ({
  label, subjectName: () => subject, re: () => re, date: (c) => date(c.corporation), annexCategories: categories, annexDocument: document,
});

export const CORPORATE_REPORT_EVENTS: Record<CorporateReportEvent, EventSpec> = {
  sec_registration: {
    label: 'SEC registration report',
    subjectName: () => 'SEC Registration Report',
    re: () => 'Registration with the Securities and Exchange Commission',
    date: (c) => c.corporation.secRegistrationDate,
    annexCategories: ['SEC COR'],
    annexDocument: 'the Certificate of Incorporation',
    needs: (c) => (c.corporation.secRegistrationNo?.trim() ? [] : ['No SEC registration number on the company.']),
  },
  bir_registration: {
    ...registered('BIR registration report', (k) => k.birCorDate, ['BIR COR'], 'the Certificate of Registration (BIR Form No. 2303)', 'Registration with the Bureau of Internal Revenue', 'BIR Registration Report'),
    needs: (c) => (c.corporation.birTin?.trim() ? [] : ['No TIN on the company.']),
  },
  bir_books: registered('BIR books report', (k) => k.birBooksRegistrationDate, ['BIR Books'], 'the registered books of accounts', 'Registration of Books of Accounts', 'Books of Accounts Report'),
  bir_atp: registered('Authority to Print report', (k) => k.birOrAuthorityDate, ['Authority to Print'], 'the Authority to Print', 'Authority to Print', 'Authority to Print Report'),
  business_permit: {
    ...registered('Business permit report', (k) => k.businessPermitIssuedDate, ['Business Permit'], 'the business permit', 'Business Permit', 'Business Permit Report'),
    needs: (c) => (c.corporation.businessPermitLgu?.trim() ? [] : ['No LGU on the business permit — the letter says “the city or municipality”.']),
  },
  sss: registered('SSS registration report', (k) => k.sssRegistrationDate, ['SSS R-1'], 'the SSS employer registration', 'Employer Registration with the Social Security System', 'SSS Registration Report'),
  philhealth: registered('PhilHealth registration report', (k) => k.philhealthRegistrationDate, ['PhilHealth ER1'], 'the PhilHealth employer registration', 'Employer Registration with PhilHealth', 'PhilHealth Registration Report'),
  pagibig: registered('Pag-IBIG registration report', (k) => k.pagibigRegistrationDate, ['Pag-IBIG EFR'], 'the Pag-IBIG employer registration', 'Employer Registration with the Pag-IBIG Fund', 'Pag-IBIG Registration Report'),
  compliance: {
    label: 'Filing report',
    subjectName: (c) => `${c.compliance ? itemShortName(c.compliance.name, company(c)) : 'Compliance'} Filing Report`,
    re: (c) => `Filing of ${c.compliance ? itemShortName(c.compliance.name, company(c)) : BLANK('Filing')}`,
    date: (c) => c.compliance?.doneOn ?? null,
    annexCategories: [],
    annexDocument: 'the filing as received',
  },
  meeting: {
    label: 'Meeting report',
    subjectName: (c) => `Meeting Report — ${capitalize(meetingName(c.meeting))}`,
    re: (c) => capitalize(meetingName(c.meeting)),
    date: (c) => (c.meeting && c.meeting.meetingDate.slice(0, 10)) || null,
    annexCategories: [],
    annexDocument: 'the minutes of the meeting',
  },
  resolution: {
    label: 'Resolution report',
    subjectName: (c) => `${c.resolution?.kind === 'Secretarys Certificate' ? 'Secretary’s Certificate' : 'Resolution'} Report — ${c.resolution?.title.trim() || 'Resolution'}`,
    re: (c) => c.resolution?.title.trim() || BLANK('Resolution'),
    // A resolution is reported once it is signed.
    date: (c) => (c.resolution?.status === 'Signed' ? c.resolution.dateOfResolution.slice(0, 10) : null),
    annexCategories: [],
    annexDocument: 'the signed resolution',
  },
};

export const CORPORATE_REPORT_EVENT_KEYS = Object.keys(CORPORATE_REPORT_EVENTS) as CorporateReportEvent[];

export function isCorporateReportEvent(v: unknown): v is CorporateReportEvent {
  return typeof v === 'string' && v in CORPORATE_REPORT_EVENTS;
}

/** A report's own label: an item's names the item. */
export function corporateReportLabel(event: CorporateReportEvent, itemName?: string | null): string {
  const label = CORPORATE_REPORT_EVENTS[event].label;
  return ITEM_EVENTS.has(event) && itemName?.trim() ? `${label} — ${itemName.trim()}` : label;
}

/** The company's own registrations that are recorded, with their day — each a report. */
export function recordedRegistrations(corporation: Corporation): { event: CorporateReportEvent; date: string }[] {
  const ctx = { corporation } as CorporateReportContext;
  return CORPORATE_REPORT_EVENT_KEYS
    .filter((e) => !ITEM_EVENTS.has(e))
    .flatMap((event) => {
      const date = CORPORATE_REPORT_EVENTS[event].date(ctx);
      return date ? [{ event, date: date.slice(0, 10) }] : [];
    });
}

/** Defaults for the letter bodies and covering emails, by event. */
const BODY: Record<CorporateReportEvent, string> = {
  sec_registration:
    'We are pleased to inform you that the Securities and Exchange Commission (SEC) approved the registration of {{company}} on ' +
    '{{eventDate}}[[, under SEC Registration No. {{secNo}}]].[[ {{annexes}}]]\n\n' +
    'The company may now register with the Bureau of Internal Revenue (BIR) and secure its business permit from the city or municipality ' +
    'where its principal office is located. We will attend to these and keep you informed.\n\n{{upcoming}}',
  bir_registration:
    'We write to inform you that {{company}} was registered with the Bureau of Internal Revenue (BIR)[[, Revenue District Office No. {{rdo}},]] ' +
    'on {{eventDate}}[[, under Taxpayer Identification Number (TIN) {{tin}}]].[[ {{annexes}}]]\n\n' +
    'The Certificate of Registration must be displayed conspicuously at the company’s place of business.\n\n{{upcoming}}',
  bir_books:
    'We write to inform you that the books of accounts of {{company}} were registered with the Bureau of Internal Revenue (BIR) on ' +
    '{{eventDate}}.[[ {{annexes}}]]\n\n{{upcoming}}',
  bir_atp:
    'We write to inform you that the Bureau of Internal Revenue (BIR) granted {{company}} its Authority to Print on {{eventDate}}.[[ {{annexes}}]]\n\n{{upcoming}}',
  business_permit:
    'We write to inform you that {{permitIssuer}} issued the business permit of {{company}}[[ (Permit No. {{permitNo}})]] on ' +
    '{{eventDate}}.[[ The permit is valid until **{{permitExpiry}}**.]][[ {{annexes}}]]\n\n{{upcoming}}',
  sss:
    'We write to inform you that {{company}} was registered as an employer with the Social Security System (SSS) on {{eventDate}}' +
    '[[, under Employer No. {{employerNo}}]].[[ {{annexes}}]]\n\n{{upcoming}}',
  philhealth:
    'We write to inform you that {{company}} was registered as an employer with the Philippine Health Insurance Corporation (PhilHealth) on ' +
    '{{eventDate}}[[, under Employer No. {{employerNo}}]].[[ {{annexes}}]]\n\n{{upcoming}}',
  pagibig:
    'We write to inform you that {{company}} was registered as an employer with the Home Development Mutual Fund (Pag-IBIG Fund) on ' +
    '{{eventDate}}[[, under Employer No. {{employerNo}}]].[[ {{annexes}}]]\n\n{{upcoming}}',
  compliance:
    'We write to inform you that we filed the {{filing}} of {{company}}[[ with the {{agency}}]] on {{eventDate}}.[[ {{annexes}}]]\n\n{{upcoming}}',
  meeting:
    'We write to confirm that the {{meeting}} of {{company}} was held on {{eventDate}}[[ at {{venue}}]].[[ {{annexes}}]]\n\n{{upcoming}}',
  resolution:
    'We write to inform you that the {{resolutionKind}} of {{company}} on {{resolution}}, dated {{eventDate}}, has been signed.[[ {{annexes}}]]\n\n{{upcoming}}',
};

const MESSAGE: Record<CorporateReportEvent, string> = {
  sec_registration: 'We are pleased to inform you that the SEC approved the registration of {{company}} on {{eventDate}}.',
  bir_registration: 'We write to inform you that {{company}} was registered with the BIR on {{eventDate}}.',
  bir_books: 'We write to inform you that the books of accounts of {{company}} were registered with the BIR on {{eventDate}}.',
  bir_atp: 'We write to inform you that the BIR granted {{company}} its Authority to Print on {{eventDate}}.',
  business_permit: 'We write to inform you that the business permit of {{company}} was issued on {{eventDate}}.',
  sss: 'We write to inform you that {{company}} was registered as an employer with the SSS on {{eventDate}}.',
  philhealth: 'We write to inform you that {{company}} was registered as an employer with PhilHealth on {{eventDate}}.',
  pagibig: 'We write to inform you that {{company}} was registered as an employer with the Pag-IBIG Fund on {{eventDate}}.',
  compliance: 'We write to inform you that we filed the {{filing}} of {{company}} on {{eventDate}}.',
  meeting: 'We write to confirm that the {{meeting}} of {{company}} was held on {{eventDate}}.',
  resolution: 'We write to inform you that the {{resolutionKind}} of {{company}} on {{resolution}}, dated {{eventDate}}, has been signed.',
};

/** The covering email; the line on monitoring goes only when the caption names a deadline. */
const messageFor = (event: CorporateReportEvent, monitoring: boolean) =>
  `${MESSAGE[event]}\n\n` +
  'Please find attached our Status Report[[ and {{annexCopies}}]], for your records and reference.\n\n' +
  (monitoring ? 'We will continue to monitor the upcoming deadline noted above and will keep you duly informed of any developments.\n\n' : '') +
  'Kindly confirm receipt of this email and its attachments at your convenience.';

/** The paragraph after the body naming what the company owes next. */
const UPCOMING = 'For your reference, the next filings we are monitoring for the company are:';

const BLOCK_KEYS = new Set(['upcoming']);
/** How many open items the letter lists. */
const UPCOMING_LISTED = 4;

const day = (d: string | null | undefined) => (d ? formatDate(d.slice(0, 10)) : '');

const RESOLUTION_KINDS: Record<string, string> = {
  'Board Resolution': 'resolution of the Board of Directors',
  'Stockholders Resolution': 'resolution of the stockholders',
  'Secretarys Certificate': 'Secretary’s Certificate',
};

/** The upcoming items still to be filed, soonest first, after the day the report is for. */
function nextItems(c: CorporateReportContext): ComplianceItem[] {
  return c.upcoming.filter((i) => i.id !== c.compliance?.id && i.dueDate).slice(0, UPCOMING_LISTED);
}

/** What the wording's {{fields}} are filled with. A field the record has no value for is blank, so `[[ … ]]` around it drops out. */
export function corporateReportFields(c: CorporateReportContext, event: CorporateReportEvent, eventDate: string, annexes: string[]): Record<string, string> {
  const k = c.corporation;
  const employerNo = event === 'sss' ? k.sssEmployerNo : event === 'philhealth' ? k.philhealthEmployerNo : event === 'pagibig' ? k.pagibigEmployerNo : null;
  const next = nextItems(c)[0];
  const nextName = next ? itemShortName(next.name, company(c)) : '';
  return {
    company: company(c),
    eventDate: day(eventDate),
    annexes: annexSentence(annexes),
    annexCopies: annexCopies(annexes),
    secNo: k.secRegistrationNo?.trim() ?? '',
    tin: k.birTin?.trim() ?? '',
    rdo: k.birRdoCode?.trim() ?? '',
    permitNo: k.businessPermitNo?.trim() ?? '',
    permitIssuer: k.businessPermitLgu?.trim() ? `the ${k.businessPermitLgu.trim()}` : 'the city or municipality',
    permitExpiry: day(k.businessPermitExpiryDate),
    employerNo: employerNo?.trim() ?? '',
    filing: c.compliance ? filingWords(c.compliance, company(c)) : '',
    agency: agencyOf(c.compliance?.type ?? null),
    meeting: meetingName(c.meeting),
    venue: c.meeting?.venue?.trim() ?? '',
    resolution: c.resolution?.title.trim() ?? '',
    resolutionKind: c.resolution ? RESOLUTION_KINDS[c.resolution.kind] ?? 'resolution' : '',
    nextDeadline: next ? `${nextName} — ${day(next.dueDate)}` : '',
  };
}

function blocksFor(c: CorporateReportContext) {
  return (key: string): LetterParagraph[] => {
    if (key !== 'upcoming') return [];
    const items = nextItems(c);
    if (items.length === 0) return [];
    return [
      { text: UPCOMING, style: 'BodyText' },
      ...items.map((i, n): LetterParagraph => ({
        type: 'item',
        text: `${plain(filingWords(i, company(c)))} — due on **${day(i.dueDate)}**${n === items.length - 1 ? '.' : ';'}`,
        ...(n === items.length - 1 ? { spacing_after: 240 } : {}),
      })),
    ];
  };
}

function captionRows(c: CorporateReportContext, event: CorporateReportEvent): CaptionRow[] {
  const k = c.corporation;
  const next = nextItems(c)[0];
  return [
    { label: 'Company', value: company(c), bold: true },
    { label: 'SEC Reg. No.', value: k.secRegistrationNo?.trim() || BLANK('SEC Reg. No.') },
    ...(k.birTin?.trim() ? [{ label: 'TIN', value: k.birTin.trim() }] : []),
    { label: 'Re', value: CORPORATE_REPORT_EVENTS[event].re(c) },
    ...(next ? [{ label: 'Upcoming Deadline', value: `${itemShortName(next.name, company(c))} — ${day(next.dueDate)}` }] : []),
  ];
}

/** The covering email's caption: the deadline named in brackets with its date in bold, as the trademark emails do. */
function emailCaptionRows(caption: CaptionRow[]): CaptionRow[] {
  return caption.filter((r) => r.label !== 'Re').map((r) => {
    if (r.label !== 'Upcoming Deadline') return r;
    const [what, when] = splitDeadline(r.value);
    return when ? { label: `Upcoming Deadline (${what})`, value: when, bold: true } : { ...r, bold: true };
  });
}

/** "Acme Holdings, Inc. | GIS 2026 Filing Report (ACM-001)" — the subject line. */
function reportSubject(c: CorporateReportContext, event: CorporateReportEvent): string {
  return `${company(c)} | ${CORPORATE_REPORT_EVENTS[event].subjectName(c)}${c.refNo ? ` (${c.refNo})` : ''}`;
}

export interface CorporateClientReport {
  event: CorporateReportEvent;
  eventDate: string;
  subject: string;
  caption: CaptionRow[];
  emailCaption: CaptionRow[];
  signatory: ReportSignatory;
  paragraphs: LetterParagraph[];
  message: string;
  problems: string[];
}

export function buildCorporateReport(
  c: CorporateReportContext,
  event: CorporateReportEvent,
  opts: { today: string; signatory: ReportSignatory; letter?: ReportLetterFields; annexes: string[] },
): CorporateClientReport {
  const spec = CORPORATE_REPORT_EVENTS[event];
  const eventDate = spec.date(c);
  if (!eventDate) throw new Error(`${spec.label}: not recorded on this company`);

  const caption = captionRows(c, event);
  const letter = opts.letter ?? {};
  const addressee = letter.addressee?.trim() || c.clientName.trim() || BLANK('Addressee');
  const fields = corporateReportFields(c, event, eventDate, opts.annexes);
  const blocks = blocksFor(c);

  const paragraphs = reportLetter({
    today: opts.today,
    addressee,
    caption,
    refNo: c.refNo,
    letter,
    body: [
      ...wordingToParagraphs(BODY[event], fields, blocks, BLOCK_KEYS),
      { text: 'Should you have any questions, please do not hesitate to let us know.', style: 'BodyText' },
    ],
    signatory: opts.signatory,
  });

  const message = fillWording(messageFor(event, !!fields.nextDeadline), fields).replace(/\*/g, '');

  const k = c.corporation;
  const problems = [
    ...(k.secRegistrationNo?.trim() ? [] : event === 'sec_registration' ? [] : ['No SEC registration number on the company.']),
    ...(spec.needs?.(c) ?? []),
    ...(addressee === BLANK('Addressee') ? ['No client on the company — fill in who the letter is addressed to.'] : []),
    ...(c.refNo ? [] : ['The company’s matter has no code, so the letter has no Ref. No.']),
  ];

  return {
    event,
    eventDate: eventDate.slice(0, 10),
    subject: reportSubject(c, event),
    caption,
    emailCaption: emailCaptionRows(caption),
    signatory: opts.signatory,
    paragraphs,
    message,
    problems,
  };
}

/** What the company's contact is called on the letter: "Juan dela Cruz". */
export function contactName(k: Pick<Corporation, 'contactFirstName' | 'contactLastName'>): string {
  return [k.contactFirstName, k.contactLastName].map((s) => s?.trim()).filter(Boolean).join(' ');
}
