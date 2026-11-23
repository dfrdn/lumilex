import { describe, expect, it } from 'vitest';
import { formatDate, formatDateShort } from './format-date';

describe('formatDate', () => {
  it('writes day-month-year with the full month', () => {
    expect(formatDate('2026-10-01')).toBe('1 October 2026');
    expect(formatDate('2026-09-25')).toBe('25 September 2026');
  });

  it('reads the date part of a timestamp', () => {
    expect(formatDate('2026-03-07T12:00:00Z')).toBe('7 March 2026');
  });

  it('passes through anything that is not a date', () => {
    expect(formatDate('soon')).toBe('soon');
    expect(formatDate('2026-13-01')).toBe('2026-13-01');
  });
});

describe('formatDateShort', () => {
  it('abbreviates the month to three letters, September included', () => {
    expect(formatDateShort('2026-09-25')).toBe('25 Sep 2026');
    expect(formatDateShort('2026-10-01')).toBe('1 Oct 2026');
  });
});
