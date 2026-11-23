import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  toManilaDay,
  toManilaInstant,
  toManilaWallClock,
  isManilaMidnight,
  isDateOnly,
  utcCalendarDay,
  addMonths,
  addYears,
  lastDayOfMonth,
  isCalendarDay,
  dayCountdown,
  manilaToday,
  manilaDate,
  manilaHour,
  manilaDayOfWeek,
  manilaMonth,
  manilaYear,
  manilaMonthIndex,
  manilaDayStart,
  manilaDayEnd,
  addDays,
  daysBetween,
  weekRange,
  monthRange,
  formatManila,
  formatManilaSchedule,
  todayISO,
  thisWeekRange,
} from './dates';

// 07:00 Manila on 2026-09-02 — the hour where the UTC day (2026-09-01) and the
// Manila day (2026-09-02) disagree. Every regression this module exists to
// prevent shows up in this window.
const EARLY_MORNING = new Date('2026-09-01T23:00:00Z');

afterEach(() => {
  vi.useRealTimers();
});

describe('toManilaDay', () => {
  it('reads the Manila day, not the UTC day, before 08:00 local', () => {
    expect(toManilaDay(EARLY_MORNING)).toBe('2026-09-02');
    expect(EARLY_MORNING.toISOString().slice(0, 10)).toBe('2026-09-01'); // the bug
  });

  it('holds at the last instant of a Manila day', () => {
    expect(toManilaDay(new Date('2026-09-02T15:59:59Z'))).toBe('2026-09-02');
    expect(toManilaDay(new Date('2026-09-02T16:00:00Z'))).toBe('2026-09-03');
  });

  it('accepts ISO strings and epoch millis', () => {
    expect(toManilaDay('2026-09-01T23:00:00Z')).toBe('2026-09-02');
    expect(toManilaDay(EARLY_MORNING.getTime())).toBe('2026-09-02');
  });

  it('zero-pads single-digit months and days', () => {
    expect(toManilaDay(new Date('2026-01-05T04:00:00Z'))).toBe('2026-01-05');
  });
});

describe('manilaToday / manilaDate', () => {
  it('uses the fake clock', () => {
    vi.useFakeTimers();
    vi.setSystemTime(EARLY_MORNING);
    expect(manilaToday()).toBe('2026-09-02');
    expect(manilaDate(1)).toBe('2026-09-03');
    expect(manilaDate(-1)).toBe('2026-09-01');
  });

  it('rolls over months and years', () => {
    expect(manilaDate(1, new Date('2026-12-31T04:00:00Z'))).toBe('2027-01-01');
    expect(manilaDate(-1, new Date('2026-03-01T04:00:00Z'))).toBe('2026-02-28');
  });
});

describe('manilaHour', () => {
  it('reports the Manila clock hour', () => {
    expect(manilaHour(EARLY_MORNING)).toBe(7);
    expect(manilaHour(new Date('2026-09-02T05:00:00Z'))).toBe(13);
  });

  it('reports midnight as 0, not 24', () => {
    expect(manilaHour(new Date('2026-09-01T16:00:00Z'))).toBe(0);
  });
});

describe('manilaMonth / manilaYear / manilaMonthIndex', () => {
  it('reads the Manila month, not the UTC one', () => {
    expect(manilaMonth(EARLY_MORNING)).toBe('2026-09');
    expect(manilaYear(EARLY_MORNING)).toBe(2026);
    expect(manilaMonthIndex(EARLY_MORNING)).toBe(8); // September, 0-based
  });

  it('rolls to the next month when UTC is still in the previous one', () => {
    const justPastMidnightManila = new Date('2026-09-30T16:30:00Z');
    expect(manilaMonth(justPastMidnightManila)).toBe('2026-10');
    expect(manilaMonthIndex(justPastMidnightManila)).toBe(9);
  });

  it('rolls the year over at Manila midnight on Jan 1', () => {
    const newYearManila = new Date('2026-12-31T16:00:00Z');
    expect(manilaYear(newYearManila)).toBe(2027);
    expect(manilaMonth(newYearManila)).toBe('2027-01');
    expect(manilaMonthIndex(newYearManila)).toBe(0);
  });
});

