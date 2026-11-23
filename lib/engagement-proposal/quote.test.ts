import { describe, it, expect } from 'vitest';
import { checkQuote, customRetainerFigures, litigationFiguresFor, retainerFiguresFor } from './quote';
import type { ProfessionalBody } from '@/lib/fee-schedule/types';
import type { ProposalQuote } from './types';

const body: ProfessionalBody = {
  kind: 'professional',
  intro: '',
  retainer: {
    heading: 'Monthly Retainer Fees',
    paragraphs: [],
    initialFeeMonths: 6,
    tiers: [
      { label: 'Tier I', hours: 3, monthlyFee: 10000, discountPct: 10 },
      { label: 'Tier II', hours: 6, monthlyFee: 15000, discountPct: 15 },
      { label: 'Tier III', hours: 10, monthlyFee: 20000, discountPct: 20 },
      { label: 'Custom', hours: null, monthlyFee: null, discountPct: null, note: 'Subject to negotiation' },
    ],
  },
  hourly: { heading: 'Hourly Rates', paragraphs: [], rates: [{ position: 'Partner', standard: 5500 }] },
  acceptance: { heading: 'Acceptance Fees', paragraphs: [], fees: [{ matter: 'Civil cases', standard: 400000 }] },
};

const tierII: ProposalQuote = {
  arrangement: 'retainer',
  tierLabel: 'Tier II',
  monthlyFee: 15000,
  retainerHours: 6,
  initialFeeMonths: 6,
  initialFee: 90000,
};

describe('checkQuote', () => {
  it('passes a quote that matches the schedule', () => {
    expect(checkQuote(tierII, body)).toEqual([]);
  });

  it('returns nothing when there is no quote to check', () => {
    expect(checkQuote(undefined, body)).toEqual([]);
  });

  it('errors when the named tier is not in the schedule', () => {
    const issues = checkQuote({ ...tierII, tierLabel: 'Tier IV' }, body);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ field: 'tierLabel', severity: 'error' });
    expect(issues[0].message).toContain('Tier I, Tier II, Tier III');
  });

  it('matches the tier label case-insensitively', () => {
    expect(checkQuote({ ...tierII, tierLabel: 'tier ii' }, body)).toEqual([]);
  });

  it('warns — not errors — when the monthly fee departs from the schedule', () => {
    const issues = checkQuote({ ...tierII, monthlyFee: 12000, initialFee: 72000 }, body);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ field: 'monthlyFee', severity: 'warning' });
    expect(issues[0].message).toContain('P12,000.00');
    expect(issues[0].message).toContain('P15,000.00');
  });

  it('warns when the retainer hours depart from the tier', () => {
    const issues = checkQuote({ ...tierII, retainerHours: 8 }, body);
    expect(issues.map((i) => i.field)).toEqual(['retainerHours']);
  });

  it('errors when the initial fee does not equal months times the monthly fee', () => {
    const issues = checkQuote({ ...tierII, initialFee: 75000 }, body);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ field: 'initialFee', severity: 'error' });
    expect(issues[0].message).toContain('P90,000.00');
  });

  it('flags an off-schedule initial-fee multiplier separately from the arithmetic', () => {
    const issues = checkQuote({ ...tierII, initialFeeMonths: 3, initialFee: 45000 }, body);
    // The arithmetic is self-consistent, so only the departure is reported.
    expect(issues.map((i) => i.field)).toEqual(['initialFeeMonths']);
  });

  it('warns when no tier is named at all', () => {
    const issues = checkQuote({ arrangement: 'retainer' }, body);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ field: 'tierLabel', severity: 'warning' });
  });

  it('still checks its own arithmetic when no schedule is available', () => {
    const issues = checkQuote({ ...tierII, initialFee: 1 }, null);
    expect(issues.map((i) => i.field)).toContain('initialFee');
  });

  it('errors when a completion fee is not the stated percentage of the value', () => {
    const issues = checkQuote(
      { arrangement: 'acceptance_completion', completionFeePct: 1.5, transactionValue: 55_296_473.21, completionFee: 800_000 },
      body,
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ field: 'completionFee', severity: 'error' });
    expect(issues[0].message).toContain('P829,447.10');
  });

  it('accepts a correctly computed completion fee', () => {
    const issues = checkQuote(
      { arrangement: 'acceptance_completion', completionFeePct: 1.5, transactionValue: 55_296_473.21, completionFee: 829_447.098 },
      body,
    );
    expect(issues).toEqual([]);
  });

  it('warns when a percentage completion fee has no transaction value to compute from', () => {
    const issues = checkQuote({ arrangement: 'acceptance_completion', completionFeePct: 1.5 }, body);
    expect(issues.map((i) => i.field)).toEqual(['transactionValue']);
  });
});

