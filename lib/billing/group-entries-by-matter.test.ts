import { describe, it, expect } from 'vitest';
import { groupEntriesByMatter, hasMatterHeadings, matterLabel } from './group-entries-by-matter';
import type { LawyerEntry } from '@/lib/billing/breakdown-types';

function entry(over: Partial<LawyerEntry>): LawyerEntry {
  return {
    date: '2026-03-05',
    hours: 1.8,
    description: 'Review and Revise',
    hourlyRate: 5000,
    ...over,
  };
}

describe('matterLabel', () => {
  it('renders "[code] name" when the matter has a code', () => {
    expect(matterLabel(entry({ matterId: 'm1', matterCode: '40-20-15', matterName: 'People v. Dela Cruz' })))
      .toBe('[40-20-15] People v. Dela Cruz');
  });

  it('falls back to the bare name without a code', () => {
    expect(matterLabel(entry({ matterId: 'm1', matterName: 'People v. Dela Cruz' })))
      .toBe('People v. Dela Cruz');
  });

  it('labels a matter it can only identify by id', () => {
    expect(matterLabel(entry({ matterId: 'm1' }))).toBe('General');
  });

  it('gives no label at all when there is no matter', () => {
    expect(matterLabel(entry({}))).toBeNull();
  });
});

describe('groupEntriesByMatter', () => {
  it('groups by matter and orders by code', () => {
    const groups = groupEntriesByMatter([
      entry({ matterId: 'b', matterCode: '40-20-18', matterName: 'People v. Dela Cruz', description: 'Internal Discussion' }),
      entry({ matterId: 'a', matterCode: '40-20-15', matterName: 'People v. Dela Cruz', description: 'Review and Revise' }),
      entry({ matterId: 'b', matterCode: '40-20-18', matterName: 'People v. Dela Cruz', description: 'Internal Discussion 2' }),
    ]);

    expect(groups.map((g) => g.label)).toEqual([
      '[40-20-15] People v. Dela Cruz',
      '[40-20-18] People v. Dela Cruz',
    ]);
    expect(groups[1].entries.map((e) => e.description)).toEqual([
      'Internal Discussion',
      'Internal Discussion 2',
    ]);
  });

  it('orders codes numerically, not lexicographically', () => {
    const groups = groupEntriesByMatter([
      entry({ matterId: 'c', matterCode: '40-20-100', matterName: 'X' }),
      entry({ matterId: 'a', matterCode: '40-20-9', matterName: 'X' }),
    ]);
    expect(groups.map((g) => g.label)).toEqual(['[40-20-9] X', '[40-20-100] X']);
  });

  it('keeps matterless entries last, under no heading', () => {
    const groups = groupEntriesByMatter([
      entry({ description: 'no matter' }),
      entry({ matterId: 'a', matterCode: '01-20-1', matterName: 'A' }),
    ]);
    expect(groups.map((g) => g.label)).toEqual(['[01-20-1] A', null]);
  });

  it('returns one unlabelled group for legacy entries with no matter data', () => {
    const groups = groupEntriesByMatter([entry({}), entry({ description: 'second' })]);
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBeNull();
    expect(groups[0].entries).toHaveLength(2);
    expect(hasMatterHeadings(groups)).toBe(false);
  });

  it('preserves every entry exactly once', () => {
    const input = [
      entry({ matterId: 'a', matterName: 'A' }),
      entry({ matterId: 'b', matterName: 'B' }),
      entry({}),
      entry({ matterId: 'a', matterName: 'A' }),
    ];
    const flattened = groupEntriesByMatter(input).flatMap((g) => g.entries);
    expect(flattened).toHaveLength(input.length);
    expect(new Set(flattened)).toEqual(new Set(input));
  });
});
