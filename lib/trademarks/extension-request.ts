import type { Trademark } from '@/types/notion';
import type { LetterParagraph } from '@/lib/docx/letter-body';
import {
  dau3Window, designationStart, isDesignation, issuanceFeeDeadline, noiDeadline, oaResponseDeadline, owesFirstPublicationFee,
} from '@/lib/trademark-deadlines';
import { officeActionName, openOfficeActions } from '@/lib/trademarks/office-actions';
import { formatDate } from '@/lib/format-date';

/**
 * A request for extension of time to the Director of Trademarks, on the firm
 * letterhead and laid out as the firm's responses to IPOPHL are. What it asks
 * for and why are the items and reasons of IPOPHL's optional form
 * (IPOPHL-SOP-BOT-01-F10): the person picks them, and the mark and its
 * recorded deadline fill the rest.
 *
 * A designation under the Madrid Protocol is captioned by its international
 * registration, and has no item C: its fees are paid to WIPO.
 */

/** The form's items A to E. */
export type ExtensionPurpose = 'oa_response' | 'foreign_registration' | 'fees' | 'dau_3' | 'appeal';

export const EXTENSION_PURPOSES: Record<ExtensionPurpose, { letter: string; text: string }> = {
  oa_response: { letter: 'A', text: 'File response to examiner’s action.' },
  foreign_registration: { letter: 'B', text: 'Submit copy of the foreign registration.' },
  fees: { letter: 'C', text: 'Pay the Allowance/Publication for Opposition/Issuance and Second Publication Fee/s.' },
  dau_3: { letter: 'D', text: 'Submit the Third-Year Declaration of Actual Use (DAU)/Declaration of Non-Use (DNU).' },
  appeal: { letter: 'E', text: 'File the petition or notice of appeal.' },
};
export const EXTENSION_PURPOSE_KEYS = Object.keys(EXTENSION_PURPOSES) as ExtensionPurpose[];

export type ExtensionReason = 'late_receipt' | 'workload' | 'complexity' | 'documents' | 'regulations';

export const EXTENSION_REASONS: Record<ExtensionReason, string> = {
  late_receipt: 'Late receipt of the notice/official action',
  workload: 'Heavy workload/Lack of manpower',
  complexity: 'Complexity of issue',
  documents: 'Unavailability of document/s',
  regulations: 'Granted by the Trademark Regulations',
};
export const EXTENSION_REASON_KEYS = Object.keys(EXTENSION_REASONS) as ExtensionReason[];

/** The purposes the Regulations grant an extension for as of right — the form's "For B, D and E". */
const GRANTED_BY_REGULATIONS: ReadonlySet<ExtensionPurpose> = new Set(['foreign_registration', 'dau_3', 'appeal']);

/** An examiner's action has a document, an examiner and a division to name; a DAU or a fee has none. */
const answersAnAction = (purpose: ExtensionPurpose) => purpose === 'oa_response' || purpose === 'appeal';

/** The Director's address as the firm's responses give it. */
export const DIRECTOR_ADDRESS = [
  'Intellectual Property Office of the Philippines',
  'Intellectual Property Center',
  '#28 Upper McKinley Road',
  'McKinley Hill Town Center',
  'Fort Bonifacio, Taguig City 1634',
];

export interface ExtensionRequestInput {
  purpose: ExtensionPurpose;
  reasons: ExtensionReason[];
  /** The form's "Others, please state". */
  otherReason?: string;
  /** The examiner's action being answered: its document number, examiner and division, as on the notice. */
  documentNo?: string;
  examiner?: string;
  division?: string;
}

/**
 * The deadline the extension is for, when the mark records it: its original
 * date, how far an extension would carry it, and whether one (a MOTEX) is
 * already on record.
 */
