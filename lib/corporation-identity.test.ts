import { describe, it, expect } from 'vitest';
import { applySavedPerson, dedupePeople, groupPeople, personIdClusters } from './corporation-identity';
import type { CorporationPerson } from '@/types/corporations';

// Grouping reads only the record id, names and the juridical flag; build
// minimal rows and cast through unknown rather than spelling out every column.
function role(
  id: number,
  personRecordId: string | null,
  firstName: string,
  lastName: string,
  extra: Partial<CorporationPerson> = {},
): CorporationPerson {
  return { id, personRecordId, firstName, lastName, isJuridical: false, role: 'Director', ...extra } as unknown as CorporationPerson;
}

describe('groupPeople', () => {
  it('groups rows by the person record, not by name', () => {
    const groups = groupPeople([
      role(1, 'p1', 'Juan', 'Cruz', { role: 'Incorporator' }),
      role(2, 'p1', 'Juan', 'Cruz', { role: 'Director' }),
      role(3, 'p2', 'Juan', 'Cruz', { role: 'Stockholder' }),
    ]);
    expect(groups.map((g) => g.roles.map((r) => r.id))).toEqual([[1, 2], [3]]);
  });

  it('keeps an unsaved row on its own', () => {
    expect(groupPeople([role(1, null, 'Juan', 'Cruz'), role(2, null, 'Juan', 'Cruz')])).toHaveLength(2);
  });
});

describe('dedupePeople', () => {
  it('offers each person once', () => {
    const people = [role(1, 'p1', 'Juan', 'Cruz'), role(2, 'p1', 'Juan', 'Cruz'), role(3, 'p2', 'Maria', 'Santos')];
    expect(dedupePeople(people).map((p) => p.id)).toEqual([1, 3]);
  });

  it('skips people with no name', () => {
    expect(dedupePeople([role(1, 'p1', '', ''), role(2, 'p2', 'Juan', 'Cruz')])).toHaveLength(1);
  });

  it('names a juridical holder by its entity name', () => {
    const corp = role(1, 'p1', '', '', { isJuridical: true, entityName: 'Holdco Inc.' });
    expect(dedupePeople([corp])).toHaveLength(1);
  });
});

describe('personIdClusters', () => {
  it('maps every role id to the ids of all the same person’s roles', () => {
    const clusters = personIdClusters([role(1, 'p1', 'Juan', 'Cruz'), role(2, 'p1', 'Juan', 'Cruz'), role(3, 'p2', 'Maria', 'Santos')]);
    expect(clusters.get(1)).toEqual([1, 2]);
    expect(clusters.get(2)).toEqual([1, 2]);
    expect(clusters.get(3)).toEqual([3]);
  });
});

describe('applySavedPerson', () => {
  it('carries the saved details onto the person’s other roles, and only theirs', () => {
    const prev = [
      role(1, 'p1', 'Juan', 'Cruz', { tin: null, sharesSubscribedAmount: 100 }),
      role(2, 'p1', 'Juan', 'Cruz', { tin: null, role: 'President' }),
      role(3, 'p2', 'Maria', 'Santos', { tin: null }),
    ];
    const saved = role(2, 'p1', 'Juan', 'Cruz', { tin: '123', role: 'President' });
    const next = applySavedPerson(prev, saved);
    expect(next.map((p) => p.tin)).toEqual(['123', '123', null]);
    expect(next[0].sharesSubscribedAmount).toBe(100);
    expect(next[0].role).toBe('Director');
  });

  it('appends a new role', () => {
    const next = applySavedPerson([role(1, 'p1', 'Juan', 'Cruz')], role(9, 'p1', 'Juan', 'Cruz', { role: 'Treasurer' }));
    expect(next.map((p) => p.id)).toEqual([1, 9]);
  });
});
