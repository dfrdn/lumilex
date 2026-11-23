import { describe, it, expect } from 'vitest';
import {
  normalizeCorporateName,
  matchesExpectedName,
  autoAppliesOnUpload,
  isExtractable,
  cleanField,
  hasAnyField,
  EXTRACTABLE_CATEGORIES,
} from './corporation-doc-extract';

describe('normalizeCorporateName', () => {
  it('ignores punctuation and case', () => {
    expect(normalizeCorporateName('Tritone Entertainment Management, Inc.')).toBe(
      normalizeCorporateName('tritone entertainment management inc'),
    );
  });

  it('folds suffix spellings', () => {
    expect(normalizeCorporateName('Acme Incorporated')).toBe(normalizeCorporateName('Acme Inc.'));
    expect(normalizeCorporateName('Acme Corporation')).toBe(normalizeCorporateName('Acme Corp.'));
  });

  it("keeps a leading apostrophe'd name intact apart from the apostrophe", () => {
    expect(normalizeCorporateName("D'Summit Lumber Corporation")).toBe('dsummit lumber corp');
  });

  it('collapses runs of whitespace', () => {
    expect(normalizeCorporateName('  Sample   Holdings Inc.  ')).toBe('sample holdings inc');
  });

  it('keeps distinct names distinct', () => {
    expect(normalizeCorporateName('Tritone Studios Inc.')).not.toBe(
      normalizeCorporateName('Tritone Multimedia Inc.'),
    );
  });
});

describe('matchesExpectedName', () => {
  it('matches a proposed name through a punctuation change', () => {
    // The real case: SEC approved "…Management, Inc." against a proposal
    // recorded without the comma.
    expect(
      matchesExpectedName('Tritone Entertainment Management, Inc.', [
        null,
        'Tritone Entertainment Management Inc.',
      ]),
    ).toBe(true);
  });

  it('rejects a name nobody was expecting', () => {
    expect(matchesExpectedName('Some Other Holdings Inc.', ['Tritone Studios Inc.'])).toBe(false);
  });

  it('rejects an empty extraction', () => {
    expect(matchesExpectedName('   ', ['Tritone Studios Inc.'])).toBe(false);
  });

  it('ignores empty expectations', () => {
    expect(matchesExpectedName('Sample Holdings Inc.', [null, undefined, ''])).toBe(false);
  });
});

describe('extractable categories', () => {
  it('covers the six registration documents', () => {
    expect(Object.keys(EXTRACTABLE_CATEGORIES).sort()).toEqual([
      'BIR COR',
      'Business Permit',
      'Pag-IBIG EFR',
      'PhilHealth ER1',
      'SEC COR',
      'SSS R-1',
    ]);
  });

  it('does not try to read documents with no structured fields', () => {
    expect(isExtractable('AOI')).toBe(false);
    expect(isExtractable('Other')).toBe(false);
    expect(isExtractable('BIR COR')).toBe(true);
  });

  it('only auto-applies the SEC COR', () => {
    expect(autoAppliesOnUpload('SEC COR')).toBe(true);
    for (const c of ['BIR COR', 'Business Permit', 'SSS R-1', 'PhilHealth ER1', 'Pag-IBIG EFR'] as const) {
      expect(autoAppliesOnUpload(c)).toBe(false);
    }
  });
});

describe('cleanField', () => {
  it('keeps identifiers verbatim', () => {
    expect(cleanField('birTin', ' 483-370-384-000 ')).toBe('483-370-384-000');
  });

  it('rejects a non-ISO date rather than guessing', () => {
    expect(cleanField('birCorDate', '02/05/2022')).toBeNull();
    expect(cleanField('birCorDate', '2022-05-02')).toBe('2022-05-02');
  });

  it('rejects an impossible date', () => {
    expect(cleanField('sssRegistrationDate', '2022-13-45')).toBeNull();
  });

  it('rejects a company type outside the enum', () => {
    expect(cleanField('companyType', 'Sole Proprietorship')).toBeNull();
    expect(cleanField('companyType', 'OPC')).toBe('OPC');
  });

  it('treats the string "null" and blanks as absent', () => {
    expect(cleanField('businessPermitNo', 'null')).toBeNull();
    expect(cleanField('businessPermitNo', '   ')).toBeNull();
    expect(cleanField('businessPermitNo', 42)).toBeNull();
  });
});

describe('hasAnyField', () => {
  const base = { category: 'BIR COR' as const, isExpectedDocument: true, notes: '' };

  it('is false when nothing could be read', () => {
    expect(hasAnyField({ ...base, fields: { birTin: null, birRdoCode: null, birCorDate: null } })).toBe(false);
  });

  it('is true on a partial read', () => {
    expect(hasAnyField({ ...base, fields: { birTin: '483-370-384-000', birRdoCode: null, birCorDate: null } })).toBe(true);
  });
});

