import { describe, it, expect } from 'vitest';
import { buildCapitalStructure, dedupeHoldings, isFilipino, type ShareClass } from './capital-structure';
import type { CorporationPerson } from '@/types/corporations';

let nextId = 1;
function holder(over: Partial<CorporationPerson> = {}): CorporationPerson {
  return {
    id: nextId++,
    role: 'Stockholder',
    firstName: 'A',
    lastName: String(nextId),
    nationality: 'Filipino',
    tin: null,
    isJuridical: false,
    entityName: null,
    shareClass: 'Common',
    sharesSubscribedCount: null,
    sharesSubscribedAmount: null,
    sharesPaidAmount: null,
    ...over,
  } as CorporationPerson;
}

const cls = (over: Partial<ShareClass> = {}): ShareClass => ({
  id: 1,
  corporationId: 'c1',
  className: 'Common',
  parValue: 100,
  authorizedShares: 3000,
  sortOrder: 0,
  ...over,
});

describe('isFilipino', () => {
  it('accepts the spellings the firm actually types', () => {
    for (const n of ['Filipino', 'filipino', ' Filipina ', 'Philippine', 'Philippines']) {
      expect(isFilipino(n)).toBe(true);
    }
  });

  it('treats every other nationality as foreign', () => {
    for (const n of ['American', 'Japanese', null, undefined, '']) {
      expect(isFilipino(n)).toBe(false);
    }
  });
});

describe('authorized capital', () => {
  it('multiplies shares by par value per class', () => {
    const s = buildCapitalStructure(
      [cls(), cls({ id: 2, className: 'Preferred', parValue: 50, authorizedShares: 200, sortOrder: 1 })],
      [],
    );
    expect(s.authorized.map((r) => r.amount)).toEqual([300000, 10000]);
    expect(s.authorizedTotal).toBe(310000);
  });

  it('orders classes by sort order, not insertion', () => {
    const s = buildCapitalStructure(
      [cls({ id: 2, className: 'Preferred', sortOrder: 1 }), cls({ className: 'Common', sortOrder: 0 })],
      [],
    );
    expect(s.authorized.map((r) => r.className)).toEqual(['Common', 'Preferred']);
  });

  it('totals what it knows rather than reporting zero', () => {
    const s = buildCapitalStructure(
      [cls(), cls({ id: 2, className: 'Preferred', parValue: null, authorizedShares: null, sortOrder: 1 })],
      [],
    );
    expect(s.authorizedTotal).toBe(300000);
  });

  it('reports null when nothing is known', () => {
    expect(buildCapitalStructure([cls({ parValue: null, authorizedShares: null })], []).authorizedTotal)
      .toBeNull();
  });
});

describe('dedupeHoldings', () => {
  it('counts a multi-role person once', () => {
    // The same human is recorded as Incorporator, Director and President —
    // summing the table directly would treble their shares on a filed form.
    const rows = [
      holder({ role: 'Incorporator', tin: '123', sharesSubscribedAmount: 45000 }),
      holder({ role: 'Director', tin: '123', sharesSubscribedAmount: 45000 }),
      holder({ role: 'President', tin: '123', sharesSubscribedAmount: 45000 }),
    ];
    expect(dedupeHoldings(rows)).toHaveLength(1);
  });

  it('falls back to name when there is no TIN', () => {
    const rows = [
      holder({ firstName: 'Mary', lastName: 'Cruz', tin: null, sharesSubscribedAmount: 10 }),
      holder({ firstName: 'Mary', lastName: 'Cruz', tin: null, sharesSubscribedAmount: 10 }),
    ];
    expect(dedupeHoldings(rows)).toHaveLength(1);
  });

  it('ignores people who hold nothing', () => {
    expect(dedupeHoldings([holder({ tin: '9', sharesSubscribedAmount: null })])).toHaveLength(0);
  });

  it('keeps distinct people apart', () => {
    const rows = [
      holder({ tin: '1', sharesSubscribedAmount: 10 }),
      holder({ tin: '2', sharesSubscribedAmount: 10 }),
    ];
    expect(dedupeHoldings(rows)).toHaveLength(2);
  });
});

describe('subscribed and paid-up', () => {
  const people = [
    holder({ tin: '1', nationality: 'Filipino', sharesSubscribedAmount: 60000, sharesPaidAmount: 30000, sharesSubscribedCount: 600 }),
    holder({ tin: '2', nationality: 'Filipino', sharesSubscribedAmount: 20000, sharesPaidAmount: 20000, sharesSubscribedCount: 200 }),
    holder({ tin: '3', nationality: 'Japanese', sharesSubscribedAmount: 20000, sharesPaidAmount: 10000, sharesSubscribedCount: 200 }),
  ];

  it('splits Filipino from foreign', () => {
    const s = buildCapitalStructure([cls()], people);
    expect(s.subscribed.filipino).toHaveLength(1);
    expect(s.subscribed.foreign).toHaveLength(1);
    expect(s.subscribed.foreign[0].nationality).toBe('Japanese');
  });

  it('aggregates stockholder count, shares and amount per line', () => {
    const s = buildCapitalStructure([cls()], people);
    const fil = s.subscribed.filipino[0];
    expect(fil.stockholders).toBe(2);
    expect(fil.shares).toBe(800);
    expect(fil.amount).toBe(80000);
  });

  it('computes percentages against the section total', () => {
    const s = buildCapitalStructure([cls()], people);
    expect(s.subscribed.total).toBe(100000);
    expect(s.subscribed.filipino[0].percent).toBe(80);
    expect(s.subscribed.foreign[0].percent).toBe(20);
  });

  it('derives paid-up separately from subscribed', () => {
    const s = buildCapitalStructure([cls()], people);
    expect(s.paidUp.total).toBe(60000);
    expect(s.subscribed.total).not.toBe(s.paidUp.total);
  });

  it('reports foreign equity for the ownership cap', () => {
    expect(buildCapitalStructure([cls()], people).foreignEquityPercent).toBe(20);
    expect(buildCapitalStructure([cls()], []).foreignEquityPercent).toBe(0);
  });

  it('separates share classes within one nationality', () => {
    const s = buildCapitalStructure(
      [cls(), cls({ id: 2, className: 'Preferred', parValue: 50, sortOrder: 1 })],
      [
        holder({ tin: '1', shareClass: 'Common', sharesSubscribedAmount: 100 }),
        holder({ tin: '2', shareClass: 'Preferred', sharesSubscribedAmount: 50 }),
      ],
    );
    expect(s.subscribed.filipino.map((r) => r.className).sort()).toEqual(['Common', 'Preferred']);
  });

  it('carries the par value of the class onto each line', () => {
    const s = buildCapitalStructure([cls({ parValue: 100 })], [holder({ tin: '1', sharesSubscribedAmount: 100 })]);
    expect(s.subscribed.filipino[0].parValue).toBe(100);
  });

  it('falls back to the first class when a holding names none', () => {
    const s = buildCapitalStructure([cls()], [holder({ tin: '1', shareClass: null, sharesSubscribedAmount: 100 })]);
    expect(s.subscribed.filipino[0].className).toBe('Common');
  });

  it('labels a missing nationality rather than guessing Filipino', () => {
    const s = buildCapitalStructure([cls()], [holder({ tin: '1', nationality: null, sharesSubscribedAmount: 100 })]);
    expect(s.subscribed.foreign[0].nationality).toBe('Unspecified');
  });
});
