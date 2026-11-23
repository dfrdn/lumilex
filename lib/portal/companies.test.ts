import { describe, it, expect } from 'vitest';
import { aheadOrder, forClient } from './companies';

describe('forClient', () => {
  it('shows a past-due item as in progress, without its past date', () => {
    expect(forClient({ state: 'overdue', dueDate: '2026-01-30' })).toEqual({ state: 'in_progress', dueDate: null, pastDue: true });
  });
  it('leaves every other item as it is', () => {
    expect(forClient({ state: 'not_started', dueDate: '2027-01-30' })).toEqual({ state: 'not_started', dueDate: '2027-01-30', pastDue: false });
  });
});

describe('aheadOrder', () => {
  it('puts what is under way first, then by date, undated last', () => {
    const items = [
      { id: 'later', pastDue: false, dueDate: '2027-04-15' },
      { id: 'undated', pastDue: false, dueDate: null },
      { id: 'late', pastDue: true, dueDate: null },
      { id: 'soon', pastDue: false, dueDate: '2027-01-30' },
    ];
    expect(items.sort(aheadOrder).map((i) => i.id)).toEqual(['late', 'soon', 'later', 'undated']);
  });
});
