import { describe, expect, it } from 'vitest';
import { billingLetterSigner, positionForSigner } from './signer';

const roster = [
  { name: 'Andres Miguel Santos', position: 'Managing Partner' },
  { name: 'Maria Clara Reyes', position: 'Partner' },
  { name: 'Ana Cruz', position: 'Associate' },
  { name: 'Ana  Cruz', position: 'Paralegal' },
];

describe('positionForSigner', () => {
  it('matches a signer typed in capitals with a middle initial', () => {
    expect(positionForSigner('ANDRES MIGUEL B. SANTOS', roster)).toBe('Managing Partner');
    expect(positionForSigner('Maria Clara L. Reyes', roster)).toBe('Partner');
  });

  it('gives no position when nobody, or more than one person, matches', () => {
    expect(positionForSigner('Maria Santos', roster)).toBeUndefined();
    expect(positionForSigner('ANA CRUZ', roster)).toBeUndefined();
  });
});

describe('billingLetterSigner', () => {
  const firm = [
    { name: 'Maria Clara Reyes', position: 'Managing Partner', active: true },
    { name: 'Andres Miguel Santos', position: 'Partner', active: true },
  ];

  it('is the Managing Partner, whatever the firm setting says', () => {
    expect(billingLetterSigner(firm, 'ANDRES MIGUEL B. SANTOS')).toEqual({ name: 'Maria Clara Reyes', position: 'Managing Partner' });
  });

  it('ignores a former Managing Partner who has left', () => {
    const roster = [{ name: 'Old Head', position: 'Managing Partner', active: false }, ...firm];
    expect(billingLetterSigner(roster, undefined)?.name).toBe('Maria Clara Reyes');
  });

  it('falls back to the firm setting when the roster has no single Managing Partner', () => {
    const noMp = firm.map((r) => ({ ...r, position: 'Partner' }));
    expect(billingLetterSigner(noMp, 'ANDRES MIGUEL B. SANTOS')).toEqual({ name: 'ANDRES MIGUEL B. SANTOS', position: 'Partner' });
    expect(billingLetterSigner(noMp, '')).toBeNull();
  });
});
