import { describe, it, expect } from 'vitest';
import { formatProposalDate } from './types';

describe('formatProposalDate', () => {
  it('writes day-month-year, not the American order', () => {
    expect(formatProposalDate('2026-07-22')).toBe('22 July 2026');
  });

  it('drops the leading zero from single-digit days', () => {
    expect(formatProposalDate('2026-01-05')).toBe('5 January 2026');
  });

  it('handles December, the last month index', () => {
    expect(formatProposalDate('2026-12-31')).toBe('31 December 2026');
  });

  it('is stable regardless of the runtime timezone', () => {
    // A Date-based implementation shifts the day backwards west of UTC; the
    // firm is in Asia/Manila and the letter date must not drift.
    const original = process.env.TZ;
    try {
      process.env.TZ = 'America/Los_Angeles';
      expect(formatProposalDate('2026-07-22')).toBe('22 July 2026');
      process.env.TZ = 'Pacific/Kiritimati';
      expect(formatProposalDate('2026-07-22')).toBe('22 July 2026');
    } finally {
      process.env.TZ = original;
    }
  });

  it('returns anything unparseable unchanged rather than inventing a date', () => {
    expect(formatProposalDate('')).toBe('');
    expect(formatProposalDate('22 July 2026')).toBe('22 July 2026');
    expect(formatProposalDate('2026-13-01')).toBe('2026-13-01');
  });
});
