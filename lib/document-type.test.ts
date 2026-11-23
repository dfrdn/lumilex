import { describe, it, expect } from 'vitest';
import { DOCUMENT_TYPES, normalizeDocumentType } from './document-type';

describe('normalizeDocumentType', () => {
  it('returns null when the analysis recorded nothing', () => {
    expect(normalizeDocumentType(null)).toBeNull();
    expect(normalizeDocumentType(undefined)).toBeNull();
    expect(normalizeDocumentType('')).toBeNull();
    expect(normalizeDocumentType('   ')).toBeNull();
  });

  it('maps the common raw values onto the vocabulary', () => {
    const cases: Array<[string, string]> = [
      ['order', 'Order / Writ'],
      ['Writ of Execution', 'Order / Writ'],
      ['warrant of arrest', 'Order / Writ'],
      ['decision', 'Decision'],
      ['judgment', 'Decision'],
      ['judgement', 'Decision'],
      ['resolution', 'Resolution'],
      ['subpoena', 'Summons / Subpoena'],
      ['return of summons', 'Summons / Subpoena'],
      ["sheriff's return", 'Summons / Subpoena'],
      ['motion', 'Motion / Manifestation'],
      ['manifestation', 'Motion / Manifestation'],
      ['compliance', 'Motion / Manifestation'],
      ['entry of appearance', 'Motion / Manifestation'],
      ['formal offer of evidence', 'Motion / Manifestation'],
      ['complaint', 'Pleading'],
      ['answer', 'Pleading'],
      ['reply', 'Pleading'],
      ['rejoinder', 'Pleading'],
      ['petition', 'Pleading'],
      ['comment', 'Pleading'],
      ['opposition', 'Pleading'],
      ['position paper', 'Pleading'],
      ['pre-trial brief', 'Pleading'],
      ['appeal memorandum', 'Pleading'],
      ['information', 'Pleading'],
      ['affidavit', 'Affidavit'],
      ['complaint-affidavit', 'Affidavit'],
      ['counter-affidavit', 'Affidavit'],
      ['reply-affidavit', 'Affidavit'],
      ['letter', 'Letter'],
      ['demand letter', 'Letter'],
      ['transmittal', 'Letter'],
      ['notice', 'Notice'],
      ['certificate', 'Certificate'],
      ['construction clearance', 'Certificate'],
      ['report', 'Report'],
      ['status report', 'Report'],
      ['minutes', 'Report'],
      ['contract', 'Contract / Deed'],
      ['compromise agreement', 'Contract / Deed'],
      ['quitclaim', 'Contract / Deed'],
      ['special power of attorney', 'Power of Attorney'],
      ['power_of_attorney', 'Power of Attorney'],
      ['authorization letter', 'Power of Attorney'],
      ['transcript', 'Transcript'],
      ['receipt', 'Receipt / Payment'],
      ['disbursement voucher', 'Receipt / Payment'],
      ['acknowledgment receipt', 'Receipt / Payment'],
    ];
    for (const [raw, expected] of cases) {
      expect(normalizeDocumentType(raw), raw).toBe(expected);
    }
  });

  it('uses the first kind when the model lists several', () => {
    expect(normalizeDocumentType('letter|notice')).toBe('Letter');
    expect(normalizeDocumentType('status report|letter')).toBe('Report');
    expect(normalizeDocumentType('investigation report; notice of inquest')).toBe('Report');
    expect(normalizeDocumentType('release|waiver|quitclaim')).toBe('Contract / Deed');
  });

  it('is case- and whitespace-insensitive', () => {
    expect(normalizeDocumentType('  ORDER  ')).toBe('Order / Writ');
    expect(normalizeDocumentType('Special Power of Attorney')).toBe('Power of Attorney');
  });

  it('falls back to Other for values outside the vocabulary', () => {
    expect(normalizeDocumentType('other')).toBe('Other');
    expect(normalizeDocumentType('mugshot')).toBe('Other');
    expect(normalizeDocumentType('court calendar')).toBe('Other');
    expect(normalizeDocumentType('intake form')).toBe('Other');
  });

  it('only ever returns a member of the vocabulary', () => {
    const samples = ['order', 'letter|motion', 'privacy policy', 'tax return|tax declaration|report', 'bond', 'will'];
    for (const s of samples) {
      const t = normalizeDocumentType(s);
      expect(t === null || (DOCUMENT_TYPES as readonly string[]).includes(t), s).toBe(true);
    }
  });
});
