/**
 * What a billing letter says, paragraph by paragraph.
 *
 * There is one letter. Its WORDS are finance's — every standard paragraph and
 * every optional one comes from lib/billing/letter-blocks.ts, as saved in the
 * letter template editor. WHEN each paragraph appears is decided here, from the
 * invoice's figures and the client's billing profile:
 *
 *   VAT                 the VAT phrase inside the bill
 *   previous balance    the carry-over sentence, outstanding or credit
 *   retainer cap        the "could have amounted to" paragraph, when the hours
 *                       actually exceeded the cap
 *   addressee           a company with an Attention line, or a person
 *   early payment       the discount offer, when the client has one
 *
 * and finance ticks the rest on a client or an invoice: an initial statement,
 * the lessen-fees note, and any optional paragraphs from their library.
 *
 * The output is the drafting body format (lib/docx/letter-body), laid on the
 * firm letterhead by lib/docx/billing-letter.ts. It is pure, so the template
 * editor previews with the same function the invoice is generated with.
 */

import type { LetterParagraph } from '@/lib/docx/letter-body';
import { DEFAULT_SALUTATION, formatLetterDate, normalizeLetterDate } from './letter-format';
import type { EarlyPaymentOffer } from './early-payment';
import { letterWording, wordingParagraphs, type LetterWording, type StandardBlockKey } from './letter-blocks';
import { paragraphShows, type Facts, type SystemParagraph } from './paragraphs';

export type LetterAddressee = 'company' | 'person';

export interface BillingLetterParams {
  /**
   * How the firm's typeface writes the peso — "₱" or "P" (pesoSymbol in
   * lib/pdf/fonts.ts). Absent means "P", which every face can set.
   */
  pesoSymbol?: string;
  /** The letter's date, already formatted; today in Manila when absent. */
  date?: string;
  invoiceNumber?: string;
  /** The firm's name as it signs its letters (firms.branding.documentName). */
  firmName?: string;
  /** A company is named with its address and an Attention line; a person by name. */
  addressee?: LetterAddressee;
  clientName: string;
  clientAddress?: string;
  attnName: string;
  attnTitle?: string;
  throughName?: string;
  salutation?: string;
  billingPeriod: string;
  engagementDate?: string;
  retainerCap?: number;
  retainerHoursCap?: number;
  /** What the capped hours were worth at full rates, before the cap. */
  actualHoursAmount?: number;
  /** The bill's total — the breakdown's GRAND TOTAL. */
  totalAmount: number;
  /** Out-of-pocket expenses on this bill; with none, the letter speaks of legal fees alone. */
  totalExpenses?: number;
  /** Signed: positive is owed from earlier billings, negative is an advance credit. */
  previousBalance?: number;
  previousBalanceLabel?: string;
  totalWithBalance?: number;
  /** The advance deposit held on the client's behalf (informational note). */
  depositOnHand?: number;
  /** Settle-from-deposit figures, frozen at generation. Set only when the deposit is applied. */
  depositApplied?: number;
  depositRemaining?: number;
  netAmountDue?: number;
  includeVAT: boolean;
  bankName: string;
  bankAccountNo: string;
  bankAccountName: string;
  dueDate: string;
  signerName: string;
  signerPosition?: string;
  /** Write "Atty." before the signatory's printed name. */
  signerAtty?: boolean;
  includeLessenFeesNote?: boolean;
  /** e.g. "Revised version (R2) of invoice originally sent on 30 April 2026". Empty on first send. */
  revisionNotice?: string;
  /** Opens as "our initial billing statement" rather than a statement for a period. */
  initialStatement?: boolean;
  /** Keys of the optional paragraphs this letter carries, from finance's library. */
  optionalParagraphs?: string[];
  earlyPayment?: EarlyPaymentOffer | null;
  /** The wording to write in; the defaults when absent. */
  wording?: LetterWording;
}

