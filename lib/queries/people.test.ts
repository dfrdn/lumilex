import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase', () => ({ getSupabase: () => ({}) }));

import { currentOnly, currentReviewers } from './people';

const current = new Set(['a', 'c']);

describe('currentOnly', () => {
  it('keeps current members in order and drops the rest', () => {
    expect(currentOnly(['c', 'x', 'a'], current)).toEqual(['c', 'a']);
    expect(currentOnly(null, current)).toEqual([]);
  });
});

describe('currentReviewers', () => {
  it("drops a former reviewer together with their review date", () => {
    expect(currentReviewers(['a', 'x', 'c'], ['2026-01-01', '2026-01-02', null], current)).toEqual({
      reviewerIds: ['a', 'c'],
      reviewDates: ['2026-01-01', null],
    });
  });

  it('keeps a chain stored with fewer dates than reviewers short', () => {
    expect(currentReviewers(['x', 'a', 'c'], ['2026-01-01'], current)).toEqual({ reviewerIds: ['a', 'c'], reviewDates: [] });
  });
});
