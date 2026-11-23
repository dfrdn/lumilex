import { describe, it, expect } from 'vitest';
import {
  groupByStatus,
  STATUS_ORDER,
  DELIVERABLE_STATUS,
  DELIVERABLE_STATUSES,
  EXTERNAL_PIPELINE_STATUSES,
  INTERNAL_PIPELINE_STATUSES,
  statusesForType,
  pickableStatusesForType,
  isDeliverableStatus,
  FINALIZED_STATUSES,
  DELIVERED_STATUSES,
  CLOSED_STATUSES,
  HANDED_OFF_STATUSES,
  isClosed,
  isHandedOff,
  isDelivered,
  filedOnDay,
  isOverdueFor,
} from './deliverable-status';
import { manilaToday } from './dates';

describe('groupByStatus', () => {
  it('returns an empty array for no items', () => {
    expect(groupByStatus([])).toEqual([]);
  });

  it('groups items by status and orders groups by STATUS_ORDER', () => {
    const items = [
      { id: 1, status: 'Outbox' },
      { id: 2, status: 'Drafting' },
      { id: 3, status: 'Not started' },
      { id: 4, status: 'Drafting' },
    ];
    const groups = groupByStatus(items);

    expect(groups.map((g) => g.status)).toEqual(['Not started', 'Drafting', 'Outbox']);
    // both Drafting items land in the same group, insertion order preserved
    expect(groups.find((g) => g.status === 'Drafting')!.items.map((i) => i.id)).toEqual([2, 4]);
  });

  it('sorts statuses not in STATUS_ORDER after known ones', () => {
    const items = [
      { status: 'Mystery' },
      { status: 'Drafting' },
    ];
    expect(groupByStatus(items).map((g) => g.status)).toEqual(['Drafting', 'Mystery']);
  });

  it('buckets empty status under "Unknown"', () => {
    expect(groupByStatus([{ status: '' }])).toEqual([{ status: 'Unknown', items: [{ status: '' }] }]);
  });

  it('keeps every known status in the documented order', () => {
    const items = STATUS_ORDER.map((status) => ({ status }));
    expect(groupByStatus(items).map((g) => g.status)).toEqual(STATUS_ORDER);
  });
});

describe('the status vocabulary', () => {
  it('names twelve statuses, each once', () => {
    expect(DELIVERABLE_STATUSES).toHaveLength(12);
    expect(new Set(DELIVERABLE_STATUSES).size).toBe(12);
    expect(Object.values(DELIVERABLE_STATUS).sort()).toEqual([...DELIVERABLE_STATUSES].sort());
  });

  it('splits every status between the two pipelines, sharing only the start', () => {
    const both = EXTERNAL_PIPELINE_STATUSES.filter((s) => INTERNAL_PIPELINE_STATUSES.includes(s));
    expect(both).toEqual([DELIVERABLE_STATUS.NOT_STARTED, DELIVERABLE_STATUS.DRAFTING]);
    const covered = new Set([...EXTERNAL_PIPELINE_STATUSES, ...INTERNAL_PIPELINE_STATUSES]);
    expect([...covered].sort()).toEqual([...DELIVERABLE_STATUSES].sort());
  });

  it('gives internal deliverables their own statuses, and every other type the external pipeline', () => {
    expect(statusesForType('Internal')).toBe(INTERNAL_PIPELINE_STATUSES);
    for (const t of ['External', 'For Client', 'Status Report', null, undefined]) {
      expect(statusesForType(t)).toBe(EXTERNAL_PIPELINE_STATUSES);
    }
  });

  it('never offers Archived in a status picker — archiving has its own action', () => {
    expect(pickableStatusesForType('External')).not.toContain(DELIVERABLE_STATUS.ARCHIVED);
    expect(pickableStatusesForType('Internal')).toEqual(INTERNAL_PIPELINE_STATUSES);
  });

  it('recognises only real statuses', () => {
    expect(isDeliverableStatus('Filed or Sent out')).toBe(true);
    for (const phantom of ['Filed', 'Sent out', 'Completed', 'Done', 'Cancelled', 'Filed or Sent Out']) {
      expect(isDeliverableStatus(phantom)).toBe(false);
    }
  });
});

