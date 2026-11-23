import { describe, it, expect } from 'vitest';
import { standing, stateChip, trackLine, whenFromToday } from './company-wording';

describe('stateChip', () => {
  it('never shows the client an item past due or one the firm does not handle', () => {
    expect(stateChip('overdue')).toBeNull();
    expect(stateChip('not_ours')).toBeNull();
  });
  it('asks for the client when it is waiting on them', () => {
    expect(stateChip('waiting_on_client')).toEqual({ label: 'Needs you', tone: 'gold' });
  });
});

describe('standing', () => {
  const base = { health: 'green' as const, dueSoon: 0, waitingOnClient: false, phase: 'ongoing' as const };
  it('puts what the client must do first', () => {
    expect(standing({ ...base, dueSoon: 2, waitingOnClient: true }).label).toBe('Waiting on you');
  });
  it('says something is due soon, or on track when the team reads it green', () => {
    expect(standing({ ...base, dueSoon: 1 }).label).toBe('Something due soon');
    expect(standing(base).label).toBe('On track');
  });
  it('says only "in progress" otherwise — never "past due"', () => {
    expect(standing({ ...base, health: 'grey' })).toEqual({ label: 'In progress', tone: 'navy' });
  });
  it('says dissolved for a dissolved company', () => {
    expect(standing({ ...base, phase: 'dissolved' }).label).toBe('Dissolved');
  });
});

describe('whenFromToday', () => {
  const today = '2026-10-09';
  it('reads near dates in days, far ones in months, and never states a past date', () => {
    expect(whenFromToday('2026-10-09', today)).toBe('Today');
    expect(whenFromToday('2026-10-10', today)).toBe('Tomorrow');
    expect(whenFromToday('2026-10-21', today)).toBe('In 12 days');
    expect(whenFromToday('2027-01-30', today)).toBe('In 4 months');
    expect(whenFromToday('2026-10-01', today)).toBeNull();
    expect(whenFromToday(null, today)).toBeNull();
  });
});

describe('trackLine', () => {
  it('speaks plainly about a track, and never of past-due items', () => {
    expect(trackLine({ health: 'grey', done: 0, total: 9 })).toBe('Not started yet');
    expect(trackLine({ health: 'grey', done: 2, total: 9 })).toBe('In progress');
    expect(trackLine({ health: 'green', done: 13, total: 13 })).toBe('All done');
    expect(trackLine({ health: 'green', done: 2, total: 13 })).toBe('On track');
    expect(trackLine({ health: 'amber', done: 2, total: 13 })).toBe('Something is due soon');
  });
});
