import { afterEach, describe, expect, it, vi } from 'vitest';
import { daysFromToday } from './list-cards';

afterEach(() => vi.useRealTimers());

describe('daysFromToday', () => {
  it('counts Manila days, not UTC ones', () => {
    // 01:30 on 12 Oct in Manila is still 11 Oct in UTC.
    const now = new Date('2026-10-11T17:30:00Z');
    expect(daysFromToday('2026-10-12T01:00:00Z', now)).toBe(0);
    expect(daysFromToday('2026-10-12', now)).toBe(0);
    expect(daysFromToday('2026-10-11', now)).toBe(-1);
    expect(daysFromToday('2026-10-19T02:00:00Z', now)).toBe(7);
  });
  it('is null without a date', () => {
    expect(daysFromToday(null)).toBeNull();
  });
});