describe('retainerFiguresFor', () => {
  it('derives the monthly fee, hours, and initial fee from the tier', () => {
    expect(retainerFiguresFor(body, 'Tier III')).toEqual({
      arrangement: 'retainer',
      tierLabel: 'Tier III',
      monthlyFee: 20000,
      retainerHours: 10,
      initialFeeMonths: 6,
      initialFee: 120000,
    });
  });

  it('returns null for a tier with no price', () => {
    expect(retainerFiguresFor(body, 'Custom')).toBeNull();
  });

  it('returns null for a tier that does not exist', () => {
    expect(retainerFiguresFor(body, 'Tier IX')).toBeNull();
  });

  it('produces figures the checker then accepts', () => {
    const quote = retainerFiguresFor(body, 'Tier I');
    expect(checkQuote(quote!, body)).toEqual([]);
  });
});

describe('customRetainerFigures', () => {
  it('takes the drafter figures for a tier the schedule leaves to negotiation', () => {
    // The Brand Soluxions proposal was a Custom tier at 12.5 hours a month —
    // a figure the schedule has no row for, agreed by the drafter.
    expect(customRetainerFigures('Custom', { retainerHours: 12.5, monthlyFee: 25000 }, 6)).toEqual({
      arrangement: 'retainer',
      tierLabel: 'Custom',
      monthlyFee: 25000,
      retainerHours: 12.5,
      initialFeeMonths: 6,
      initialFee: 150000,
    });
  });

  it('accepts hours alone, leaving the fee to the drafted prose', () => {
    expect(customRetainerFigures('Custom', { retainerHours: 12.5 }, 6)).toEqual({
      arrangement: 'retainer',
      tierLabel: 'Custom',
      retainerHours: 12.5,
      initialFeeMonths: 6,
    });
  });

  it('prefers an initial-fee multiplier the drafter set over the schedule default', () => {
    const quote = customRetainerFigures('Custom', { monthlyFee: 20000, initialFeeMonths: 3 }, 6);
    expect(quote?.initialFeeMonths).toBe(3);
    expect(quote?.initialFee).toBe(60000);
  });

  it('is null when the drafter supplied nothing', () => {
    expect(customRetainerFigures('Custom', {}, 6)).toBeNull();
  });

  it('produces a quote the checker does not contradict', () => {
    const quote = customRetainerFigures('Custom', { retainerHours: 12.5, monthlyFee: 25000 }, 6);
    expect(checkQuote(quote!, body).filter((i) => i.severity === 'error')).toEqual([]);
  });
});

describe('litigationFiguresFor', () => {
  it('takes the acceptance fee for the case type from the schedule', () => {
    expect(litigationFiguresFor(body, 'Civil cases')).toEqual({
      arrangement: 'litigation',
      caseType: 'Civil cases',
      acceptanceFee: 400000,
    });
  });

  it('matches the case type case-insensitively and prints the schedule spelling', () => {
    expect(litigationFiguresFor(body, 'civil CASES')?.caseType).toBe('Civil cases');
  });

  it('is null for a matter the schedule does not price', () => {
    expect(litigationFiguresFor(body, 'Maritime salvage')).toBeNull();
  });

  it('produces a quote the checker does not contradict', () => {
    expect(checkQuote(litigationFiguresFor(body, 'Civil cases')!, body)).toEqual([]);
  });
});

describe('checkQuote — litigation', () => {
  const litigation: ProposalQuote = {
    arrangement: 'litigation',
    caseType: 'Civil cases',
    acceptanceFee: 400000,
  };

  it('errors when the case type is not one the schedule prices', () => {
    const issues = checkQuote({ ...litigation, caseType: 'Space cases' }, body);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ field: 'caseType', severity: 'error' });
  });

  it('warns when the acceptance fee departs from the schedule', () => {
    const issues = checkQuote({ ...litigation, acceptanceFee: 250000 }, body);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ field: 'acceptanceFee', severity: 'warning' });
  });

  it('warns when no case type is named at all', () => {
    const issues = checkQuote({ arrangement: 'litigation' }, body);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ field: 'caseType', severity: 'warning' });
  });

  it('checks the completion-fee arithmetic the same way as a transaction', () => {
    const issues = checkQuote(
      { ...litigation, completionFeePct: 10, transactionValue: 5_000_000, completionFee: 400000 },
      body,
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ field: 'completionFee', severity: 'error' });
  });

  it('accepts a completion fee that matches its own percentage', () => {
    expect(checkQuote(
      { ...litigation, completionFeePct: 10, transactionValue: 5_000_000, completionFee: 500000 },
      body,
    )).toEqual([]);
  });

  it('speaks of the amount at stake, not a transaction value, when the pct has no base', () => {
    const issues = checkQuote({ ...litigation, completionFeePct: 10 }, body);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain('amount at stake');
  });
});
