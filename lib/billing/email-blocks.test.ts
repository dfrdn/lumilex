import { describe, expect, it } from 'vitest';
import { defaultEmailParagraphs, renderBillingEmail, type BillingEmailInvoice } from './email-blocks';
import { DEFAULT_LETTER_PARAGRAPHS } from './paragraphs';

const base: BillingEmailInvoice = {
  invoice_number: 'INV-2026-09-001',
  client_name: 'Acme & Sons',
  billing_month: '2026-09',
  total_amount: 40_000,
  total_expenses: 0,
  billing_settings: { includeVAT: false, dueDate: '2026-10-24', bankName: 'Sample Bank', bankAccountNo: '000123456789', bankAccountName: 'Sample Law Offices' },
};
const brand = { firmName: 'Sample Law Offices', logoUrl: 'https://example.test/brand/logo-light' };
const send = (inv: Partial<BillingEmailInvoice> & { settings?: Record<string, unknown> } = {}) =>
  renderBillingEmail({ ...base, ...inv, billing_settings: { ...base.billing_settings, ...inv.settings } }, { brand, today: '2026-10-17' });
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

describe('defaultEmailParagraphs', () => {
  it('says what the letter says, between a greeting and a sign-off', () => {
    const keys = defaultEmailParagraphs().map((p) => p.key);
    expect(keys).toEqual(['greeting', ...DEFAULT_LETTER_PARAGRAPHS.map((p) => p.key), 'signoff']);
  });
});

describe('renderBillingEmail', () => {
  it('states the bill and the due date, in the branded frame', () => {
    const e = send();
    expect(e.subject).toBe('Billing Statement – September 2026 | Acme & Sons');
    const t = text(e.html);
    expect(t).toContain('Good day,');
    expect(t).toContain('for September 2026 amount to P40,000.00.');
    expect(t).toContain('on or before 24 October 2026');
    expect(e.html).toContain('https://example.test/brand/logo-light');
    expect(t).toContain('Best regards, Sample Law Offices Finance Department');
  });

  it('names the carried balance only when the client owes one', () => {
    expect(text(send({ settings: { previousBalance: 10_000 } }).html)).toContain('amounting to P10,000.00, your current bill now amounts to P50,000.00');
    expect(text(send({ settings: { previousBalance: -5_000 } }).html)).not.toContain('In addition to your previous');
  });

  it('offers the discount only when the invoice has one', () => {
    expect(text(send().html)).not.toContain('discount');
    const t = text(send({ settings: { previousBalance: 10_000, earlyPayment: { percent: 5, amount: 2_000, deadline: '2026-10-22' } } }).html);
    expect(t).toContain('on or before 22 October 2026, we are pleased to extend a discount of 5%');
    expect(t).toContain('P48,000.00');
  });

  it('writes the paragraphs finance keeps, and escapes what it fills in', () => {
    const paragraphs = defaultEmailParagraphs().filter((p) => p.key !== 'bill').map((p) =>
      p.key === 'closing' ? { ...p, body: '<p>Call us about {{invoiceNumber}}, {{clientName}}.</p>' } : p);
    const e = renderBillingEmail(base, { paragraphs, brand, today: '2026-10-17' });
    expect(text(e.html)).toContain('Call us about INV-2026-09-001, Acme & Sons.');
    expect(text(e.html)).not.toContain('Based on the terms');
    expect(e.html).toContain('Acme &amp; Sons');
  });

  it('reads the figures the letter froze when it has them', () => {
    const basis = {
      fields: { invoiceNumber: 'X-1', clientName: 'Frozen Co', period: 'August 2026', total: 'P1.00', feesDescription: 'legal fees', vatPhrase: '', dueDate: '1 September 2026', bankName: 'B', bankAccountNo: '1', bankAccountName: 'N' },
      facts: { ...Object.fromEntries(['vat', 'expenses', 'previousBalance', 'advanceCredit', 'overCap', 'lessenFees', 'initialStatement', 'moneyOnHand', 'discount'].map((k) => [k, false])), payable: true, bankDetails: true },
      system: { deposit: '' },
    };
    const t = text(send({ settings: { letterBasis: basis } }).html);
    expect(t).toContain('for August 2026 amount to P1.00.');
  });
});
