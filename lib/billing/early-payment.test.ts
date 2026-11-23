import { describe, expect, it } from 'vitest';
import {
  computeEarlyPaymentOffer,
  earlyPaymentCreditAmount,
  earnsEarlyPaymentDiscount,
  readEarlyPaymentOffer,
  type EarlyPaymentRow,
} from './early-payment';

const base = {
  percent: '5',
  days: '5',
  legalFees: 100_000,
  includeVAT: false,
  letterDate: '2026-10-16',
  dueDate: '2026-10-23',
  settledFromDeposit: false,
};

describe('computeEarlyPaymentOffer', () => {
  it('takes the percent off the legal fees, by the letter date plus the days', () => {
    expect(computeEarlyPaymentOffer(base)).toEqual({ percent: 5, amount: 5_000, deadline: '2026-10-21' });
  });

  it('discounts the VAT on those fees too when the bill carries VAT', () => {
    expect(computeEarlyPaymentOffer({ ...base, includeVAT: true })?.amount).toBe(5_600);
  });

  it('never sets the deadline past the due date', () => {
    expect(computeEarlyPaymentOffer({ ...base, days: '30' })?.deadline).toBe('2026-10-23');
  });

  it('makes no offer without a percent, without days, without fees, or on a bill settled from deposit', () => {
    expect(computeEarlyPaymentOffer({ ...base, percent: '' })).toBeNull();
    expect(computeEarlyPaymentOffer({ ...base, days: '0' })).toBeNull();
    expect(computeEarlyPaymentOffer({ ...base, legalFees: 0 })).toBeNull();
    expect(computeEarlyPaymentOffer({ ...base, settledFromDeposit: true })).toBeNull();
  });
});

describe('readEarlyPaymentOffer', () => {
  it('reads a frozen offer and rejects a malformed one', () => {
    expect(readEarlyPaymentOffer({ earlyPayment: { percent: 5, amount: 5000, deadline: '2026-10-21' } }))
      .toEqual({ percent: 5, amount: 5000, deadline: '2026-10-21' });
    expect(readEarlyPaymentOffer({ earlyPayment: { percent: 5, amount: 5000, deadline: '21 October' } })).toBeNull();
    expect(readEarlyPaymentOffer({})).toBeNull();
    expect(readEarlyPaymentOffer(null)).toBeNull();
  });
});

describe('earning the discount', () => {
  const offer = { percent: 5, amount: 5_000, deadline: '2026-10-21' };
  const ref = 'EPD-7';
  const pay = (amount: number, payment_date: string, extra: Partial<EarlyPaymentRow> = {}): EarlyPaymentRow => ({
    amount, payment_date, payment_method: 'bank_transfer', reference_number: '', ...extra,
  });

  it('is earned by paying the discounted figure on or before the deadline', () => {
    expect(earnsEarlyPaymentDiscount(offer, 120_000, [pay(115_000, '2026-10-21')], ref)).toBe(true);
  });

  it('counts only what was paid in time', () => {
    expect(earnsEarlyPaymentDiscount(offer, 120_000, [pay(60_000, '2026-10-20'), pay(55_000, '2026-10-22')], ref)).toBe(false);
  });

  it('is not earned by a short payment', () => {
    expect(earnsEarlyPaymentDiscount(offer, 120_000, [pay(114_000, '2026-10-18')], ref)).toBe(false);
  });

  it('never counts its own credit toward earning itself', () => {
    const rows = [pay(110_000, '2026-10-18'), pay(5_000, '2026-10-18', { payment_method: 'credit', reference_number: ref })];
    expect(earnsEarlyPaymentDiscount(offer, 120_000, rows, ref)).toBe(false);
  });

  it('credits the offer, but no more than is still open', () => {
    expect(earlyPaymentCreditAmount(offer, 120_000, [pay(115_000, '2026-10-18')], ref)).toBe(5_000);
    expect(earlyPaymentCreditAmount(offer, 120_000, [pay(118_000, '2026-10-18')], ref)).toBe(2_000);
    expect(earlyPaymentCreditAmount(offer, 120_000, [pay(120_000, '2026-10-18')], ref)).toBe(0);
  });
});