export function extensionDeadline(
  t: Trademark,
  purpose: ExtensionPurpose,
): { due: string; extendedDue: string | null; extensionFiled: boolean } | null {
  const open = openOfficeActions(t.officeActions);
  switch (purpose) {
    case 'oa_response':
    case 'appeal': {
      const oa = open.find((o) => (o.kind === 'final_rejection') === (purpose === 'appeal'));
      if (!oa) return null;
      const w = oaResponseDeadline(oa);
      return { due: w.due, extendedDue: w.extendedDue, extensionFiled: oa.motex };
    }
    case 'dau_3': {
      if (t.dau3FilingDate) return null;
      const w = dau3Window(t);
      return w ? { due: w.due, extendedDue: w.extendedDue, extensionFiled: t.dau3Motex } : null;
    }
    case 'fees': {
      if (isDesignation(t)) return null;
      const w = t.issuanceNoticeDate && !t.issuanceFeePaidDate ? issuanceFeeDeadline(t.issuanceNoticeDate)
        : owesFirstPublicationFee(t.filingDate) && t.noiDate && !t.noiPaymentDate ? noiDeadline(t.noiDate)
        : null;
      return w ? { due: w.due, extendedDue: null, extensionFiled: false } : null;
    }
    default:
      return null;
  }
}

/** What the request is most likely for on this mark now, or null when nothing it records is extendible. */
export function suggestedExtension(t: Trademark): ExtensionRequestInput | null {
  const madrid = isDesignation(t);
  // A designation's refusal always carries the response date on its notice, so that alone doesn't rule out asking for more time.
  const open = openOfficeActions(t.officeActions).filter((o) => !o.motex && (madrid || !o.respondBy));
  const counted = madrid ? designationStart(t) : t.filingDate;
  const purpose: ExtensionPurpose | null =
    open.some((o) => o.kind !== 'final_rejection') ? 'oa_response'
      : open.length ? 'appeal'
      : counted && !t.dau3FilingDate && !t.dau3Motex && t.status !== 'Abandoned' ? 'dau_3'
      : null;
  if (!purpose) return null;
  return { purpose, reasons: GRANTED_BY_REGULATIONS.has(purpose) ? ['regulations'] : ['complexity'] };
}

/** What the request lacks or gets wrong, said before it is filed. */
export function extensionProblems(t: Trademark, input: ExtensionRequestInput, today: string): string[] {
  const out: string[] = [];
  const madrid = isDesignation(t);
  if (!t.regIrNo?.trim()) out.push(`No ${madrid ? 'international registration' : 'application'} number on the mark — the line is left blank.`);
  if (!(madrid ? designationStart(t) : t.filingDate)) out.push(`No ${madrid ? 'international registration' : 'filing'} date on the mark — the line is left blank.`);
  if (madrid && input.purpose === 'fees') out.push('Item C is for fees paid to IPOPHL; a designation’s are paid to WIPO.');
  if (answersAnAction(input.purpose)) {
    const missing = [!input.documentNo?.trim() && 'document number', !input.examiner?.trim() && 'examiner', !input.division?.trim() && 'division'].filter(Boolean);
    if (missing.length) out.push(`No ${missing.join(', ')} given — left in brackets to fill in from the notice.`);
  }
  if (!input.reasons.length && !input.otherReason?.trim()) out.push('Give at least one reason.');
  if (input.reasons.includes('regulations') && !GRANTED_BY_REGULATIONS.has(input.purpose)) {
    out.push(`“${EXTENSION_REASONS.regulations}” applies only to items B, D and E.`);
  }
  const d = extensionDeadline(t, input.purpose);
  if (d?.extensionFiled) {
    out.push('An extension is already recorded for this deadline.');
  } else if (d && d.due < today) {
    out.push(`The period lapsed on ${formatDate(d.due)}. An extension has to be asked for before it lapses.`);
  }
  return out;
}

const BLANK = (what: string) => `[${what}]`;
const plain = (s: string) => s.replace(/\*/g, '');
const line = (text: string, after: number, format: Partial<LetterParagraph> = {}): LetterParagraph => ({
  text, alignment: 'left', spacing_after: after, ...format,
});

