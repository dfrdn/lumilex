import { describe, expect, it } from 'vitest';
import { extractCitations } from './juris';

describe('extractCitations', () => {
  it('extracts and normalizes G.R. numbers', () => {
    const { cases } = extractCitations(
      'See G.R. No. 188611 and G. R. Nos. 263590, also GR No. 254972.',
    );
    expect(cases).toEqual(['G.R. No. 188611', 'G.R. No. 263590', 'G.R. No. 254972']);
  });

  it('handles legacy L-prefixed and ranged G.R. numbers', () => {
    const { cases } = extractCitations('People v. Rondina, G.R. No. L-47895; G.R. Nos. 118757-58.');
    expect(cases).toEqual(['G.R. No. L-47895', 'G.R. No. 118757-58']);
  });

  it('splits enumerated G.R. number lists', () => {
    const { cases } = extractCitations('G.R. Nos. 111771, 111772 and 111773 are consolidated.');
    expect(cases).toEqual(['G.R. No. 111771', 'G.R. No. 111772', 'G.R. No. 111773']);
  });

  it('does not fabricate case numbers from pinpoint-citation dates and reporters', () => {
    const { cases } = extractCitations(
      'Ople v. Torres, G.R. No. 127685, 23 July 1998, 293 SCRA 141.',
    );
    expect(cases).toEqual(['G.R. No. 127685']);
  });

  it('never truncates numbers before English words resembling months', () => {
    expect(extractCitations('G.R. Nos. 209271 and 209276 may be consolidated').cases)
      .toEqual(['G.R. No. 209271', 'G.R. No. 209276']);
    expect(extractCitations('G.R. Nos. 111771, 111772 and 111773 decided jointly').cases)
      .toEqual(['G.R. No. 111771', 'G.R. No. 111772', 'G.R. No. 111773']);
  });

  it('rejects bare promulgation years and reporter volumes as continuations', () => {
    expect(extractCitations('G.R. No. 127685, 1998.').cases).toEqual(['G.R. No. 127685']);
    expect(extractCitations('G.R. No. 127685, 293 SCRA 141.').cases).toEqual(['G.R. No. 127685']);
    expect(extractCitations('G.R. No. 158693, 485 Phil. 248.').cases).toEqual(['G.R. No. 158693']);
  });

  it('still splits enumerations followed by a promulgation date', () => {
    const { cases } = extractCitations(
      'G.R. Nos. 132875-76, 133001 and 137050, February 3, 2000.',
    );
    expect(cases).toEqual(['G.R. No. 132875-76', 'G.R. No. 133001', 'G.R. No. 137050']);
  });

  it('extracts A.M. and A.C. numbers', () => {
    const { cases } = extractCitations(
      'In A.M. No. P-03-1726 and A.C. No. 9269, the Court held otherwise. See also A.M. No. RTJ-12-2317.',
    );
    expect(cases).toEqual(['A.M. No. P-03-1726', 'A.C. No. 9269', 'A.M. No. RTJ-12-2317']);
  });

  it('extracts RA citations in all common forms', () => {
    const { ras } = extractCitations(
      'Violations of RA 9165, R.A. No. 11313, and Republic Act No. 7877 were alleged.',
    );
    expect(ras).toEqual(['RA 9165', 'RA 11313', 'RA 7877']);
  });

  it('dedupes repeated citations preserving first-seen order', () => {
    const { cases, ras } = extractCitations(
      'RA 9165 ... G.R. No. 188611 ... RA 9165 again ... G.R. No. 188611 once more.',
    );
    expect(cases).toEqual(['G.R. No. 188611']);
    expect(ras).toEqual(['RA 9165']);
  });

  it('does not match unrelated words containing RA', () => {
    const { ras } = extractCitations('The ERA 2020 report and paragraph 12 mention nothing.');
    expect(ras).toEqual([]);
  });

  it('returns empty arrays for text without citations', () => {
    expect(extractCitations('An ordinary paragraph about a meeting.')).toEqual({
      cases: [],
      ras: [],
    });
  });
});
