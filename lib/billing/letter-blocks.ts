/**
 * The billing letter's fixed lines and phrases — the subject, the transmittal
 * line, the closing lines, and the phrases the bill paragraph is built from —
 * each editable on the Billing Letter page. The letter's paragraphs themselves
 * are a list finance manages (lib/billing/paragraphs.ts).
 *
 * Wording uses `{{fields}}` the letter fills in, `**bold**` and `*italic*`, a
 * blank line to start a new paragraph, and `[[ … ]]` around a phrase that
 * should drop out when a field inside it is blank.
 */

import type { LetterPlaceholder } from '@/lib/letter-placeholders';
import { fieldsIn, fillWording, wordingProblem as sharedWordingProblem } from '@/lib/letter-wording';
import { DEFAULT_LETTER_PARAGRAPHS, type BillingParagraph } from './paragraphs';

export type StandardBlockKey =
  | 'transmittal' | 'subject' | 'phrase_fees_and_expenses' | 'phrase_fees_only' | 'phrase_vat'
  | 'complimentary_close' | 'firm_line';

export interface StandardBlockDef {
  key: StandardBlockKey;
  label: string;
  /** When the letter uses it, in finance's terms. */
  when: string;
  body: string;
}

export const STANDARD_BLOCKS: StandardBlockDef[] = [
  { key: 'transmittal', label: 'Transmittal line', when: 'Every letter, under the date', body: '*Digitally transmitted*' },
  { key: 'subject', label: 'Subject line', when: 'Every letter', body: 'Subject: **Billing Statement – {{period}}**' },
  { key: 'phrase_fees_and_expenses', label: 'Phrase: fees and expenses', when: 'Fills {{feesDescription}} when the bill has expenses', body: 'legal fees and out-of-pocket expenses' },
  { key: 'phrase_fees_only', label: 'Phrase: fees only', when: 'Fills {{feesDescription}} when the bill has no expenses', body: 'legal fees' },
  { key: 'phrase_vat', label: 'Phrase: VAT', when: 'Fills {{vatPhrase}} when the client is billed with VAT; blank otherwise', body: ', including value-added tax (VAT),' },
  { key: 'complimentary_close', label: 'Complimentary close', when: 'Every letter', body: 'Very truly yours,' },
  { key: 'firm_line', label: 'Firm line', when: 'Every letter, above the signer', body: 'For the Firm:' },
];

export const STANDARD_BLOCK_KEYS = new Set<string>(STANDARD_BLOCKS.map((b) => b.key));

/** The wording a letter is written in: its fixed lines, and its paragraphs in order. */
export interface LetterWording {
  standard: Record<StandardBlockKey, string>;
  paragraphs: BillingParagraph[];
}

/** The fixed lines' defaults with any saved wording over them, and the given paragraphs. */
export function letterWording(
  rows: { key: string; kind: string; body: string }[] = [],
  paragraphs: BillingParagraph[] = defaultParagraphs('letter'),
): LetterWording {
  const standard = Object.fromEntries(STANDARD_BLOCKS.map((b) => [b.key, b.body])) as Record<StandardBlockKey, string>;
  for (const r of rows) {
    if (r.kind === 'standard' && STANDARD_BLOCK_KEYS.has(r.key) && r.body.trim()) standard[r.key as StandardBlockKey] = r.body;
  }
  return { standard, paragraphs };
}

/** The paragraphs the firm started with, for a document with none saved. */
export function defaultParagraphs(document: 'letter'): BillingParagraph[] {
  return DEFAULT_LETTER_PARAGRAPHS.map((d, i) => ({ ...d, document, sortOrder: (i + 1) * 10, archived: false }));
}

/** Every field a paragraph may use — the editor shows each as a chip. */
export const LETTER_PLACEHOLDERS: LetterPlaceholder[] = [
  { key: 'clientName', label: 'Client', meaning: 'the client' },
  { key: 'firmName', label: 'Firm', meaning: "the firm's name, as it signs its letters" },
  { key: 'period', label: 'Billing period', meaning: 'the billing period, e.g. September 2026' },
  { key: 'engagementDate', label: 'Engagement date', meaning: 'the engagement agreement date (blank when none)' },
  { key: 'invoiceNumber', label: 'Invoice no.', meaning: 'the invoice number' },
  { key: 'total', label: 'Bill total', meaning: "this period's bill, with VAT when billed" },
  { key: 'totalWithBalance', label: 'Total with balance', meaning: 'the bill plus the previous balance, or less the credit' },
  { key: 'previousBalance', label: 'Previous balance', meaning: 'what is owed from earlier billings' },
  { key: 'previousCredit', label: 'Advance credit', meaning: 'the advance credit applied' },
  { key: 'previousBalanceLabel', label: 'Balance description', meaning: 'e.g. "outstanding balance for periods through 31 August 2026"' },
  { key: 'feesDescription', label: 'Fees phrase', meaning: 'the fees-and-expenses phrase, or the fees-only phrase' },
  { key: 'vatPhrase', label: 'VAT phrase', meaning: 'the VAT phrase when billed with VAT; blank otherwise' },
  { key: 'actualHoursAmount', label: 'Hours at full rates', meaning: 'what the hours were worth before the cap' },
  { key: 'retainerHoursCap', label: 'Hours covered', meaning: 'the hours the retainer covers' },
  { key: 'retainerCap', label: 'Retainer cap', meaning: 'the monthly retainer cap' },
  { key: 'amountToRemit', label: 'Amount to remit', meaning: 'what the client is asked to pay on this letter' },
  { key: 'bankName', label: 'Bank', meaning: 'the bank' },
  { key: 'bankAccountNo', label: 'Account no.', meaning: 'the account number' },
  { key: 'bankAccountName', label: 'Account name', meaning: 'the account name' },
  { key: 'dueDate', label: 'Due date', meaning: 'the due date' },
  { key: 'discountPercent', label: 'Discount %', meaning: 'the early-payment discount percent' },
  { key: 'discountAmount', label: 'Discount', meaning: 'the early-payment discount amount' },
  { key: 'discountedAmount', label: 'Discounted amount', meaning: 'the amount to remit if paid early' },
  { key: 'discountDeadline', label: 'Pay-by date', meaning: 'the last day to pay for the discount' },
  { key: 'discountVatNote', label: 'VAT note', meaning: '"inclusive of VAT" when billed with VAT; blank otherwise' },
];

const KNOWN_FIELDS = new Set(LETTER_PLACEHOLDERS.map((p) => p.key));

/** Fields a wording names that the letter does not know — a typo would print as-is. */
export function unknownFields(body: string): string[] {
  return fieldsIn(body).filter((f) => !KNOWN_FIELDS.has(f));
}

/** What is wrong with a paragraph's wording, if anything, in finance's terms. */
export function wordingProblem(body: string): string | null {
  return sharedWordingProblem(body, KNOWN_FIELDS);
}

/** A filled wording as paragraphs — a blank line starts a new one. */
export function wordingParagraphs(body: string, fields: Record<string, string>): string[] {
  return fillWording(body, fields).split(/\n\s*\n/).map((p) => p.replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean);
}

