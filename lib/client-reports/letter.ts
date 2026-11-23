import type { LetterParagraph } from '@/lib/docx/letter-body';
import { formatDate } from '@/lib/format-date';

/**
 * What every client report shares, whatever it is about — a step on a mark,
 * a filing for a company: the letter's opening, reference table and close,
 * the annex sentences, and the covering email in the firm's layout. Each kind
 * of report brings its own events, caption and wording
 * (lib/trademarks/client-report.ts, lib/corporations/client-report.ts).
 */

/** A value the record lacks, shown in brackets so it can't go out unnoticed. */
export const BLANK = (what: string) => `[${what}]`;

/** Asterisks are the body markup's bold and italic, so a value from the record never carries one. */
export const plain = (s: string) => s.replace(/\*/g, '');

/** At most this many papers go with a report — Annexes "A" to "J". */
export const MAX_ANNEXES = 10;

/** The letter an annex goes under: 0 → "A". */
export const annexLabel = (i: number) => String.fromCharCode(65 + i);

export const listed = (items: string[]) =>
  items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')}${items.length > 2 ? ',' : ''} and ${items[items.length - 1]}`;

/**
 * The letter's sentence on what is attached: "A copy of the Office Action is
 * attached as Annex “A”, and a copy of the specimen as Annex “B”." Blank with nothing attached.
 */
