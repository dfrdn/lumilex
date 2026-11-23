import { describe, it, expect } from 'vitest';
import {
  CALENDAR_TABS,
  calendarHref,
  datesQuery,
  holdsUndated,
  opensOnUpcoming,
  parseCalendarTab,
  parseListWindow,
  windowKey,
  windowQuery,
} from './views';

const TODAY = '2026-11-07';

describe('calendar tabs', () => {
  it('default to the calendar', () => {
    expect(parseCalendarTab(undefined)).toBe('calendar');
    expect(parseCalendarTab('nonsense')).toBe('calendar');
    expect(calendarHref('calendar')).toBe('/dashboard/calendar');
  });

  it('round-trip through the URL', () => {
    for (const { key } of CALENDAR_TABS) {
      const tab = new URL(calendarHref(key), 'https://x').searchParams.get('tab') ?? undefined;
      expect(parseCalendarTab(tab)).toBe(key);
    }
  });

  it('carry a card or window', () => {
    expect(calendarHref('hearings', { card: 'upcoming' })).toBe('/dashboard/calendar?tab=hearings&card=upcoming');
    expect(calendarHref('meetings', { range: 'all' })).toBe('/dashboard/calendar?tab=meetings&range=all');
  });
});

describe('list window', () => {
  it('reaches 90 days back and stays open ahead by default', () => {
    expect(parseListWindow({}, TODAY)).toEqual({ preset: 'recent', from: '2026-08-09', to: null });
    expect(parseListWindow({ range: 'nonsense' }, TODAY).preset).toBe('recent');
  });

  it('offers a year back and every date', () => {
    expect(parseListWindow({ range: 'year' }, TODAY)).toEqual({ preset: 'year', from: '2025-11-07', to: null });
    expect(parseListWindow({ range: 'all' }, TODAY)).toEqual({ preset: 'all', from: null, to: null });
  });

  it('takes days set by hand over a preset, in either order', () => {
    expect(parseListWindow({ range: 'all', from: '2026-01-01' }, TODAY)).toEqual({ preset: 'custom', from: '2026-01-01', to: null });
    expect(parseListWindow({ from: '2026-03-31', to: '2026-01-01' }, TODAY)).toEqual({ preset: 'custom', from: '2026-01-01', to: '2026-03-31' });
    expect(parseListWindow({ from: '2026-02-30' }, TODAY).preset).toBe('recent');
  });

  it('round-trip through the URL', () => {
    for (const params of [{}, { range: 'year' }, { range: 'all' }, { from: '2026-01-01' }, { to: '2026-12-31' }, { from: '2026-01-01', to: '2026-02-01' }]) {
      const w = parseListWindow(params, TODAY);
      expect(parseListWindow(windowQuery(w), TODAY)).toEqual(w);
    }
  });
});

describe('window choices', () => {
  it('open on Upcoming only for the default window', () => {
    expect(opensOnUpcoming(parseListWindow({}, TODAY))).toBe(true);
    expect(opensOnUpcoming(parseListWindow({ range: 'year' }, TODAY))).toBe(false);
    expect(opensOnUpcoming(parseListWindow({ range: 'all' }, TODAY))).toBe(false);
    expect(opensOnUpcoming(parseListWindow({ from: '2026-01-01', to: '2026-03-31' }, TODAY))).toBe(false);
  });

  it('keep undated entries while the window is open ahead', () => {
    expect(holdsUndated(parseListWindow({}, TODAY))).toBe(true);
    expect(holdsUndated(parseListWindow({ range: 'year' }, TODAY))).toBe(true);
    expect(holdsUndated(parseListWindow({ from: '2026-01-01' }, TODAY))).toBe(true);
    expect(holdsUndated(parseListWindow({ from: '2026-01-01', to: '2026-03-31' }, TODAY))).toBe(false);
  });

  it('open every date when both ends are cleared', () => {
    expect(parseListWindow(datesQuery(null, null), TODAY)).toEqual({ preset: 'all', from: null, to: null });
    expect(parseListWindow(datesQuery('2026-01-01', null), TODAY)).toEqual({ preset: 'custom', from: '2026-01-01', to: null });
  });

  it('give each window its own key', () => {
    const keys = [{}, { range: 'year' }, { range: 'all' }, { from: '2026-01-01' }, { to: '2026-01-01' }].map((q) =>
      windowKey(parseListWindow(q, TODAY)),
    );
    expect(new Set(keys).size).toBe(keys.length);
  });
});