/** The caption's label column: wide enough for "International Registration No.". */
const CAPTION_LABEL_WIDTH = 3000;
/** Body paragraphs start half an inch in, and a numbered one's text at the inch, as in the firm's responses. */
const FIRST_LINE = 720;

/** What the Applicant asks more time to do, as the body's sentence says it. */
const PURPOSE_CLAUSE: Record<ExtensionPurpose, string> = {
  oa_response: 'file its response to the examiner’s action',
  foreign_registration: 'submit a copy of the foreign registration',
  fees: 'pay the Allowance/Publication for Opposition/Issuance and Second Publication Fee/s',
  dau_3: 'submit the Third-Year Declaration of Actual Use (DAU)/Declaration of Non-Use (DNU)',
  appeal: 'file the petition or notice of appeal',
};

/** The open round an extension to answer or appeal is for. */
function roundFor(t: Trademark, purpose: ExtensionPurpose) {
  if (purpose !== 'oa_response' && purpose !== 'appeal') return null;
  return openOfficeActions(t.officeActions).find((o) => (o.kind === 'final_rejection') === (purpose === 'appeal')) ?? null;
}

export interface ExtensionRequestFirm {
  name: string;
  addressLines: string[];
  email: string;
}

export interface ExtensionRequestSigner {
  name: string;
  position?: string | null;
}

/**
 * The request laid out as the firm's responses to IPOPHL are: the Director of
 * Trademarks, the caption (the mark, then the bureau, title, document and
 * examiner), ruled off; the title; the Applicant's numbered statements; and
 * "Respectfully," with the firm's block and "By:" over the signatory.
 */
