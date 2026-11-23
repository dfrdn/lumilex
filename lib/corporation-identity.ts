import type { CorporationPerson } from '@/types/corporations';

/**
 * A person holds one CorporationPerson row per role (Juan as Incorporator,
 * Director and President is three rows). The rows of one person share a
 * `personRecordId` — the database decides who is who (match_person), so these
 * helpers only group by it. A row not yet saved, with no record id, stands
 * alone.
 */

const keyOf = (p: CorporationPerson) => p.personRecordId ?? `row:${p.id}`;

export interface PersonGroup {
  key: string;
  /** The person's details — the same on every one of their rows. */
  person: CorporationPerson;
  roles: CorporationPerson[];
}

/** One group per person, in the order each first appears. */
export function groupPeople(people: CorporationPerson[]): PersonGroup[] {
  const groups = new Map<string, PersonGroup>();
  for (const p of people) {
    const k = keyOf(p);
    const g = groups.get(k);
    if (g) g.roles.push(p);
    else groups.set(k, { key: k, person: p, roles: [p] });
  }
  return [...groups.values()];
}

/** One row per named person — for pickers, so nobody is offered twice. */
export function dedupePeople(people: CorporationPerson[]): CorporationPerson[] {
  return groupPeople(people)
    .map((g) => g.person)
    .filter((p) => (p.isJuridical ? !!p.entityName?.trim() : !!(p.firstName.trim() || p.lastName.trim())));
}

/**
 * Role id → the ids of every role the same person holds (itself included).
 * Files attach to one role and show on all of them.
 */
export function personIdClusters(people: CorporationPerson[]): Map<number, number[]> {
  const m = new Map<number, number[]>();
  for (const g of groupPeople(people)) {
    const ids = g.roles.map((r) => r.id);
    for (const id of ids) m.set(id, ids);
  }
  return m;
}

const DETAIL_FIELDS = [
  'personRecordId', 'isJuridical', 'firstName', 'lastName', 'nationality', 'gender', 'residentialAddress', 'tin',
  'passportNumber', 'esapNo', 'entityName', 'entityType', 'entityRegistrationNo', 'representativeName', 'representativeTitle',
] as const satisfies readonly (keyof CorporationPerson)[];

/**
 * Fold a saved row into a list: replace (or append) it, and carry its
 * person's details onto their other roles, since an edit to one role's
 * details is an edit to the person.
 */
export function applySavedPerson(prev: CorporationPerson[], saved: CorporationPerson): CorporationPerson[] {
  const details = Object.fromEntries(DETAIL_FIELDS.map((f) => [f, saved[f]])) as Partial<CorporationPerson>;
  const exists = prev.some((p) => p.id === saved.id);
  const next = prev.map((p) => {
    if (p.id === saved.id) return saved;
    return saved.personRecordId && p.personRecordId === saved.personRecordId ? { ...p, ...details } : p;
  });
  return exists ? next : [...next, saved];
}
