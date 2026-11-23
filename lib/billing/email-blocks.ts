/**
 * The billing email — the message an invoice is sent with — as an ordered list
 * of paragraphs finance owns, like the letter's (lib/billing/paragraphs.ts).
 * It goes out in the firm's branded email frame (lib/email-chrome.ts).
 *
 * The email says what the letter says. When the invoice is generated the
 * letter freezes its figures, the facts its paragraphs were chosen by, and the
 * app-worded paragraph onto the invoice (`billing_settings.letterBasis`);
 * the email reads those, so the two can't disagree. An invoice generated
 * before that has no basis, and its email is worked out from the invoice's own
 * figures instead (`basisFromInvoice`).
 *
 * Email paragraphs are stored as the editor's HTML, with `{{fields}}` and
 * `[[ … ]]` working as in the letter. The subject is one fixed line.
 */

import { type StandardBlockDef } from './letter-blocks';
import { fillWording } from '@/lib/letter-wording';
import { markupToHtml } from '@/lib/letter-markup';
import { DEFAULT_LETTER_PARAGRAPHS, paragraphShows, type BillingParagraph, type Facts, type SystemParagraph } from './paragraphs';
import { invoiceGrossDue, type InvoiceAmountRow } from '@/lib/finance/invoice-amounts';
import { readEarlyPaymentOffer } from './early-payment';
import { invoicePeriodDisplay, normalizeLetterDate } from './letter-format';
import { letterMoney } from './letter-content';
import { addDays, isCalendarDay, manilaToday } from '@/lib/dates';
import { styleLetterHtml, wrapBrandedEmail, type EmailBrand } from '@/lib/email-chrome';

const roundMoney = (n: number) => Math.round(n * 100) / 100;

export type EmailBlockKey = 'email_subject';

export interface EmailBlockDef extends Omit<StandardBlockDef, 'key'> {
  key: EmailBlockKey;
}

/** The email's one fixed line. */
export const EMAIL_BLOCKS: EmailBlockDef[] = [
  { key: 'email_subject', label: 'Subject', when: 'Every billing email', body: 'Billing Statement – {{period}} | {{clientName}}' },
];

export const EMAIL_BLOCK_KEYS = new Set<string>(EMAIL_BLOCKS.map((b) => b.key));

/** The email subject's saved wording, or its default. */
export function emailSubjectWording(rows: { key: string; kind: string; body: string }[] = []): string {
  const saved = rows.find((r) => r.kind === 'standard' && r.key === 'email_subject' && r.body.trim());
  return saved?.body ?? EMAIL_BLOCKS[0].body;
}

const GREETING = '<p>Good day,</p>';
// The firm's own name, filled in when the email is written — never a name here.
const SIGNOFF = '<p>Best regards,<br><strong>{{firmName}}</strong><br>Finance Department</p>';

/**
 * The email's paragraphs as the firm started with them: the letter's, in the
 * letter's order and with its rules, between the email's greeting and sign-off.
 */
export function defaultEmailParagraphs(): BillingParagraph[] {
  const body = DEFAULT_LETTER_PARAGRAPHS.map((d) => ({ ...d, body: d.system ? '' : markupToHtml(d.body) }));
  return [
    { key: 'greeting', label: 'Greeting', body: GREETING, rule: [], choice: null, system: null },
    ...body,
    { key: 'signoff', label: 'Sign-off', body: SIGNOFF, rule: [], choice: null, system: null },
  ].map((d, i) => ({ ...d, document: 'email' as const, sortOrder: (i + 1) * 10, archived: false }));
}

/** What a letter froze for its email: the figures, the facts, and the app-worded paragraph. */
export interface LetterBasis {
  fields: Record<string, string>;
  facts: Facts;
  system: Record<SystemParagraph, string>;
}

