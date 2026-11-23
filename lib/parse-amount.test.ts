import { describe, it, expect } from 'vitest';
import { parseAmount, parseCount } from './parse-amount';

describe('parseAmount', () => {
  it('parses plain numbers', () => {
    expect(parseAmount('1000000')).toBe(1_000_000);
    expect(parseAmount('1.5')).toBe(1.5);
  });

  it('strips comma grouping', () => {
    expect(parseAmount('1,000,000')).toBe(1_000_000);
    expect(parseAmount('12,345.67')).toBe(12_345.67);
  });

  it('strips peso sign and whitespace', () => {
    expect(parseAmount('₱1,500.50')).toBe(1_500.5);
    expect(parseAmount(' 25 ')).toBe(25);
  });

  it('returns null for empty or garbage input', () => {
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('   ')).toBeNull();
    expect(parseAmount(null)).toBeNull();
    expect(parseAmount(undefined)).toBeNull();
    expect(parseAmount('abc')).toBeNull();
    expect(parseAmount('1,00a')).toBeNull();
  });

  it('never returns NaN', () => {
    expect(Number.isNaN(parseAmount('N/A'))).toBe(false);
  });
});

describe('parseCount', () => {
  it('rounds to integer', () => {
    expect(parseCount('1,000.6')).toBe(1001);
    expect(parseCount('250')).toBe(250);
    expect(parseCount('')).toBeNull();
  });
});
