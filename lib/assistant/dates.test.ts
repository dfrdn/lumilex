import { describe, it, expect } from 'vitest';
import { manilaDate, manilaToday, weekRange, monthRange, resolveRange } from './dates';

// A fixed instant: 2026-06-30T20:00:00Z == 2026-07-01T04:00 Manila (next day).
const lateNightUTC = new Date('2026-06-30T20:00:00Z');
// 2026-06-30T02:00:00Z == 2026-06-30T10:00 Manila (same day).
const morningUTC = new Date('2026-06-30T02:00:00Z');

describe('manilaDate / manilaToday', () => {
  it('rolls to the next Manila day when UTC is still on the prior evening', () => {
    expect(manilaToday(lateNightUTC)).toBe('2026-07-01');
  });

  it('stays on the same day for a Manila morning', () => {
    expect(manilaToday(morningUTC)).toBe('2026-06-30');
  });

  it('applies a positive day offset', () => {
    expect(manilaDate(1, morningUTC)).toBe('2026-07-01');
  });

  it('applies a negative day offset across a month boundary', () => {
    expect(manilaDate(-1, morningUTC)).toBe('2026-06-29');
  });
});

describe('weekRange', () => {
  it('returns Monday–Sunday of the current Manila week', () => {
    // 2026-06-30 (Manila) is a Tuesday → week is Mon 29 Jun … Sun 5 Jul.
    expect(weekRange(0, morningUTC)).toEqual({ start: '2026-06-29', end: '2026-07-05' });
  });

  it('returns the following week for a +7 offset', () => {
    expect(weekRange(7, morningUTC)).toEqual({ start: '2026-07-06', end: '2026-07-12' });
  });

  it('treats Sunday as the end of its week, not the start', () => {
    // 2026-07-05 is a Sunday.
    const sunday = new Date('2026-07-05T02:00:00Z');
    expect(weekRange(0, sunday)).toEqual({ start: '2026-06-29', end: '2026-07-05' });
  });
});

describe('monthRange', () => {
  it('spans the first to last day of the Manila month', () => {
    expect(monthRange(morningUTC)).toEqual({ start: '2026-06-01', end: '2026-06-30' });
  });

  it('uses the Manila month even when UTC is in the prior month', () => {
    expect(monthRange(lateNightUTC)).toEqual({ start: '2026-07-01', end: '2026-07-31' });
  });
});

describe('resolveRange', () => {
  it('prefers explicit start + end over any preset', () => {
    expect(resolveRange('this_week', '2026-01-01', '2026-01-15', morningUTC)).toEqual({
      start: '2026-01-01',
      end: '2026-01-15',
    });
  });

  it('defaults to today when nothing is provided', () => {
    expect(resolveRange(undefined, undefined, undefined, morningUTC)).toEqual({
      start: '2026-06-30',
      end: '2026-06-30',
    });
  });

  it('resolves tomorrow', () => {
    expect(resolveRange('tomorrow', undefined, undefined, morningUTC)).toEqual({
      start: '2026-07-01',
      end: '2026-07-01',
    });
  });
});