export interface BillingEmailInvoice extends InvoiceAmountRow {
  invoice_number: string;
  client_name: string;
  billing_month: string;
  billing_settings?: (InvoiceAmountRow['billing_settings'] & Record<string, unknown>) | null;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function isBasis(v: unknown): v is LetterBasis {
  const b = v as LetterBasis | null;
  return !!b && typeof b === 'object' && !!b.fields && !!b.facts && !!b.system;
}

/**
 * For an invoice generated before letters froze their basis: the figures and
 * facts worked out from the invoice row itself. The app-worded paragraph is
 * left out — its wording depends on figures the old invoice didn't keep.
 */
export function basisFromInvoice(inv: BillingEmailInvoice, today = manilaToday()): LetterBasis {
  const money = (n: number) => letterMoney(n);
  const bs = (inv.billing_settings ?? {}) as Record<string, unknown>;
  const bill = invoiceGrossDue(inv);
  const prev = Number(bs.previousBalance ?? 0) || 0;
  const remit = roundMoney(invoiceGrossDue(inv) + Math.max(0, prev));
  const offer = readEarlyPaymentOffer(bs);
  const offered = !!offer && offer.amount < remit;
  const due = typeof bs.dueDate === 'string' && isCalendarDay(bs.dueDate) ? bs.dueDate : addDays(today, 7);
  const text = (k: string) => (typeof bs[k] === 'string' ? (bs[k] as string) : '');
  return {
    fields: {
      clientName: inv.client_name,
      period: invoicePeriodDisplay({ billing_month: inv.billing_month, billing_settings: bs }),
      engagementDate: normalizeLetterDate(text('engagementDate')),
      invoiceNumber: inv.invoice_number,
      total: money(bill),
      totalWithBalance: money(roundMoney(bill + prev)),
      previousBalance: prev > 0.005 ? money(prev) : '',
      previousCredit: prev < -0.005 ? money(-prev) : '',
      previousBalanceLabel: text('previousBalanceLabel'),
      feesDescription: Number(inv.total_expenses ?? 0) > 0.005 ? 'legal fees and out-of-pocket expenses' : 'legal fees',
      vatPhrase: bs.includeVAT === true || bs.includeVAT === 'true' ? ', including value-added tax (VAT),' : '',
      actualHoursAmount: '',
      retainerHoursCap: '',
      retainerCap: '',
      amountToRemit: money(remit),
      bankName: text('bankName'),
      bankAccountNo: text('bankAccountNo'),
      bankAccountName: text('bankAccountName'),
      dueDate: normalizeLetterDate(due),
      discountPercent: offered ? String(offer!.percent) : '',
      discountAmount: offered ? money(offer!.amount) : '',
      discountedAmount: offered ? money(roundMoney(remit - offer!.amount)) : '',
      discountDeadline: offered ? normalizeLetterDate(offer!.deadline) : '',
      discountVatNote: offered && (bs.includeVAT === true || bs.includeVAT === 'true') ? 'inclusive of VAT' : '',
    },
    facts: {
      vat: bs.includeVAT === true || bs.includeVAT === 'true',
      expenses: Number(inv.total_expenses ?? 0) > 0.005,
      previousBalance: prev > 0.005,
      advanceCredit: prev < -0.005,
      overCap: false,
      lessenFees: false,
      initialStatement: bs.initialStatement === true,
      moneyOnHand: false,
      payable: remit > 0.005,
      bankDetails: !!text('bankAccountNo').trim(),
      discount: offered,
    },
    system: { deposit: '' },
  };
}

/** The basis the invoice's letter froze, or one worked out from the invoice. */
export function emailBasis(inv: BillingEmailInvoice, today = manilaToday()): LetterBasis {
  const frozen = (inv.billing_settings as Record<string, unknown> | null | undefined)?.letterBasis;
  return isBasis(frozen) ? frozen : basisFromInvoice(inv, today);
}

/**
 * The billing email for one invoice, in the firm's current wording and the
 * branded frame. Pure, so the Billing Letter page previews exactly what Send
 * delivers.
 */
export function renderBillingEmail(
  inv: BillingEmailInvoice,
  opts: { paragraphs?: BillingParagraph[]; subject?: string; brand: EmailBrand; today?: string; basis?: LetterBasis },
): { subject: string; html: string } {
  const basis = opts.basis ?? emailBasis(inv, opts.today ?? manilaToday());
  const bs = (inv.billing_settings ?? {}) as Record<string, unknown>;
  const chosen = Array.isArray(bs.optionalParagraphs) ? (bs.optionalParagraphs as string[]) : [];
  // The firm's name signs the email; an invoice's frozen fields predate it.
  const fields = { firmName: opts.brand.firmName, ...basis.fields };
  const html = Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, escapeHtml(v)]));
  const parts: string[] = [];
  for (const p of opts.paragraphs ?? defaultEmailParagraphs()) {
    if (!paragraphShows(p, basis.facts, chosen)) continue;
    if (p.system) {
      const text = basis.system[p.system];
      if (text) parts.push(markupToHtml(text));
      continue;
    }
    const filled = fillWording(p.body, html);
    if (filled.replace(/<[^>]+>/g, '').trim()) parts.push(filled);
  }
  const inner = `
      ${styleLetterHtml(parts.join(''))}

      <div style="border-top:1px solid #e5e7eb;margin:24px 0 16px 0"></div>
      <p style="font-size:12px;color:#6b7280;margin:0;line-height:1.6">Invoice ${escapeHtml(basis.fields.invoiceNumber ?? inv.invoice_number)}. The billing letter and its breakdown are attached.</p>`;
  return {
    subject: fillWording(opts.subject ?? EMAIL_BLOCKS[0].body, fields).replace(/\s+/g, ' ').trim(),
    html: wrapBrandedEmail({ inner, brand: opts.brand, audience: 'client' }),
  };
}
