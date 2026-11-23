import { describe, it, expect } from 'vitest';
import { computeTotalLegalFees, feeLineUnits, type BillingBreakdownPdfParams } from '@/lib/pdf/billing-breakdown';
import type { LawyerBlock } from '@/lib/billing/breakdown-types';

// Minimal params factory — only the fields computeTotalLegalFees reads matter.
function params(over: Partial<BillingBreakdownPdfParams>): BillingBreakdownPdfParams {
  return {
    firmAddress: '',
    firmAddress2: '',
    firmTIN: '',
    billingPeriod: 'June 2026',
    monthlyRetainer: 0,
    withinRetainer: [],
    beyondRetainer: [],
    expenses: [],
    includeVAT: false,
    ...over,
  };
}

const block = (name: string, hours: number, rate: number): LawyerBlock => ({
  name,
  entries: [{ date: '2026-06-01', hours, description: 'work', hourlyRate: rate, waived: false }],
});

describe('computeTotalLegalFees — retainer absorption is driven by the hours cap', () => {
  // Regression: a client on a flat monthly retainer, NO hours cap. Every
  // billable hour must be charged on top of the retainer, not absorbed by it.
  it('flat monthly retainer with no cap bills all hours on top', () => {
    const total = computeTotalLegalFees(params({
      monthlyRetainer: 20000,
      retainerHoursCap: null,
      // No cap → cap-split dumps everything into `within`, `beyond` empty.
      withinRetainer: [
        block('Reyes', 19.2, 4500),  // 86,400
        block('Santos', 10.7, 5500), // 58,850
        block('Mendoza', 4.1, 4000),    // 16,400
        block('Villanueva', 1.5, 5500),  // 8,250
      ],
      beyondRetainer: [],
    }));
    // 20,000 retainer + 169,900 hours = 189,900 (NOT 20,000).
    expect(total).toBe(189900);
  });

  it('retainer WITH an hours cap absorbs within-cap hours and charges only beyond', () => {
    const total = computeTotalLegalFees(params({
      monthlyRetainer: 25000,
      retainerHoursCap: 10,
      withinRetainer: [block('Senior', 10, 5000)], // absorbed
      beyondRetainer: [block('Senior', 3, 5000)],  // 15,000 charged
    }));
    expect(total).toBe(25000 + 15000);
  });

  // Regression for the review finding: an hours cap with NO monthly retainer
  // must not absorb hours into a ₱0 retainer — every hour is charged.
  it('hours cap with no monthly retainer charges every hour (no free absorption)', () => {
    const total = computeTotalLegalFees(params({
      monthlyRetainer: 0,
      retainerHoursCap: 10,
      withinRetainer: [block('Senior', 10, 5000)], // 50,000 — must NOT be absorbed
      beyondRetainer: [block('Senior', 3, 5000)],  // 15,000
    }));
    expect(total).toBe(65000);
  });

  it('no retainer at all charges every hour (within is the full billable set)', () => {
    const total = computeTotalLegalFees(params({
      monthlyRetainer: 0,
      retainerHoursCap: null,
      withinRetainer: [block('Assoc', 5, 4000)], // 20,000
      beyondRetainer: [],
    }));
    expect(total).toBe(20000);
  });

  it('waived entries never count toward the total', () => {
    const waivedBlock: LawyerBlock = {
      name: 'Assoc',
      entries: [{ date: '2026-06-01', hours: 5, description: 'goodwill', hourlyRate: 4000, waived: true }],
    };
    const total = computeTotalLegalFees(params({
      monthlyRetainer: 20000,
      retainerHoursCap: null,
      withinRetainer: [waivedBlock],
      beyondRetainer: [],
    }));
    expect(total).toBe(20000); // retainer only; waived hours = ₱0
  });
});

describe('feeLineUnits — the count and unit rate behind an aggregated fee row', () => {
  const units = (row: { description: string; amount: number; quantity?: number }) =>
    feeLineUnits(row, '₱');

  it('spells out count × unit rate for a per-action aggregate', () => {
    // The reported case: 14 notarial acts at ₱1,500 printed as one ₱21,000 row.
    expect(units({ description: 'Notarial acknowledgment and jurat', amount: 21000, quantity: 14 }))
      .toEqual({ description: 'Notarial acknowledgment and jurat', unitDetail: '14 × ₱1,500.00' });
  });

  it('leaves rows with no quantity exactly as they are', () => {
    expect(units({ description: 'Fixed Fee', amount: 350000 }))
      .toEqual({ description: 'Fixed Fee', unitDetail: null });
    expect(units({ description: 'Fixed Fee', amount: 350000, quantity: 0 }).unitDetail).toBeNull();
  });

  it("drops the description's own × N once the unit line prints the count", () => {
    // deriveFeeLines' own format — the count must print once, not twice.
    expect(units({ description: 'Court Appearance (appearance) × 3', amount: 15000, quantity: 3 }))
      .toEqual({ description: 'Court Appearance (appearance)', unitDetail: '3 × ₱5,000.00' });
  });

  it('keeps a trailing marker that says more than the count', () => {
    const r = units({ description: 'Court Appearance (appearance) × 3 of 4 cap', amount: 15000, quantity: 3 });
    expect(r.description).toBe('Court Appearance (appearance) × 3 of 4 cap');
    expect(r.unitDetail).toBe('3 × ₱5,000.00');
  });

  it('keeps a trailing × N that is not this row’s quantity', () => {
    const r = units({ description: 'Sets of exhibits × 4', amount: 15000, quantity: 3 });
    expect(r.description).toBe('Sets of exhibits × 4');
  });

  it('shows the count alone when the amount does not divide into a clean rate', () => {
    // A discounted/edited amount: ₱1,000 ÷ 3 has no rate that multiplies back,
    // so no unit rate is printed beside it.
    expect(units({ description: 'Notarial acts', amount: 1000, quantity: 3 }).unitDetail).toBe('× 3');
  });

  it('shows the count alone rather than a ₱0 rate on a zero-amount row', () => {
    expect(units({ description: 'Waived acts', amount: 0, quantity: 5 }).unitDetail).toBe('× 5');
  });

  it('prints centavo rates that do reconcile', () => {
    expect(units({ description: 'Pages', amount: 4501.5, quantity: 3 }).unitDetail).toBe('3 × ₱1,500.50');
  });

  it('groups the digits of a large count', () => {
    expect(units({ description: 'Pages', amount: 6000, quantity: 1200 }).unitDetail).toBe('1,200 × ₱5.00');
  });
});
