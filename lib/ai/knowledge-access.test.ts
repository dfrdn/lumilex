import { describe, it, expect } from 'vitest';
import { filterVisible, isVisibleTo, type AccessScope } from './knowledge-access';

const scope: AccessScope = { matterIds: new Set(['m-own']), pageIds: new Set(['7']) };

describe('isVisibleTo', () => {
  it('always shows firm-wide sources', () => {
    expect(isVisibleTo({ sourceType: 'file', sourceId: 'f', matterId: 'm-other' }, scope)).toBe(true);
    expect(isVisibleTo({ sourceType: 'file_analysis', sourceId: '1', matterId: null }, scope)).toBe(true);
    expect(isVisibleTo({ sourceType: 'court_rule', sourceId: '12', matterId: null }, scope)).toBe(true);
  });

  it('shows a Library page only when the viewer can read it', () => {
    // A page limited to partners, or still a draft, is not in the viewer's set.
    expect(isVisibleTo({ sourceType: 'kb_page', sourceId: '7', matterId: null }, scope)).toBe(true);
    expect(isVisibleTo({ sourceType: 'kb_page', sourceId: '8', matterId: null }, scope)).toBe(false);
  });

  it('gates matter-scoped sources on the viewer having the matter', () => {
    for (const sourceType of ['deliverable', 'deliverable_version', 'matter', 'matter_summary', 'hearing', 'meeting', 'filing']) {
      expect(isVisibleTo({ sourceType, sourceId: 'x', matterId: 'm-own' }, scope), sourceType).toBe(true);
      expect(isVisibleTo({ sourceType, sourceId: 'x', matterId: 'm-other' }, scope), sourceType).toBe(false);
      expect(isVisibleTo({ sourceType, sourceId: 'x', matterId: null }, scope), sourceType).toBe(false);
    }
  });

  it('treats an unknown source type as matter-scoped', () => {
    expect(isVisibleTo({ sourceType: 'something_new', sourceId: 'x', matterId: 'm-other' }, scope)).toBe(false);
    expect(isVisibleTo({ sourceType: 'something_new', sourceId: 'x', matterId: 'm-own' }, scope)).toBe(true);
  });
});

describe('filterVisible', () => {
  it('keeps order and drops only the hidden rows', () => {
    const rows = [
      { id: 1, sourceType: 'deliverable', sourceId: 'd', matterId: 'm-other' },
      { id: 2, sourceType: 'file', sourceId: 'f', matterId: 'm-other' },
      { id: 3, sourceType: 'hearing', sourceId: 'h', matterId: 'm-own' },
      { id: 4, sourceType: 'kb_page', sourceId: '9', matterId: null },
    ];
    expect(filterVisible(rows, scope).map((r) => r.id)).toEqual([2, 3]);
  });
});
