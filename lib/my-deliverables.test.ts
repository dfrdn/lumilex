import { describe, expect, it } from 'vitest';
import { countsAsOverdue, daysLate, groupMyDeliverables, isWithMe, myDate, pickUpNext, stepOf } from './my-deliverables';

const ME = 'me';
const TODAY = '2026-10-14';

function d(over: Partial<Parameters<typeof myDate>[0]> & { id?: string; matterId?: string | null } = {}) {
  return {
    id: 'x',
    matterId: null as string | null,
    status: 'Drafting',
    currentlyWith: [ME],
    reviewerIds: [] as string[],
    externalDueDate: null as string | null,
    reviewDates: [] as (string | null)[],
    ...over,
  };
}

describe('isWithMe', () => {
  it('needs the person on it and the work not done', () => {
    expect(isWithMe(d(), ME)).toBe(true);
    expect(isWithMe(d({ currentlyWith: ['other'] }), ME)).toBe(false);
    for (const status of ['Filed or Sent out', 'Archived', 'Acknowledged']) expect(isWithMe(d({ status }), ME)).toBe(false);
  });
});

describe('stepOf', () => {
  it('reads the step from the status', () => {
    expect(stepOf('Under Review')).toBe('review');
    expect(stepOf('Submitted')).toBe('review');
    expect(stepOf('Finalizing')).toBe('file');
    expect(stepOf('Outbox')).toBe('file');
    expect(stepOf('Awaiting Client')).toBe('client');
    expect(stepOf('Not started')).toBe('draft');
    expect(stepOf('Revising')).toBe('draft');
  });
});

describe('myDate', () => {
  it('takes the earlier of the deadline and my own review date', () => {
    expect(myDate(d({ reviewerIds: ['b', ME], reviewDates: ['2026-10-10', '2026-10-16'], externalDueDate: '2026-10-20' }), ME)).toBe('2026-10-16');
  });

  it('ignores other reviewers’ dates', () => {
    expect(myDate(d({ reviewerIds: ['b'], reviewDates: ['2026-10-01'] }), ME)).toBeNull();
  });
});

describe('countsAsOverdue', () => {
  it('on a passed deadline or my passed review date', () => {
    expect(countsAsOverdue(d({ externalDueDate: '2026-10-13' }), ME, TODAY)).toBe(true);
    expect(countsAsOverdue(d({ reviewerIds: [ME], reviewDates: ['2026-10-01'], externalDueDate: '2026-11-01' }), ME, TODAY)).toBe(true);
    expect(countsAsOverdue(d({ externalDueDate: TODAY }), ME, TODAY)).toBe(false);
  });

  it('never while it waits on the client, or once it has left me', () => {
    expect(countsAsOverdue(d({ status: 'Awaiting Client', externalDueDate: '2026-10-01' }), ME, TODAY)).toBe(false);
    expect(countsAsOverdue(d({ currentlyWith: ['other'], externalDueDate: '2026-10-01' }), ME, TODAY)).toBe(false);
  });
});

describe('daysLate', () => {
  it('counts from my date', () => {
    expect(daysLate(d({ externalDueDate: '2026-10-02' }), ME, TODAY)).toBe(12);
    expect(daysLate(d({ externalDueDate: TODAY }), ME, TODAY)).toBe(0);
  });
});

describe('groupMyDeliverables', () => {
  it('groups by step; overdue first, most recently missed first; then by date, undated last', () => {
    const g = groupMyDeliverables(
      [
        d({ id: 'old', status: 'Under Review', externalDueDate: '2026-01-01' }),
        d({ id: 'recent', status: 'Under Review', externalDueDate: '2026-10-10' }),
        d({ id: 'soon', status: 'Under Review', externalDueDate: '2026-10-20' }),
        d({ id: 'today', status: 'Under Review', externalDueDate: TODAY }),
        d({ id: 'undated', status: 'Under Review' }),
        d({ id: 'gone', status: 'Under Review', currentlyWith: ['other'] }),
        d({ id: 'client', status: 'Awaiting Client', externalDueDate: '2026-10-01' }),
        d({ id: 'outbox', status: 'Outbox' }),
      ],
      ME,
      TODAY,
    );
    expect(g.review.map((x) => x.id)).toEqual(['recent', 'old', 'today', 'soon', 'undated']);
    expect(g.client.map((x) => x.id)).toEqual(['client']);
    expect(g.file.map((x) => x.id)).toEqual(['outbox']);
    expect(g.draft).toEqual([]);
  });
});

describe('groupMyDeliverables court order', () => {
  it('puts court work first on the same date', () => {
    const g = groupMyDeliverables(
      [d({ id: 'memo', status: 'Under Review', externalDueDate: '2026-10-20', matterId: 'm1' }), d({ id: 'court', status: 'Under Review', externalDueDate: '2026-10-20', matterId: 'c1' })],
      ME,
      TODAY,
      (x) => x.matterId === 'c1',
    );
    expect(g.review.map((x) => x.id)).toEqual(['court', 'memo']);
  });
});

describe('pickUpNext', () => {
  const now = new Date('2026-10-14T00:30:00Z'); // 8:30 AM in Manila
  const court = new Set(['c1']);

  it('picks the next hearing today, allowing half an hour after it starts', () => {
    const hearings = [
      { id: 'h-past', name: 'Past', date: '2026-10-13T23:00:00Z', status: 'Scheduled' }, // 7:00 AM, too long ago
      { id: 'h-now', name: 'Now', date: '2026-10-14T00:10:00Z', status: 'Scheduled' }, // 8:10 AM
      { id: 'h-later', name: 'Later', date: '2026-10-14T06:00:00Z', status: 'Scheduled' },
    ];
    expect(pickUpNext(hearings, [], court, ME, TODAY, now)).toEqual({ kind: 'hearing', hearing: hearings[1] });
  });

  it('skips cancelled hearings', () => {
    expect(pickUpNext([{ id: 'h', name: 'H', date: '2026-10-14T06:00:00Z', status: 'Cancelled' }], [], court, ME, TODAY, now)).toBeNull();
  });

  it('then court work due today, then the most recently overdue, then anything due today', () => {
    const memoToday = d({ id: 'memo-today', externalDueDate: TODAY, matterId: 'm1' });
    const courtToday = d({ id: 'court-today', externalDueDate: TODAY, matterId: 'c1' });
    const oldLate = d({ id: 'old', externalDueDate: '2026-09-01', matterId: 'm1' });
    const newLate = d({ id: 'new', externalDueDate: '2026-10-12', matterId: 'm1' });
    const clientLate = d({ id: 'client', status: 'Awaiting Client', externalDueDate: '2026-10-13' });

    const pick = (rows: ReturnType<typeof d>[]) => {
      const r = pickUpNext([], rows, court, ME, TODAY, now);
      return r?.kind === 'deliverable' ? [r.deliverable.id, r.reason] : r;
    };
    expect(pick([memoToday, courtToday, newLate])).toEqual(['court-today', 'court-today']);
    expect(pick([memoToday, oldLate, newLate, clientLate])).toEqual(['new', 'overdue']);
    expect(pick([memoToday])).toEqual(['memo-today', 'today']);
    expect(pick([clientLate])).toBeNull();
  });
});