export function annexSentence(documents: string[]): string {
  const docs = documents.map((d) => plain(d.trim())).filter(Boolean);
  if (docs.length === 0) return '';
  const [first, ...rest] = docs.map((d, i) => `a copy of ${d}`.concat(i === 0 ? ` is attached as Annex “${annexLabel(i)}”` : ` as Annex “${annexLabel(i)}”`));
  const sentence = rest.length === 0 ? first
    : rest.length === 1 ? `${first}, and ${rest[0]}`
      : `${first}, ${rest.slice(0, -1).join(', ')}, and ${rest[rest.length - 1]}`;
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`;
}

/** The email's "and …" on what is attached: "a copy of the notice", "copies of the notice and the receipt". */
export function annexCopies(documents: string[]): string {
  const docs = documents.map((d) => plain(d.trim())).filter(Boolean);
  if (docs.length === 0) return '';
  return docs.length === 1 ? `a copy of ${docs[0]}` : `copies of ${listed(docs)}`;
}

/** A file's name as a fallback for what the letter calls it: no extension, no underscores. */
export const fileDocumentName = (name: string) => name.replace(/\.[a-z0-9]{1,5}$/i, '').replace(/[_]+/g, ' ').trim();

/** What the person preparing the report fills in — the record doesn't hold who the letter goes to. */
export interface ReportLetterFields {
  /** The addressee: a company or a person. Defaults to the client. */
  addressee?: string;
  /** "Attention:" — the person at the company. */
  attention?: string;
  salutation?: string;
}

export interface ReportSignatory {
  name: string;
  position?: string | null;
}

export interface CaptionRow {
  label: string;
  value: string;
  /** Set in bold in the email, as the firm sets the subject and the deadline's date. */
  bold?: boolean;
}

/**
 * "What — when" into its two parts, at the last dash: a filing named by hand
 * may carry a dash of its own, and a date never does.
 */
export function splitDeadline(value: string): [string, string | undefined] {
  const at = value.lastIndexOf(' — ');
  return at < 0 ? [value, undefined] : [value.slice(0, at), value.slice(at + 3)];
}

/** Wide enough for "Upcoming Deadline", the longest label, set right in 12pt. */
const CAPTION_LABEL_WIDTH = 2200;

export const line = (text: string, after: number, format: Partial<LetterParagraph> = {}): LetterParagraph => ({
  text, alignment: 'left', spacing_after: after, ...format,
});

/**
 * Attention, the caption and the Ref. No. as the letters' label/value table,
 * ruled off before the salutation — the layout the billing letter uses.
 */
export function referenceBlock(caption: CaptionRow[], refNo: string, attention?: string): LetterParagraph {
  const rows = [
    ...(attention?.trim() ? [{ label: 'Attention', lines: [`**${plain(attention.trim())}**`] }] : []),
    // A deadline's date goes under what is due, as the billing letter sets the invoice number under its subject.
    ...caption.map((r) => ({ label: r.label, lines: splitDeadline(plain(r.value)).filter(Boolean).map((l) => `**${l}**`) })),
    { label: 'Ref. No.', lines: [plain(refNo)] },
  ];
  return {
    type: 'fields',
    text: rows.map((r) => `${r.label}: ${r.lines.join(' ')}`).join('\n'),
    fields: rows,
    labelWidth: CAPTION_LABEL_WIDTH,
    ruleBelow: true,
  };
}

/**
 * The whole letter around its body: the date, "Digitally transmitted", the
 * addressee, the reference table and the salutation, then the body and the
 * close signed for the firm.
 */
export function reportLetter(opts: {
  today: string;
  addressee: string;
  caption: CaptionRow[];
  refNo: string;
  letter: ReportLetterFields;
  body: LetterParagraph[];
  signatory: ReportSignatory;
}): LetterParagraph[] {
  return [
    line(formatDate(opts.today), 240),
    line('*Digitally transmitted*', 240),
    line(plain(opts.addressee), 240, { bold: true, smallCaps: true }),
    referenceBlock(opts.caption, opts.refNo, opts.letter.attention),
    line(plain(opts.letter.salutation?.trim() || 'Dear Sir or Madam:'), 240, { spacing_before: 240 }),
    ...opts.body,
    line('Very truly yours,', 240, { keepNext: true }),
    line('For the Firm:', 900, { keepNext: true }),
    line(plain(opts.signatory.name), 0, { bold: true, smallCaps: true, keepNext: !!opts.signatory.position }),
    ...(opts.signatory.position ? [line(plain(opts.signatory.position), 0, { italic: true })] : []),
  ];
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const EMAIL_FONT = 'font-family:Georgia,serif;font-size:11pt;color:#000';
const DISCLAIMER =
  'This email (and its attachments, if any) is intended only for the use of the person to whom it is addressed and may contain information ' +
  'that is confidential and privileged under applicable laws. If you are not the intended recipient, you are hereby notified that any use, ' +
  'review, disclosure or copying of this message and the information it contains is prohibited. If you have received this message in error, ' +
  'please notify the sender by reply e-mail and discard all its contents.';

/**
 * The covering email, laid out as the firm's own report emails are: the Ref. No.,
 * the caption, the salutation, the message, the close, and the sender's signature
 * block with the firm's name, its address and the confidentiality notice. The
 * firm is the sending firm's own, from its branding and invoice settings.
 */
export interface ReportEmailFirm {
  name: string;
  addressLines: string[];
}

export function reportEmailHtml(opts: {
  message: string; caption: CaptionRow[]; refNo: string; senderName: string; senderPosition?: string | null; salutation?: string;
  firm: ReportEmailFirm;
}): string {
  const p = (html: string, extra = '') => `<p style="margin:0 0 12px;${extra}">${html}</p>`;
  const tight = (html: string, extra = '') => `<p style="margin:0;${extra}">${html}</p>`;
  const paras = opts.message.split(/\n{2,}/).map((x) => x.trim()).filter(Boolean)
    .map((x) => p(escapeHtml(x).replace(/\n/g, '<br>'))).join('');
  const cell = 'padding:1pt 6pt 1pt 0;vertical-align:top;';
  const row = (r: CaptionRow) =>
    `<tr><td style="${cell}">${escapeHtml(r.label)}</td><td style="${cell}">:</td>` +
    `<td style="${cell}">${r.bold ? `<b>${escapeHtml(r.value)}</b>` : escapeHtml(r.value)}</td></tr>`;
  const deadline = opts.caption.findIndex((r) => r.label.startsWith('Upcoming Deadline'));
  const rows = opts.caption.map((r, i) => (i === deadline && i > 0 ? `<tr><td colspan="3" style="height:12px"></td></tr>` : '') + row(r)).join('');
  const signature = [
    tight(`<b>${escapeHtml(opts.senderName.toUpperCase())}</b>`),
    ...(opts.senderPosition?.trim() ? [tight(`<i>${escapeHtml(opts.senderPosition.trim())}</i>`)] : []),
    tight('&nbsp;'),
    ...(opts.firm.name ? [tight(escapeHtml(opts.firm.name))] : []),
    ...opts.firm.addressLines.map((l) => tight(escapeHtml(l))),
    tight('&nbsp;'),
    tight(DISCLAIMER, 'font-size:9pt;color:#555'),
  ].join('');
  return (
    `<div style="${EMAIL_FONT}">` +
    p(`Ref. No.: ${escapeHtml(opts.refNo)}`) +
    `<table style="border-collapse:collapse;margin:0 0 16px;${EMAIL_FONT}">${rows}</table>` +
    p(escapeHtml(opts.salutation?.trim() || 'Dear Sir or Madam:')) +
    paras +
    p('Should you have any questions, please do not hesitate to let us know.') +
    p('Thank you.') +
    p('Warm regards,') +
    signature +
    '</div>'
  );
}
