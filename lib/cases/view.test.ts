import { describe, expect, it } from 'vitest';
import {
  earlierCaptions,
  forumShort,
  hearingOutcome,
  inTreeOrder,
  needsOutcome,
  nextHearing,
  titleProceeding,
  type Hearing,
  type Proceeding,
} from './view';

let n = 0;
function proc(over: Partial<Proceeding>): Proceeding {
  n += 1;
  return {
    id: `p${n}`,
    track: null,
    parentId: null,
    relation: 'original',
    forumType: 'prosecutor',
    courtLevel: null,
    office: '',
    docketNo: null,
    caption: '',
    status: 'active',
    stage: null,
    resolution: null,
    mrDueOn: null,
    filedOn: null,
    resolvedOn: null,
    createdAt: `2026-01-0${n % 9}T00:00:00Z`,
    ...over,
  };
}

const ocp = proc({ id: 'ocp', caption: 'Northwind Power v. Valdez, et al.', status: 'resolved' });
const doj = proc({ id: 'doj', parentId: 'ocp', relation: 'review', forumType: 'doj', caption: 'Northwind Power v. Valdez, et al.', filedOn: '2026-03-01' });
const rtc = proc({ id: 'rtc', parentId: 'ocp', relation: 'information', forumType: 'court', courtLevel: 'rtc', caption: 'People v. Valdez, et al.', filedOn: '2026-02-01' });
const ca65 = proc({ id: 'ca', parentId: 'rtc', relation: 'rule_65', forumType: 'court', courtLevel: 'ca', caption: 'Valdez v. Hon. Judge' });

describe('the tree', () => {
  it('reads parents before children, the DOJ before the court', () => {
    expect(inTreeOrder([rtc, ca65, doj, ocp]).map((x) => [x.proceeding.id, x.depth])).toEqual([
      ['ocp', 0],
      ['doj', 1],
      ['rtc', 1],
      ['ca', 2],
    ]);
  });

  it('titles the case after the court case, never the Rule 65 branch', () => {
    expect(titleProceeding([ocp, doj, rtc, ca65])?.id).toBe('rtc');
  });

  it('lists the captions the case went by earlier', () => {
    expect(earlierCaptions('People v. Valdez, et al.', [ocp, doj, rtc, ca65])).toEqual([
      { forum: 'Prosecutor', caption: 'Northwind Power v. Valdez, et al.' },
      { forum: 'CA', caption: 'Valdez v. Hon. Judge' },
    ]);
  });

  it('names forums briefly', () => {
    expect(forumShort(rtc)).toBe('RTC');
    expect(forumShort(doj)).toBe('DOJ');
  });
});

describe('hearings', () => {
  const now = new Date('2026-10-12T04:00:00Z');
  const h = (over: Partial<Hearing>): Hearing => ({ id: 'h', name: 'Hearing', type: '', attendeeIds: [], matterId: null, matterName: '', date: null, proceedingId: null, status: '', isAttended: false, ...over });

  it('reads an outcome from the status or the attended flag', () => {
    expect(hearingOutcome(h({ status: 'Cancelled', date: '2026-01-01T00:00:00Z' }), now)).toBe('cancelled');
    expect(hearingOutcome(h({ isAttended: true, status: 'Scheduled', date: '2026-01-01T00:00:00Z' }), now)).toBe('attended');
    expect(hearingOutcome(h({ date: '2026-11-01T00:00:00Z' }), now)).toBe('upcoming');
    expect(hearingOutcome(h({ date: '2026-10-01T00:00:00Z' }), now)).toBe('unrecorded');
  });

  it('finds the next hearing to come', () => {
    const list = [h({ id: 'a', date: '2026-12-01T00:00:00Z' }), h({ id: 'b', date: '2026-10-20T00:00:00Z' }), h({ id: 'c', date: '2026-10-20T00:00:00Z', status: 'Cancelled' })];
    expect(nextHearing(list, now)?.id).toBe('b');
  });

  it('asks for outcomes only of recent hearings', () => {
    const list = [h({ id: 'recent', date: '2026-10-01T00:00:00Z' }), h({ id: 'old', date: '2025-01-01T00:00:00Z' }), h({ id: 'done', date: '2026-10-05T00:00:00Z', isAttended: true })];
    expect(needsOutcome(list, now).map((x) => x.id)).toEqual(['recent']);
  });
});
