import { describe, expect, it } from 'vitest';
import { hearingDay, hearingOutcome } from './hearing-day';

// 2026-10-12 23:30 in Manila is 15:30 UTC — still the 12th locally.
const now = new Date('2026-10-12T15:30:00Z');

describe('hearingDay', () => {
  it('is empty without a date', () => {
    expect(hearingDay(null, now)).toEqual({ dateStr: null, status: 'none', daysLabel: '', timeStr: null });
  });

  it('takes the Manila day of a timestamp', () => {
    // 1 AM on the 13th in Manila is still the 12th in UTC.
    expect(hearingDay('2026-10-12T17:00:00Z', now)).toMatchObject({ dateStr: '2026-10-13', status: 'upcoming', daysLabel: 'Tomorrow', timeStr: '1:00 AM' });
  });

  it('reads today, past and distance against Manila today', () => {
    expect(hearingDay('2026-10-12T01:00:00Z', now)).toMatchObject({ status: 'today', daysLabel: 'Today', timeStr: '9:00 AM' });
    expect(hearingDay('2026-10-09T01:00:00Z', now)).toMatchObject({ status: 'past', daysLabel: '3 days ago' });
    expect(hearingDay('2026-10-17T01:00:00Z', now)).toMatchObject({ status: 'upcoming', daysLabel: 'In 5 days' });
  });

  it('has no time for a bare date, Manila midnight, or midnight UTC on older rows', () => {
    expect(hearingDay('2026-10-14', now)).toMatchObject({ dateStr: '2026-10-14', timeStr: null });
    expect(hearingDay('2026-10-13T16:00:00Z', now)).toMatchObject({ dateStr: '2026-10-14', timeStr: null });
    expect(hearingDay('2026-10-14T00:00:00Z', now).timeStr).toBeNull();
  });
});

describe('hearingOutcome', () => {
  it('ranks cancelled, attended and postponed over the date', () => {
    expect(hearingOutcome('Cancelled', true, 'past')).toEqual({ label: 'Cancelled', tone: 'muted' });
    expect(hearingOutcome('', true, 'past')).toEqual({ label: 'Attended', tone: 'emerald' });
    expect(hearingOutcome('Postponed', false, 'past')).toEqual({ label: 'Postponed', tone: 'amber' });
  });

  it('follows the date when nothing is recorded', () => {
    expect(hearingOutcome('', false, 'past')).toEqual({ label: 'No outcome recorded', tone: 'rose' });
    expect(hearingOutcome('', false, 'today')).toEqual({ label: 'Today', tone: 'amber' });
    expect(hearingOutcome('', false, 'upcoming')).toEqual({ label: 'Scheduled', tone: 'blue' });
  });
});
