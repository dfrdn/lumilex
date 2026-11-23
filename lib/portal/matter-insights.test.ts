import { describe, it, expect } from 'vitest';
import {
  computeMatterStats,
  computePortalGroups,
  computeWorkDelivered,
  groupMembershipIndex,
  portalStatusLabel,
  type PortalMatterLike,
} from './matter-insights';

function matter(overrides: Partial<PortalMatterLike> & { notion_id: string }): PortalMatterLike {
  return {
    name: overrides.notion_id,
    matter_code: null,
    status: null,
    outcome: null,
    is_case: false,
    related_matter_ids: null,
    parent_matter_id: null,
    ...overrides,
  };
}

describe('computeMatterStats', () => {
  it('counts statuses, outcomes, and court cases', () => {
    const stats = computeMatterStats([
      matter({ notion_id: 'a', status: 'Ongoing', is_case: true }),
      matter({ notion_id: 'b', status: 'Done', outcome: 'Win', is_case: true }),
      matter({ notion_id: 'c', status: 'Done', outcome: 'Settled' }),
      matter({ notion_id: 'd', status: 'Archived', outcome: 'Loss', is_case: true }),
      matter({ notion_id: 'e', status: 'Archived', outcome: 'Terminated' }),
      matter({ notion_id: 'f', status: 'Ongoing', outcome: '' }),
    ]);
    expect(stats.total).toBe(6);
    expect(stats.active).toBe(2);
    expect(stats.concluded).toBe(4);
    expect(stats.courtCases).toBe(3);
    expect(stats.outcomes).toEqual({ Win: 1, Settled: 1, Terminated: 1, Loss: 1 });
    expect(stats.decided).toBe(4);
    expect(stats.favorable).toBe(2);
  });

  it('ignores unknown outcome strings', () => {
    const stats = computeMatterStats([matter({ notion_id: 'a', outcome: 'Pending' })]);
    expect(stats.decided).toBe(0);
  });
});

describe('computePortalGroups', () => {
  it('builds connected components across related ids and parent links', () => {
    const groups = computePortalGroups([
      matter({ notion_id: 'a', related_matter_ids: ['b'] }),
      matter({ notion_id: 'b' }),
      matter({ notion_id: 'c', parent_matter_id: 'b' }),
      matter({ notion_id: 'd' }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].memberIds).toEqual(['a', 'b', 'c']);
    expect(groups[0].id).toBe('a');
  });

  it('ignores edges pointing at matters outside the visible set', () => {
    const groups = computePortalGroups([
      matter({ notion_id: 'a', related_matter_ids: ['zz-other-client'] }),
      matter({ notion_id: 'b', parent_matter_id: 'zz-hidden' }),
    ]);
    expect(groups).toHaveLength(0);
  });

  it('names the group after the highest matter-code sequence', () => {
    const groups = computePortalGroups([
      matter({ notion_id: 'a', name: 'Original complaint', matter_code: '103-20-1', related_matter_ids: ['b'] }),
      matter({ notion_id: 'b', name: 'Appeal to CA', matter_code: '103-20-4' }),
    ]);
    expect(groups[0].name).toBe('Appeal to CA');
  });

  it('sorts larger groups first', () => {
    const groups = computePortalGroups([
      matter({ notion_id: 'a', related_matter_ids: ['b'] }),
      matter({ notion_id: 'b' }),
      matter({ notion_id: 'c', related_matter_ids: ['d', 'e'] }),
      matter({ notion_id: 'd' }),
      matter({ notion_id: 'e' }),
    ]);
    expect(groups.map((g) => g.memberIds.length)).toEqual([3, 2]);
  });

  it('indexes membership by matter id', () => {
    const groups = computePortalGroups([
      matter({ notion_id: 'a', related_matter_ids: ['b'] }),
      matter({ notion_id: 'b' }),
      matter({ notion_id: 'c' }),
    ]);
    const index = groupMembershipIndex(groups);
    expect(index.get('a')?.id).toBe('a');
    expect(index.get('b')?.id).toBe('a');
    expect(index.has('c')).toBe(false);
  });
});

describe('computeWorkDelivered', () => {
  const now = new Date('2026-07-03T00:00:00Z').getTime();

  it('counts filed deliverables, splitting status reports from filings', () => {
    const result = computeWorkDelivered(
      {
        deliverables: [
          { status: 'Filed or Sent out', type: 'Pleading' },
          { status: 'Filed or Sent out', type: 'Letter' },
          // Not deliverable statuses; the old delivered set carried them.
          { status: 'Filed', type: 'Pleading' },
          { status: 'Sent out', type: 'Letter' },
          { status: 'Filed or Sent out', type: 'Status Report' },
          { status: 'Drafting', type: 'Pleading' },
          { status: null, type: 'Pleading' },
          // Internal work is never the client's, whatever its status.
          { status: 'Filed or Sent out', type: 'Internal' },
        ],
        hearings: [],
        meetings: [],
      },
      now,
    );
    expect(result.filings).toBe(2);
    expect(result.statusReports).toBe(1);
  });

  it('counts past non-cancelled, non-filing hearings as attended', () => {
    const result = computeWorkDelivered(
      {
        deliverables: [],
        hearings: [
          { date: '2026-01-01', type: 'Hearing', status: 'Attended' },
          { date: '2026-02-01', type: '', status: '' },
          { date: '2026-03-01', type: 'Hearing', status: 'Cancelled' },
          { date: '2026-04-01', type: 'Filing', status: '' },
          { date: '2026-12-01', type: 'Hearing', status: 'Scheduled' },
          { date: null, type: 'Hearing', status: '' },
        ],
        meetings: [],
      },
      now,
    );
    expect(result.hearingsAttended).toBe(2);
  });

  it('counts past meetings as held', () => {
    const result = computeWorkDelivered(
      {
        deliverables: [],
        hearings: [],
        meetings: [{ date_start: '2026-01-01' }, { date_start: '2026-12-01' }, { date_start: null }],
      },
      now,
    );
    expect(result.meetingsHeld).toBe(1);
  });
});

describe('portalStatusLabel', () => {
  it('maps internal statuses to client-facing labels', () => {
    expect(portalStatusLabel('Ongoing')).toBe('Active');
    expect(portalStatusLabel('Done')).toBe('Concluded');
    expect(portalStatusLabel('Archived')).toBe('Archived');
    expect(portalStatusLabel('Something Else')).toBe('Something Else');
    expect(portalStatusLabel(null)).toBe('');
  });
});