describe('status roles', () => {
  it('finalized mirrors deliverable_status_is_finalized() in the database', () => {
    // 20260901_deliverable_analysis_triggers.sql:
    //   SELECT p_status = ANY (ARRAY['Filed or Sent out', 'Acknowledged']);
    expect([...FINALIZED_STATUSES].sort()).toEqual(['Acknowledged', 'Filed or Sent out']);
  });

  it('nests: delivered within finalized within closed within handed off', () => {
    for (const s of DELIVERED_STATUSES) expect(FINALIZED_STATUSES).toContain(s);
    for (const s of FINALIZED_STATUSES) expect(CLOSED_STATUSES).toContain(s);
    for (const s of CLOSED_STATUSES) expect(HANDED_OFF_STATUSES).toContain(s);
  });

  it('closes a deliverable when it is finalized or archived, and at no other point', () => {
    for (const closed of ['Archived', 'Acknowledged', 'Filed or Sent out']) expect(isClosed(closed), closed).toBe(true);
    for (const open of ['Not started', 'Drafting', 'Under Review', 'Revising', 'Finalizing', 'Pre-finalized', 'Outbox', 'Awaiting Client', 'Submitted']) {
      expect(isClosed(open), open).toBe(false);
    }
  });

  it('treats an internal deliverable awaiting acknowledgement as handed off but not closed', () => {
    expect(isHandedOff('Submitted')).toBe(true);
    expect(isClosed('Submitted')).toBe(false);
  });

  it('delivers only what reached the court or the client', () => {
    expect(isDelivered('Filed or Sent out')).toBe(true);
    expect(isDelivered('Acknowledged')).toBe(false);
    expect(isDelivered(null)).toBe(false);
  });
});

describe('filedOnDay', () => {
  const today = '2026-10-17';

  it('is today when no day is given', () => {
    expect(filedOnDay(undefined, today)).toBe(today);
    expect(filedOnDay(null, today)).toBe(today);
    expect(filedOnDay('', today)).toBe(today);
  });

  it('keeps a past day or today', () => {
    expect(filedOnDay('2026-02-13', today)).toBe('2026-02-13');
    expect(filedOnDay(today, today)).toBe(today);
  });

  it('refuses a future, malformed or impossible day', () => {
    expect(filedOnDay('2026-10-18', today)).toBeNull();
    expect(filedOnDay('2026-10-17T03:00:00.000Z', today)).toBeNull();
    expect(filedOnDay('2026-02-30', today)).toBeNull();
    expect(filedOnDay(20261017, today)).toBeNull();
  });

  it('defaults to the Manila day, not the UTC one', () => {
    // 07:30 in Manila on the 17th is still the 16th in UTC.
    const early = new Date('2026-10-16T23:30:00Z');
    expect(filedOnDay(undefined, manilaToday(early))).toBe('2026-10-17');
  });
});

describe('isOverdueFor', () => {
  const today = '2026-10-13';
  const base = { externalDueDate: null, reviewerIds: [] as string[], reviewDates: [] as (string | null)[] };

  it('is overdue once the external deadline has passed', () => {
    expect(isOverdueFor({ ...base, externalDueDate: '2026-10-12' }, 'p1', today)).toBe(true);
  });

  it('is not overdue on the day it is due', () => {
    expect(isOverdueFor({ ...base, externalDueDate: today }, 'p1', today)).toBe(false);
  });

  it('is overdue when the person\'s own review date has passed', () => {
    const d = { ...base, externalDueDate: '2026-10-20', reviewerIds: ['p1'], reviewDates: ['2026-10-10'] };
    expect(isOverdueFor(d, 'p1', today)).toBe(true);
  });

  it('ignores another reviewer\'s passed date', () => {
    const d = { ...base, reviewerIds: ['p2', 'p1'], reviewDates: ['2026-10-01', '2026-10-15'] };
    expect(isOverdueFor(d, 'p1', today)).toBe(false);
  });

  it('uses the latest date for a reviewer listed twice', () => {
    const d = { ...base, reviewerIds: ['p1', 'p2', 'p1'], reviewDates: ['2026-10-01', '2026-10-05', '2026-10-15'] };
    expect(isOverdueFor(d, 'p1', today)).toBe(false);
  });

  it('is not overdue with no dates at all', () => {
    expect(isOverdueFor({ ...base, reviewerIds: ['p1'], reviewDates: [null] }, 'p1', today)).toBe(false);
  });
});