export function buildExtensionRequest(
  mark: Trademark,
  input: ExtensionRequestInput,
  /**
   * The firm's own block under "Respectfully,": its name as it signs its
   * letters, its address and its trademark mailbox — each left out when the
   * firm has not set it.
   */
  opts: { today: string; signatory: ExtensionRequestSigner; firm: ExtensionRequestFirm },
): LetterParagraph[] {
  const madrid = isDesignation(mark);
  const dated = madrid ? designationStart(mark) : mark.filingDate;
  const numberLabel = madrid ? 'International Registration No.' : 'Application No.';
  const number = mark.regIrNo?.trim() || BLANK(numberLabel);
  const markName = mark.mark.trim() || BLANK('Mark');
  const round = roundFor(mark, input.purpose);
  const roundName = round ? round.title?.trim() || officeActionName(mark.officeActions, round) : null;
  const deadline = extensionDeadline(mark, input.purpose);
  const until = deadline && !deadline.extensionFiled ? deadline.extendedDue : null;

  const markRows = [
    { label: 'Applicant/s', lines: [plain(mark.owner?.trim() || mark.clientName?.trim() || BLANK('Applicant'))] },
    { label: 'Mark', lines: [`**${plain(markName)}**`] },
    { label: numberLabel, lines: [plain(number)] },
    {
      label: !madrid ? 'Date Filed' : mark.designationDate ? 'Date of Designation' : 'Date of International Registration',
      lines: [dated ? formatDate(dated) : BLANK('Date')],
    },
    { label: mark.classes.length === 1 ? 'Class' : 'Class/es', lines: [mark.classes.join(', ') || BLANK('Classes')] },
  ];
  // A deadline that answers no examiner's action (a DAU, a fee) has no document, examiner or division to name.
  const placed = (label: string, value?: string) =>
    value?.trim() ? [{ label, lines: [plain(value.trim())] }] : answersAnAction(input.purpose) ? [{ label, lines: [BLANK(label)] }] : [];
  const filingRows = [
    { label: 'Bureau', lines: ['Trademarks'] },
    { label: 'Title', lines: ['Request for Extension of Time'] },
    ...placed('Document No.', input.documentNo),
    ...placed('Examiner', input.examiner),
    ...placed('Division', input.division),
  ];
  const fields = (rows: { label: string; lines: string[] }[], ruleBelow: boolean): LetterParagraph => ({
    type: 'fields',
    text: rows.map((r) => `${r.label}: ${r.lines.join(' ')}`).join('\n'),
    fields: rows,
    labelWidth: CAPTION_LABEL_WIDTH,
    ruleBelow,
  });

  const reasons = [
    ...EXTENSION_REASON_KEYS.filter((r) => input.reasons.includes(r)).map((r) => EXTENSION_REASONS[r]),
    ...(input.otherReason?.trim() ? [plain(input.otherReason.trim())] : []),
  ];
  const body = (text: string, after = 240): LetterParagraph => ({ text, alignment: 'justified', spacing_after: after, firstLine: FIRST_LINE });
  let n = 0;
  const numbered = (text: string, after = 240) => body(`${++n}.\t${text}`, after);

  // What the record says about the deadline, when it says anything.
  const context: string[] = [];
  if (round && roundName) {
    context.push(
      `On ${formatDate(round.mailingDate)}, this Honorable Office issued the *${plain(roundName)}* on ${madrid ? 'the designation' : 'the application'}` +
      `${round.receivedDate ? `, which the Applicant received on ${formatDate(round.receivedDate)}` : ''}.`,
    );
  }
  if (deadline) {
    context.push(`The period to ${PURPOSE_CLAUSE[input.purpose].replace(/\bits\b/, 'the Applicant’s')} ends on ${formatDate(deadline.due)}.`);
  }

  return [
    line(formatDate(opts.today), 240),
    line('THE DIRECTOR OF TRADEMARKS', 0, { bold: true }),
    ...DIRECTOR_ADDRESS.map((l, i) => line(l, i === DIRECTOR_ADDRESS.length - 1 ? 240 : 0)),
    fields(markRows, false),
    line('', 0),
    fields(filingRows, true),
    {
      text: `Request for Extension of Time${round && roundName ? ` (${plain(roundName)} dated ${formatDate(round.mailingDate)})` : ''}`,
      alignment: 'center', bold: true, smallCaps: true, underline: true, spacing_before: 360, spacing_after: 240,
    },
    body(
      `Applicant, through undersigned counsel, respectfully requests an extension of time in ${numberLabel} ${plain(number)} ` +
      `for the mark **“${plain(markName)}”** (the “Subject Mark”), and states:`,
    ),
    ...context.map((c) => numbered(c)),
    numbered(
      `The Applicant respectfully requests an extension of time to ${PURPOSE_CLAUSE[input.purpose]}${until ? `, until ${formatDate(until)}` : ''}, ` +
      `for the following reason${reasons.length > 1 ? '/s' : ''}:`,
      120,
    ),
    ...reasons.map((r, i) => line(r, i === reasons.length - 1 ? 240 : 60, { indent: FIRST_LINE * 2 })),
    numbered('The Applicant will pay the corresponding extension fee.'),
    numbered('Accordingly, the Applicant respectfully prays that this request for extension of time be granted.', 360),
    line('Respectfully,', 360, { keepNext: true }),
    ...(opts.firm.name.trim() ? [line(plain(opts.firm.name), 0, { bold: true, keepNext: true })] : []),
    ...opts.firm.addressLines.map((l) => line(plain(l), 0, { keepNext: true })),
    ...(opts.firm.email.trim() ? [line(opts.firm.email.trim(), 0, { keepNext: true })] : []),
    line('', 360, { keepNext: true }),
    line('By:', 900, { keepNext: true }),
    line(plain(opts.signatory.name), 0, { bold: true, keepNext: !!opts.signatory.position }),
    ...(opts.signatory.position ? [line(plain(opts.signatory.position), 0, { italic: true })] : []),
  ];
}

export function extensionFileName(t: Trademark, today: string): string {
  const safe = (s: string) => s.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60);
  return `${safe(t.mark || 'mark')}-Request_for_Extension-${today}.docx`;
}