describe('manilaDayOfWeek', () => {
  it('is 0 for Sunday through 6 for Saturday', () => {
    expect(manilaDayOfWeek('2026-08-30')).toBe(0); // Sunday
    expect(manilaDayOfWeek('2026-09-02')).toBe(3); // Wednesday
    expect(manilaDayOfWeek('2026-09-05')).toBe(6); // Saturday
  });

  it('reads the Manila day when given an instant', () => {
    expect(manilaDayOfWeek(EARLY_MORNING)).toBe(3); // Wed 2026-09-02, not Tue
  });
});

describe('day bounds', () => {
  it('brackets the full Manila day', () => {
    expect(manilaDayStart('2026-09-02')).toBe('2026-09-02T00:00:00.000+08:00');
    expect(manilaDayEnd('2026-09-02')).toBe('2026-09-02T23:59:59.999+08:00');
  });

  it('covers every instant of that day and nothing outside it', () => {
    const start = Date.parse(manilaDayStart('2026-09-02'));
    const end = Date.parse(manilaDayEnd('2026-09-02'));
    const lastMomentOfPrevDay = Date.parse('2026-09-01T23:59:59.999+08:00');
    const firstMomentOfNextDay = Date.parse('2026-09-03T00:00:00.000+08:00');

    expect(lastMomentOfPrevDay).toBeLessThan(start);
    expect(Date.parse('2026-09-02T22:30:00+08:00')).toBeLessThanOrEqual(end);
    expect(firstMomentOfNextDay).toBeGreaterThan(end);
  });

  it('is what a bare date fails to do as an upper bound', () => {
    // The bug: `completed_at <= '2026-09-02'` is midnight, so it drops the day.
    const bare = Date.parse('2026-09-02');
    const completedThatAfternoon = Date.parse('2026-09-02T14:00:00+08:00');
    expect(completedThatAfternoon).toBeGreaterThan(bare);
    expect(completedThatAfternoon).toBeLessThanOrEqual(Date.parse(manilaDayEnd('2026-09-02')));
  });
});

describe('addDays / daysBetween', () => {
  it('rolls over month and year boundaries', () => {
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
  });

  it('handles leap days', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
  });

  it('counts whole days, signed', () => {
    expect(daysBetween('2026-09-01', '2026-09-02')).toBe(1);
    expect(daysBetween('2026-09-02', '2026-09-01')).toBe(-1);
    expect(daysBetween('2026-09-02', '2026-09-02')).toBe(0);
    expect(daysBetween('2026-01-01', '2027-01-01')).toBe(365);
  });
});

describe('weekRange', () => {
  it('runs Monday to Sunday around a midweek day', () => {
    // 2026-09-02 is a Wednesday.
    expect(weekRange(0, EARLY_MORNING)).toEqual({ start: '2026-08-31', end: '2026-09-06' });
  });

  it('keeps Sunday in the week that began the preceding Monday', () => {
    const sunday = new Date('2026-09-06T04:00:00Z');
    expect(weekRange(0, sunday)).toEqual({ start: '2026-08-31', end: '2026-09-06' });
  });

  it('shifts by whole weeks', () => {
    expect(weekRange(7, EARLY_MORNING)).toEqual({ start: '2026-09-07', end: '2026-09-13' });
  });
});

describe('monthRange', () => {
  it('spans the first to last day of the Manila month', () => {
    expect(monthRange(EARLY_MORNING)).toEqual({ start: '2026-09-01', end: '2026-09-30' });
  });

  it('gets February right in a leap year and a common year', () => {
    expect(monthRange(new Date('2028-02-10T04:00:00Z')).end).toBe('2028-02-29');
    expect(monthRange(new Date('2026-02-10T04:00:00Z')).end).toBe('2026-02-28');
  });

  it('uses the Manila month when UTC is still in the previous one', () => {
    // 2026-10-01 00:30 Manila is still 2026-09-30 in UTC.
    expect(monthRange(new Date('2026-09-30T16:30:00Z'))).toEqual({
      start: '2026-10-01',
      end: '2026-10-31',
    });
  });
});

describe('formatManila', () => {
  it('formats the Manila day, not the UTC one', () => {
    expect(formatManila(EARLY_MORNING)).toContain('2');
    expect(formatManila(EARLY_MORNING, { day: 'numeric', month: 'numeric', year: 'numeric' }))
      .toBe('9/2/2026');
  });
});

