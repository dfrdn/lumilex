import { describe, it, expect } from 'vitest';
import { byDueDate, byPriority, deliverableSlices, involving, onManilaDay, taskSlices } from './dashboard-slices';

describe('onManilaDay', () => {
  it('places a timestamp on its Manila day, not its UTC day', () => {
    const items = [
      { id: 'early', date: '2026-10-12T17:30:00Z' }, // 01:30 on the 13th in Manila
      { id: 'late', date: '2026-10-13T16:30:00Z' }, // 00:30 on the 14th in Manila
      { id: 'none', date: null },
    ];
    expect(onManilaDay(items, '2026-10-13').map((i) => i.id)).toEqual(['early']);
  });

  it('reads offset timestamps as returned by PostgREST', () => {
    expect(onManilaDay([{ date: '2026-10-13T09:00:00+08:00' }], '2026-10-13')).toHaveLength(1);
  });
});

describe('involving', () => {
  it('keeps the items that list the person', () => {
    const items = [{ id: 'a', attendeeIds: ['p1', 'p2'] }, { id: 'b', attendeeIds: ['p2'] }];
    expect(involving(items, 'p1').map((i) => i.id)).toEqual(['a']);
  });
});

describe('taskSlices', () => {
  const week = { start: '2026-10-12', end: '2026-10-18' };
  const open = [
    { id: 'overdue', dueDate: '2026-10-10', priority: 'High' },
    { id: 'today-low', dueDate: '2026-10-13', priority: 'Low' },
    { id: 'today-medium', dueDate: '2026-10-13', priority: 'Medium' },
    { id: 'today-unset', dueDate: '2026-10-13', priority: '' },
    { id: 'today-high', dueDate: '2026-10-13', priority: 'High' },
    { id: 'sunday', dueDate: '2026-10-18', priority: null },
    { id: 'next', dueDate: '2026-10-19', priority: null },
    { id: 'undated', dueDate: null, priority: null },
  ];

  it('takes today by due date, High before Medium before Low before unset', () => {
    expect(taskSlices(open, '2026-10-13', week).today.map((t) => t.id)).toEqual(['today-high', 'today-medium', 'today-low', 'today-unset']);
  });

  it('takes the week inclusive of both ends, leaving out undated and earlier tasks', () => {
    expect(taskSlices(open, '2026-10-13', week).week.map((t) => t.id)).toEqual(['today-low', 'today-medium', 'today-unset', 'today-high', 'sunday']);
  });
});

describe('deliverableSlices', () => {
  const today = '2026-10-13';
  const d = (id: string, over: Partial<{ currentlyWith: string[]; externalDueDate: string | null; reviewerIds: string[]; reviewDates: (string | null)[] }>) => ({
    id, currentlyWith: ['me'], externalDueDate: null, reviewerIds: [], reviewDates: [], ...over,
  });

  const involved = [
    d('due-today', { externalDueDate: today }),
    d('review-today', { reviewerIds: ['other'], reviewDates: [today] }),
    d('late', { externalDueDate: '2026-10-01' }),
    d('my-review-late', { reviewerIds: ['me'], reviewDates: ['2026-10-12'] }),
    d('with-someone-else', { currentlyWith: ['other'], externalDueDate: today }),
    d('later', { externalDueDate: '2026-11-01' }),
  ];
  const s = deliverableSlices(involved, 'me', today);

  it('keeps only those currently with the person as theirs', () => {
    expect(s.mine.map((x) => x.id)).not.toContain('with-someone-else');
    expect(s.mine).toHaveLength(5);
  });

  it('is due today on the deadline or any review date', () => {
    expect(s.dueToday.map((x) => x.id)).toEqual(['due-today', 'review-today']);
  });

  it('is overdue on a passed deadline or the person\'s own passed review date', () => {
    expect(s.overdue.map((x) => x.id)).toEqual(['late', 'my-review-late']);
  });
});

describe('byPriority', () => {
  it('ranks the labels, not their spelling, with unknown and null last', () => {
    const rows = [{ priority: null }, { priority: 'Low' }, { priority: 'Urgent?' }, { priority: 'High' }, { priority: 'Medium' }];
    expect(rows.sort(byPriority).map((r) => r.priority)).toEqual(['High', 'Medium', 'Low', null, 'Urgent?']);
  });
});

describe('byDueDate', () => {
  it('sorts by deadline with undated last', () => {
    const rows = [{ externalDueDate: null }, { externalDueDate: '2026-10-20' }, { externalDueDate: '2026-10-01' }];
    expect(rows.sort(byDueDate).map((r) => r.externalDueDate)).toEqual(['2026-10-01', '2026-10-20', null]);
  });
});
