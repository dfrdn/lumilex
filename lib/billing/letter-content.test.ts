import { describe, expect, it } from 'vitest';
import { amountToRemit, billingLetterParagraphs, type BillingLetterParams } from './letter-content';
import { defaultParagraphs, letterWording } from './letter-blocks';
import type { BillingParagraph } from './paragraphs';

const base: BillingLetterParams = {
  date: '16 October 2026',
  invoiceNumber: 'INV-2026-09-001',
  clientName: 'Acme Corporation',
  clientAddress: '12 Ayala Avenue\nMakati City',
  attnName: 'Ms. Jane Doe',
  attnTitle: 'Chief Financial Officer',
  billingPeriod: 'September 2026',
  engagementDate: '2025-08-14',
  totalAmount: 120_000,
  totalExpenses: 5_000,
  includeVAT: false,
  bankName: 'Sample Bank',
  bankAccountNo: '000123456789',
  bankAccountName: 'Sample Law Offices',
  dueDate: '23 October 2026',
  signerName: 'Maria Clara L. Reyes',
  signerPosition: 'Managing Partner',
};

const text = (p: BillingLetterParams) => billingLetterParagraphs(p).map((x) => x.text).join('\n');

describe('billingLetterParagraphs', () => {
  it('states the plain bill with the engagement date', () => {
    const t = text(base);
    expect(t).toContain('our billing statement for September 2026 pursuant to our Engagement Agreement dated 14 August 2025.');
    expect(t).toContain('Based on the terms of our agreement, the total legal fees and out-of-pocket expenses incurred for our services for September 2026 amount to P120,000.00.');
    expect(t).not.toContain('value-added tax');
    expect(t).not.toContain('In addition to');
  });

  it('says VAT only when the bill carries it', () => {
    expect(text({ ...base, includeVAT: true })).toContain('out-of-pocket expenses, including value-added tax (VAT), incurred');
  });

  it('speaks of legal fees alone when there are no expenses', () => {
    expect(text({ ...base, totalExpenses: 0 })).toContain('the total legal fees incurred for our services');
  });

  it('adds the carried balance only when there is one, and bolds the new total', () => {
    const t = text({
      ...base,
      previousBalance: 50_000,
      previousBalanceLabel: 'outstanding balance for periods through 31 August 2026',
      totalWithBalance: 170_000,
    });
    expect(t).toContain('amount to P120,000.00.\nIn addition to your previous outstanding balance for periods through 31 August 2026 amounting to P50,000.00, your current bill now amounts to **P170,000.00**.');
  });

  it('describes an advance credit as a credit', () => {
    const t = text({ ...base, previousBalance: -20_000, previousBalanceLabel: 'advance deposit on file as of 30 September 2026', totalWithBalance: 100_000 });
    expect(t).toContain('After applying P20,000.00 (advance deposit on file as of 30 September 2026) from your advance deposit');
  });

  it('explains the retainer cap only when the hours were worth more than it', () => {
    const capped = { ...base, retainerCap: 20_000, retainerHoursCap: 10 };
    expect(text({ ...capped, actualHoursAmount: 35_000 })).toContain('could have amounted to P35,000.00');
    expect(text({ ...capped, actualHoursAmount: 35_000 })).toContain('In this connection, the total legal fees');
    expect(text({ ...capped, actualHoursAmount: 15_000 })).not.toContain('could have amounted');
  });

  it('addresses a company with an Attention line, and a person by name', () => {
    const company = billingLetterParagraphs(base);
    expect(company.find((p) => p.text === 'Acme Corporation')).toMatchObject({ bold: true, smallCaps: true });
    expect(company.some((p) => p.text === 'Attention: **Ms. Jane Doe**')).toBe(true);

    const person = billingLetterParagraphs({ ...base, addressee: 'person' });
    expect(person.find((p) => p.text === 'Ms. Jane Doe')).toMatchObject({ bold: true, smallCaps: true });
    expect(person.some((p) => p.text.startsWith('Attention'))).toBe(false);
  });

  it('opens as an initial statement when asked', () => {
    expect(text({ ...base, initialStatement: true })).toContain('our initial billing statement pursuant to our Engagement Agreement dated 14 August 2025.');
  });

  it('drops the engagement clause when the matter has no engagement date', () => {
    expect(text({ ...base, engagementDate: undefined })).toContain('our billing statement for September 2026.');
  });

  it('adds a client-choice paragraph only where it is ticked', () => {
    expect(text(base)).not.toContain('Acceptance Fee has not yet been billed');
    expect(text({ ...base, optionalParagraphs: ['deferred-acceptance-fee'] })).toContain(
      'amount to P120,000.00.\nPlease note that the Acceptance Fee has not yet been billed',
    );
  });

  it('writes a paragraph finance added, in its place and only when its conditions hold', () => {
    const own: BillingParagraph = {
      key: 'thanks', document: 'letter', label: 'Thanks', body: 'Thank you, {{clientName}}.\n\nWe value your trust.',
      rule: [{ fact: 'vat', is: true }], choice: null, system: null, sortOrder: 0, archived: false,
    };
    const list = defaultParagraphs('letter');
    list.splice(list.findIndex((p) => p.key === 'closing'), 0, own);
    const wording = letterWording([], list);
    expect(text({ ...base, wording })).not.toContain('Thank you');
    expect(text({ ...base, includeVAT: true, wording })).toContain('Thank you, Acme Corporation.\nWe value your trust.\nShould you have any questions');
  });

  it('writes in the wording finance saved', () => {
    const list = defaultParagraphs('letter').map((p) => (p.key === 'closing' ? { ...p, body: 'Call us about **{{invoiceNumber}}** any time.' } : p));
    const wording = letterWording([{ key: 'phrase_vat', kind: 'standard', body: ', VAT included,' }], list);
    const t = text({ ...base, includeVAT: true, wording });
    expect(t).toContain('Call us about **INV-2026-09-001** any time.');
    expect(t).toContain('out-of-pocket expenses, VAT included, incurred');
  });

  it('states the early-payment discount and the reduced amount to remit', () => {
    const t = text({ ...base, earlyPayment: { percent: 5, amount: 5_750, deadline: '2026-10-21' } });
    expect(t).toContain('on or before 21 October 2026, we are pleased to extend a discount of 5% on this month\'s legal fees, or P5,750.00, which reduces the amount to be remitted to **P114,250.00**.');
  });

  it('asks for no payment, and offers no discount, when the deposit covers the bill', () => {
    const covered = {
      ...base,
      depositOnHand: 200_000,
      depositApplied: 120_000,
      depositRemaining: 80_000,
      netAmountDue: 0,
      earlyPayment: { percent: 5, amount: 5_750, deadline: '2026-10-21' },
    };
    expect(amountToRemit(covered)).toBe(0);
    const t = text(covered);
    expect(t).not.toContain('Please transfer');
    expect(t).not.toContain('discount');
  });

  it('keeps emphasis markup in a client name from bolding the line', () => {
    expect(text({ ...base, clientName: 'Star*Corp' })).toContain('StarCorp');
  });

  it('ends the salutation with a colon, whether or not the matter stored one', () => {
    expect(text({ ...base, salutation: 'Dear Ms. Doe' })).toContain('\nDear Ms. Doe:\n');
    expect(text({ ...base, salutation: 'Dear Ms. Doe:' })).toContain('\nDear Ms. Doe:\n');
    expect(text(base)).toContain('\nGentlemen/Mesdames:\n');
  });

  it('signs off in the house style', () => {
    const paras = billingLetterParagraphs(base);
    const i = paras.findIndex((p) => p.text === 'Very truly yours,');
    expect(paras.slice(i).map((p) => p.text)).toEqual(['Very truly yours,', 'For the Firm:', 'Maria Clara L. Reyes', 'Managing Partner']);
  });
});

describe('the closing', () => {
  it('keeps the last paragraph, sign-off, name and position on one page', () => {
    const paras = billingLetterParagraphs(base);
    const i = paras.findIndex((p) => p.text === 'Very truly yours,');
    expect(paras.slice(i - 1, -1).every((p) => p.keepNext)).toBe(true);
    expect(paras[paras.length - 1].keepNext).toBeFalsy();
  });
});

describe('the signatory', () => {
  it('writes "Atty." before the name only when the firm asks, and never twice', () => {
    const name = (p: Partial<BillingLetterParams>) => billingLetterParagraphs({ ...base, ...p }).find((x) => x.smallCaps && /Reyes/.test(x.text))?.text;
    expect(name({})).toBe('Maria Clara L. Reyes');
    expect(name({ signerAtty: true })).toBe('Atty. Maria Clara L. Reyes');
    expect(name({ signerAtty: true, signerName: 'Atty. Maria Clara L. Reyes' })).toBe('Atty. Maria Clara L. Reyes');
  });
});