describe('todayISO', () => {
  it('returns the Manila calendar date even when UTC is a day behind', () => {
    // 2026-08-21T17:00:00Z is 2026-08-22 01:00 in Asia/Manila (UTC+8)
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-21T17:00:00Z'));
    expect(todayISO()).toBe('2026-08-22');
  });
});

describe('thisWeekRange', () => {
  it('spans Monday through Sunday for a midweek date', () => {
    // 2026-08-19 is a Wednesday in Manila
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-19T04:00:00Z'));
    expect(thisWeekRange()).toEqual({ start: '2026-08-17', end: '2026-08-23' });
  });

  it('treats Sunday as the end of the current week, not the start of the next', () => {
    // 2026-08-23 is a Sunday in Manila
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-23T04:00:00Z'));
    expect(thisWeekRange()).toEqual({ start: '2026-08-17', end: '2026-08-23' });
  });
});

describe('formatManilaSchedule', () => {
  it('shows the start alone when there is no end', () => {
    expect(formatManilaSchedule('2026-10-06T01:00:00Z')).toBe('Tue, Oct 6, 2026, 9:00 AM');
  });

  it('gives only the end time when the end is on the same Manila day', () => {
    // 07:00–09:00 Manila spans two UTC days; it is still one day at the firm.
    expect(formatManilaSchedule('2026-10-05T23:00:00Z', '2026-10-06T01:00:00Z'))
      .toBe('Tue, Oct 6, 2026, 7:00 AM – 9:00 AM');
  });

  it('repeats the date when the end falls on another Manila day', () => {
    expect(formatManilaSchedule('2026-10-06T01:00:00Z', '2026-10-07T09:00:00Z'))
      .toBe('Tue, Oct 6, 2026, 9:00 AM – Wed, Oct 7, 2026, 5:00 PM');
  });

  it('ignores an end that is not after the start', () => {
    expect(formatManilaSchedule('2026-10-06T01:00:00Z', '2026-10-06T01:00:00Z'))
      .toBe('Tue, Oct 6, 2026, 9:00 AM');
  });

  it('is null without a usable start', () => {
    expect(formatManilaSchedule(null)).toBeNull();
    expect(formatManilaSchedule('not a date')).toBeNull();
  });
});

describe('toManilaDay on stored values', () => {
  it('reads a timestamptz as PostgREST returns it in UTC by the Manila day', () => {
    // Midnight Manila on 7 October, as the database sends it back.
    expect(toManilaDay('2026-10-06T16:00:00+00:00')).toBe('2026-10-07');
    expect('2026-10-06T16:00:00+00:00'.slice(0, 10)).toBe('2026-10-06'); // the bug
  });

  it('returns a bare calendar day unchanged', () => {
    expect(toManilaDay('2026-10-07')).toBe('2026-10-07');
  });

  it('reads a zoneless date-time as the Manila wall clock, whatever the host zone', () => {
    expect(toManilaDay('2026-10-07T00:30:00')).toBe('2026-10-07');
  });
});

describe('toManilaInstant', () => {
  it('pins a bare day to Manila midnight', () => {
    expect(toManilaInstant('2026-10-07')).toBe('2026-10-07T00:00:00+08:00');
    expect(new Date(toManilaInstant('2026-10-07')).toISOString()).toBe('2026-10-06T16:00:00.000Z');
  });

  it('reads a zoneless date-time as the Manila wall clock', () => {
    expect(toManilaInstant('2026-10-07T14:00')).toBe('2026-10-07T14:00+08:00');
    expect(toManilaInstant('2026-10-07T14:00:00')).toBe('2026-10-07T14:00:00+08:00');
    expect(toManilaInstant('2026-10-07T14:00:00.250')).toBe('2026-10-07T14:00:00.250+08:00');
  });

  it('leaves a value that already names its zone alone', () => {
    expect(toManilaInstant('2026-10-07T14:00:00+08:00')).toBe('2026-10-07T14:00:00+08:00');
    expect(toManilaInstant('2026-10-07T06:00:00Z')).toBe('2026-10-07T06:00:00Z');
    expect(toManilaInstant('2026-10-07T06:00:00.000Z')).toBe('2026-10-07T06:00:00.000Z');
  });
});

