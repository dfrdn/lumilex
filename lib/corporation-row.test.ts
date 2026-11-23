import { describe, it, expect } from 'vitest';
import {
  effectiveBillingMatterId,
  rowToCorporation,
} from './corporation-row';

describe('effectiveBillingMatterId', () => {
  const base = {
    retainerMatterId: null,
    housekeepingMatterId: null,
    postIncorporationMatterId: null,
    incorporationMatterId: null,
  };

  it('prefers the retainer matter above all others', () => {
    expect(
      effectiveBillingMatterId({
        retainerMatterId: 'ret',
        housekeepingMatterId: 'hk',
        postIncorporationMatterId: 'post',
        incorporationMatterId: 'inc',
      }),
    ).toBe('ret');
  });

  it('falls through the priority chain: housekeeping → post-incorp → incorp', () => {
    expect(effectiveBillingMatterId({ ...base, housekeepingMatterId: 'hk' })).toBe('hk');
    expect(effectiveBillingMatterId({ ...base, postIncorporationMatterId: 'post' })).toBe('post');
    expect(effectiveBillingMatterId({ ...base, incorporationMatterId: 'inc' })).toBe('inc');
  });

  it('returns null when no matter is linked', () => {
    expect(effectiveBillingMatterId(base)).toBeNull();
  });
});

describe('rowToCorporation', () => {
  it('coerces empty/blank DB values to null and computes the billing matter', () => {
    const corp = rowToCorporation({
      id: 7,
      authorized_capital_stock: '1000000',
      par_value: '',
      number_of_shares: 'not-a-number',
      subject: { matter_subjects: [{ matter_id: 'matter-1', scope: 'retainer' }, { matter_id: 'm-hk', scope: 'housekeeping' }] },
    });

    expect(corp.id).toBe('7'); // id is always stringified
    expect(corp.authorizedCapitalStock).toBe(1_000_000); // numeric string → number
    expect(corp.parValue).toBeNull(); // '' → null
    expect(corp.numberOfShares).toBeNull(); // non-numeric → null
    expect(corp.effectiveBillingMatterId).toBe('matter-1');
    expect(corp.housekeepingMatterId).toBe('m-hk');
    expect(corp.isUnderRetainer).toBe(true); // read off the retainer link
  });

  it('refuses a row read without its matter links', () => {
    expect(() => rowToCorporation({ id: 1, retainer_matter_id: 'matter-1' })).toThrow(/CORPORATION_SELECT/);
  });

  it('applies documented defaults for missing fields', () => {
    const corp = rowToCorporation({ id: 1, subject: null });
    expect(corp.handlesIncorporation).toBe(true); // defaults true
    expect(corp.handlesHousekeeping).toBe(false); // defaults false
    expect(corp.fiscalYearEndMonth).toBe(12); // defaults to December
    expect(corp.status).toBe('Pre-Incorporation'); // default status
    expect(corp.proposedNames).toEqual([]); // non-array → []
  });

  it('filters non-strings out of array columns', () => {
    const corp = rowToCorporation({ id: 1, subject: null, proposed_names: ['Acme', 5, null, 'Beta'] });
    expect(corp.proposedNames).toEqual(['Acme', 'Beta']);
  });

  it('keeps only known filings in firmFiles', () => {
    expect(rowToCorporation({ id: 1, subject: null }).firmFiles).toEqual([]);
    expect(rowToCorporation({ id: 1, subject: null, firm_files: ['gis', 'bo', 'permit'] }).firmFiles).toEqual(['gis', 'permit']);
  });
});
