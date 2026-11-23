import { describe, expect, it } from 'vitest';
import { daysInSpan, daysWithoutTime, workWeek } from './my-time';

describe('workWeek', () => {
  it('is Monday to Friday', () => {
    expect(workWeek('2026-10-12')).toEqual(['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16']);
  });
});

describe('daysWithoutTime', () => {
  const week = '2026-10-12';

  it('lists past weekdays with no hours, never today or later', () => {
    expect(daysWithoutTime(week, '2026-10-14', { '2026-10-12': 7.5 }, new Set())).toEqual(['2026-10-13']);
  });

  it('skips holidays and leave', () => {
    expect(daysWithoutTime(week, '2026-10-17', { '2026-10-12': 8 }, new Set(['2026-10-13', '2026-10-16']))).toEqual([
      '2026-10-14',
      '2026-10-15',
    ]);
  });

  it('is empty on a Monday', () => {
    expect(daysWithoutTime(week, '2026-10-12', {}, new Set())).toEqual([]);
  });
});

describe('daysInSpan', () => {
  it('clips a leave to the week', () => {
    expect(daysInSpan('2026-10-09', '2026-10-13', '2026-10-12', '2026-10-16')).toEqual(['2026-10-12', '2026-10-13']);
  });

  it('is empty when the span is outside', () => {
    expect(daysInSpan('2026-10-01', '2026-10-02', '2026-10-12', '2026-10-16')).toEqual([]);
  });
});