describe('toManilaWallClock', () => {
  it('renders the Manila wall clock with no zone', () => {
    expect(toManilaWallClock('2026-10-06T16:00:00+00:00')).toBe('2026-10-07T00:00:00');
    expect(toManilaWallClock('2026-10-07T06:30:00Z')).toBe('2026-10-07T14:30:00');
    expect(toManilaWallClock('2026-10-07')).toBe('2026-10-07T00:00:00');
  });
});

describe('isManilaMidnight', () => {
  it('recognises a day entered without a time', () => {
    expect(isManilaMidnight('2026-10-06T16:00:00+00:00')).toBe(true);
    expect(isManilaMidnight('2026-10-07T00:00:00+08:00')).toBe(true);
    expect(isManilaMidnight('2026-10-07')).toBe(true);
  });

  it('does not mistake UTC midnight (08:00 Manila) for a whole day', () => {
    expect(isManilaMidnight('2026-10-07T00:00:00+00:00')).toBe(false);
  });
});

describe('isDateOnly', () => {
  it('recognises a day with no time in either stored shape', () => {
    expect(isDateOnly('2026-10-07')).toBe(true);
    expect(isDateOnly('2026-10-06T16:00:00+00:00')).toBe(true);
    expect(isDateOnly('2026-10-07T00:00:00+00:00')).toBe(true);
  });

  it('keeps a real time', () => {
    expect(isDateOnly('2026-10-07T06:00:00+00:00')).toBe(false);
    expect(isDateOnly('2026-10-07T00:30:00+08:00')).toBe(false);
  });
});

describe('utcCalendarDay', () => {
  it('reads back a calendar day held at UTC midnight', () => {
    expect(utcCalendarDay(new Date('2026-10-07T00:00:00Z'))).toBe('2026-10-07');
    expect(utcCalendarDay(new Date(Date.UTC(2026, 1, 28)))).toBe('2026-02-28');
  });
});

describe('addMonths / addYears', () => {
  it('rolls over months and years', () => {
    expect(addMonths('2026-11-15', 3)).toBe('2027-02-15');
    expect(addMonths('2026-03-15', -3)).toBe('2025-12-15');
    expect(addYears('2026-10-06', 10)).toBe('2036-10-06');
  });

  it('overflows short months the way Date does', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-03-03');
    expect(addYears('2028-02-29', 1)).toBe('2029-03-01');
  });
});

describe('lastDayOfMonth', () => {
  it('knows month lengths and leap years', () => {
    expect(lastDayOfMonth('2026-02')).toBe('2026-02-28');
    expect(lastDayOfMonth('2028-02')).toBe('2028-02-29');
    expect(lastDayOfMonth('2026-12')).toBe('2026-12-31');
  });
});

describe('isCalendarDay', () => {
  it('accepts real days and rejects impossible ones', () => {
    expect(isCalendarDay('2028-02-29')).toBe(true);
    expect(isCalendarDay('2026-02-29')).toBe(false);
    expect(isCalendarDay('2026-13-01')).toBe(false);
    expect(isCalendarDay('2026-10-6')).toBe(false);
  });
});

describe('dayCountdown', () => {
  const today = '2026-10-14';
  it('counts days late, today, tomorrow and days ahead', () => {
    expect(dayCountdown('2026-10-11', today)).toEqual({ label: '3 days late', tone: 'late' });
    expect(dayCountdown('2026-10-13', today)).toEqual({ label: '1 day late', tone: 'late' });
    expect(dayCountdown(today, today)).toEqual({ label: 'Today', tone: 'today' });
    expect(dayCountdown('2026-10-15', today)).toEqual({ label: 'Tomorrow', tone: 'soon' });
    expect(dayCountdown('2026-10-21', today)).toEqual({ label: 'in 7 days', tone: 'soon' });
    expect(dayCountdown('2026-10-30', today)).toEqual({ label: 'in 16 days', tone: 'later' });
  });

  it('gives the date more than a month out', () => {
    expect(dayCountdown('2026-12-25', today)).toEqual({ label: 'Dec 25', tone: 'later' });
  });
});