/** "P12,345.00" in the letter's own peso sign. */
export function letterMoney(n: number, symbol = 'P'): string {
  return `${symbol}${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * What the client is asked to remit on this letter: the bill after any carried
 * balance and deposit application. Zero when the deposit covers everything.
 */
export function amountToRemit(p: BillingLetterParams): number {
  if ((p.depositApplied ?? 0) > 0.005) return Math.max(0, p.netAmountDue ?? 0);
  return Math.max(0, p.totalWithBalance ?? p.totalAmount);
}

/**
 * Asterisks and double underscores are the body format's emphasis markup, so a
 * name or address carrying one would turn the rest of its line bold.
 */
function plain(s: string | undefined | null): string {
  return (s ?? '').replace(/\*/g, '').replace(/__/g, '_').trim();
}

const line = (text: string, after: number, format: Partial<LetterParagraph> = {}): LetterParagraph => ({
  text,
  alignment: 'left',
  spacing_after: after,
  ...format,
});

const body = (text: string): LetterParagraph => ({ text, spacing_after: 240 });

/** Lines of an address, blank lines dropped. */
function addressLines(address: string | undefined): string[] {
  return (address ?? '').split('\n').map(plain).filter(Boolean);
}

function addresseeBlock(p: BillingLetterParams): LetterParagraph[] {
  const out: LetterParagraph[] = [];
  const client = plain(p.clientName);
  const attn = plain(p.attnName);
  const address = addressLines(p.clientAddress);

  if (p.addressee === 'person') {
    // A person is the addressee: their name, then wherever they receive mail.
    out.push(line(attn || client, 0, { bold: true, smallCaps: true }));
    address.forEach((a) => out.push(line(a, 0)));
  } else {
    out.push(line(client, 0, { bold: true, smallCaps: true }));
    address.forEach((a) => out.push(line(a, 0)));
    // The Attention line names who at the company reads it — unless the
    // configured name is just the company again.
    if (attn && attn.toLowerCase() !== client.toLowerCase()) {
      out[out.length - 1] = { ...out[out.length - 1], spacing_after: 240 };
      out.push(line(`Attention: **${attn}**`, 0));
      if (plain(p.attnTitle)) out.push(line(plain(p.attnTitle), 0, { italic: true }));
    }
  }
  if (plain(p.throughName)) {
    out[out.length - 1] = { ...out[out.length - 1], spacing_after: 240 };
    out.push(line(`Through: **${plain(p.throughName)}**`, 0));
  }
  out[out.length - 1] = { ...out[out.length - 1], spacing_after: 240 };
  return out;
}

/**
 * The values the wording's {{fields}} are filled with. Blank when the letter has
 * no such figure, so a `[[ … ]]` around it drops out.
 */
export function letterFields(p: BillingLetterParams, w: LetterWording): Record<string, string> {
  const fmt = (n: number) => letterMoney(n, p.pesoSymbol);
  const prev = p.previousBalance ?? 0;
  const rawLabel = plain(p.previousBalanceLabel);
  // The generated labels name the figure ("outstanding balance for periods
  // through …"); one typed on an override may be a bare period ("February 2026").
  const label = !rawLabel || prev < 0 || /^outstanding balance\b/i.test(rawLabel) ? rawLabel : `balance for ${rawLabel}`;
  const offer = p.earlyPayment;
  const remit = amountToRemit(p);
  return {
    clientName: plain(p.clientName),
    firmName: plain(p.firmName),
    period: plain(p.billingPeriod),
    engagementDate: normalizeLetterDate(p.engagementDate),
    invoiceNumber: plain(p.invoiceNumber),
    total: fmt(p.totalAmount),
    totalWithBalance: fmt(p.totalWithBalance ?? p.totalAmount),
    previousBalance: prev > 0.005 ? fmt(prev) : '',
    previousCredit: prev < -0.005 ? fmt(-prev) : '',
    previousBalanceLabel: label,
    feesDescription: (p.totalExpenses ?? 1) > 0.005 ? w.standard.phrase_fees_and_expenses : w.standard.phrase_fees_only,
    vatPhrase: p.includeVAT ? w.standard.phrase_vat : '',
    actualHoursAmount: p.actualHoursAmount ? fmt(p.actualHoursAmount) : '',
    retainerHoursCap: p.retainerHoursCap ? String(p.retainerHoursCap) : '',
    retainerCap: p.retainerCap ? fmt(p.retainerCap) : '',
    amountToRemit: fmt(remit),
    bankName: plain(p.bankName),
    bankAccountNo: plain(p.bankAccountNo),
    bankAccountName: plain(p.bankAccountName),
    dueDate: plain(p.dueDate),
    discountPercent: offer ? String(offer.percent) : '',
    discountAmount: offer ? fmt(offer.amount) : '',
    discountedAmount: offer ? fmt(Math.max(0, remit - offer.amount)) : '',
    discountDeadline: offer ? normalizeLetterDate(offer.deadline) : '',
    discountVatNote: offer && p.includeVAT ? 'inclusive of VAT' : '',
  };
}

/** The signatory's name as printed, with "Atty." when the firm writes it. */
export function printedSigner(p: Pick<BillingLetterParams, 'signerName' | 'signerAtty'>): string {
  const name = plain(p.signerName);
  if (!p.signerAtty || !name || /^atty\.?\s/i.test(name)) return name;
  return `Atty. ${name}`;
}

/** What the paragraphs' rules test, from the letter's own figures. */
export function letterFacts(p: BillingLetterParams): Facts {
  const remit = amountToRemit(p);
  const offer = p.earlyPayment;
  return {
    vat: !!p.includeVAT,
    expenses: (p.totalExpenses ?? 1) > 0.005,
    previousBalance: (p.previousBalance ?? 0) > 0.005,
    advanceCredit: (p.previousBalance ?? 0) < -0.005,
    overCap: !!p.retainerCap && (p.retainerHoursCap ?? 0) > 0 && (p.actualHoursAmount ?? 0) > p.retainerCap + 0.005,
    lessenFees: !!p.includeLessenFeesNote,
    initialStatement: !!p.initialStatement,
    moneyOnHand: (p.depositApplied ?? 0) > 0.005 || (p.depositOnHand ?? 0) > 0.005,
    payable: remit > 0.005,
    bankDetails: !!plain(p.bankAccountNo),
    discount: !!offer && offer.amount > 0.005 && offer.amount < remit && remit > 0.005,
  };
}

/**
 * The paragraph the app words itself: what the advance deposit pays, and what
 * is left of it. Empty when the letter has no deposit to speak of.
 */
export function systemTexts(p: BillingLetterParams): Record<SystemParagraph, string> {
  const fmt = (n: number) => letterMoney(n, p.pesoSymbol);
  let deposit = '';
  const applied = p.depositApplied ?? 0;
  if (applied > 0.005) {
    const netDue = p.netAmountDue ?? 0;
    const remaining = p.depositRemaining ?? 0;
    deposit =
      `We have applied ${fmt(applied)} from the advance deposit of ${fmt(p.depositOnHand ?? applied)} we hold on your behalf against this billing. ` +
      (netDue > 0.005
        ? `**The remaining amount due after this application is ${fmt(netDue)}.** `
        : '**No further payment is due for this statement.** ') +
      (remaining > 0.005
        ? `Your remaining advance deposit on hand is ${fmt(remaining)}.`
        : 'This application exhausts your advance deposit on hand.');
  } else if ((p.depositOnHand ?? 0) > 0.005) {
    deposit = `Please note that we currently hold an advance deposit of ${fmt(p.depositOnHand!)} on your behalf, which remains available to be applied against future billings.`;
  }
  return { deposit };
}

export function billingLetterParagraphs(p: BillingLetterParams): LetterParagraph[] {
  const w = p.wording ?? letterWording();
  const fields = letterFields(p, w);
  const say = (key: StandardBlockKey) => wordingParagraphs(w.standard[key], fields);
  const sayLine = (key: StandardBlockKey) => say(key).join(' ');
  const out: LetterParagraph[] = [];

  // ── Heading
  if (plain(p.revisionNotice)) {
    out.push(line(`*${plain(p.revisionNotice)}*`, 240, { alignment: 'right' }));
  }
  out.push(line(p.date ?? formatLetterDate(), 240));
  if (sayLine('transmittal')) out.push(line(sayLine('transmittal'), 240));
  out.push(...addresseeBlock(p));
  if (plain(p.invoiceNumber)) {
    out.push(line(sayLine('subject'), 0));
    out.push(line(`Invoice No. ${plain(p.invoiceNumber)}`, 240));
  } else {
    out.push(line(sayLine('subject'), 240));
  }
  // Matters stored the greeting without its colon — the Word templates typed it
  // after the placeholder — so it is added here unless one is already there.
  const greeting = plain(p.salutation) || DEFAULT_SALUTATION;
  out.push(line(/[:,]$/.test(greeting) ? greeting : `${greeting}:`, 240));

  // ── The body: finance's paragraphs, in their order, each where its rule holds.
  const facts = letterFacts(p);
  const system = systemTexts(p);
  for (const para of w.paragraphs) {
    if (!paragraphShows(para, facts, p.optionalParagraphs ?? [])) continue;
    if (para.system) {
      const text = system[para.system];
      if (text) out.push(body(text));
      continue;
    }
    wordingParagraphs(para.body, fields).forEach((t) => out.push(body(t)));
  }

  // ── The house sign-off. The whole block stays on one page, with the paragraph
  // before it, so a signature never lands on a page of its own. The printed name
  // is its own paragraph so a signed scan lines up with it.
  out[out.length - 1] = { ...out[out.length - 1], keepNext: true };
  out.push(line(sayLine('complimentary_close'), 240, { keepNext: true }));
  out.push(line(sayLine('firm_line'), 900, { keepNext: true }));
  out.push(line(printedSigner(p), plain(p.signerPosition) ? 0 : 240, { bold: true, smallCaps: true, keepNext: !!plain(p.signerPosition) }));
  if (plain(p.signerPosition)) out.push(line(plain(p.signerPosition), 0, { italic: true }));

  return out;
}
