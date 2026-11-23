import { describe, it, expect } from 'vitest';
import { annexLetter, isAnnexFile } from './annexes';

describe('annexLetter', () => {
  it('maps the first 26 indices to A–Z', () => {
    expect(annexLetter(0)).toBe('A');
    expect(annexLetter(1)).toBe('B');
    expect(annexLetter(25)).toBe('Z');
  });

  it('rolls over bijectively past Z (no stray symbols like "[")', () => {
    expect(annexLetter(26)).toBe('AA');
    expect(annexLetter(27)).toBe('AB');
    expect(annexLetter(51)).toBe('AZ');
    expect(annexLetter(52)).toBe('BA');
  });

  it('floors fractional indices', () => {
    expect(annexLetter(0.9)).toBe('A');
    expect(annexLetter(26.4)).toBe('AA');
  });
});

describe('isAnnexFile', () => {
  it('matches the "Annex {LETTER} - " naming scheme', () => {
    expect(isAnnexFile('Annex A - Board Resolution.pdf')).toBe(true);
    expect(isAnnexFile('Annex AB - Secretary Certificate.docx')).toBe(true);
  });

  it('rejects names that do not start with the annex prefix', () => {
    expect(isAnnexFile('My Annex A - copy.pdf')).toBe(false);
    expect(isAnnexFile('annex a - lowercase.pdf')).toBe(false);
    expect(isAnnexFile('Annex 1 - numbered.pdf')).toBe(false);
    expect(isAnnexFile('Board Resolution.pdf')).toBe(false);
  });

  it('handles null/undefined/empty', () => {
    expect(isAnnexFile(null)).toBe(false);
    expect(isAnnexFile(undefined)).toBe(false);
    expect(isAnnexFile('')).toBe(false);
  });
});
