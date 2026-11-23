import { describe, it, expect } from 'vitest';
import { derivePalette, parseHex, luminance } from './palette';

describe('parseHex', () => {
  it('accepts six-digit hex with and without the hash', () => {
    expect(parseHex('#26333f', 'x')).toEqual({ r: 0x26, g: 0x33, b: 0x3f });
    expect(parseHex('26333f', 'x')).toEqual({ r: 0x26, g: 0x33, b: 0x3f });
  });

  it('expands three-digit shorthand', () => {
    expect(parseHex('#abc', 'x')).toEqual({ r: 0xaa, g: 0xbb, b: 0xcc });
  });

  it('names the offending setting when it throws', () => {
    // A branding row is admin-editable; the error has to say which field to fix.
    expect(() => parseHex('navy', 'branding.palette.primary'))
      .toThrow(/branding\.palette\.primary/);
  });
});

describe('derivePalette', () => {
  const p = derivePalette('#26333f', '#8a7c53');

  it('keeps the two configured colours verbatim', () => {
    expect(p.primary).toBe('#26333f');
    expect(p.accent).toBe('#8a7c53');
  });

  it('ramps the primary from deep to faint', () => {
    const steps = [p.primaryDeep, p.primaryStrong, p.primary, p.primaryMid, p.primarySoft, p.primaryFaint];
    const lums = steps.map(luminance);
    for (let i = 1; i < lums.length; i++) {
      expect(lums[i]).toBeGreaterThan(lums[i - 1]);
    }
  });

  it('tints the paper from the accent, so a cool brand gets cool stock', () => {
    // Not a fixed cream: the surfaces have to follow whatever the firm configured.
    const warm = derivePalette('#26333f', '#8a7c53');
    const cool = derivePalette('#26333f', '#3f6f8a');
    expect(warm.surface).not.toBe(cool.surface);
    // Still near-white, or body text stops being readable on it.
    expect(luminance(warm.surface)).toBeGreaterThan(0.8);
    expect(luminance(cool.surface)).toBeGreaterThan(0.8);
  });

  it('keeps the page tint lighter than the cover surface', () => {
    expect(luminance(p.surfacePage)).toBeGreaterThan(luminance(p.surface));
    expect(luminance(p.surface)).toBeGreaterThan(luminance(p.surfaceDeep));
  });

  it('leaves the neutral inks untinted — body copy is not brand identity', () => {
    const other = derivePalette('#7a1030', '#2f8f6a');
    expect(other.ink).toBe(p.ink);
    expect(other.inkSoft).toBe(p.inkSoft);
    expect(other.inkMuted).toBe(p.inkMuted);
    expect(other.white).toBe('#ffffff');
  });

  it('produces reversible white-on-primary contrast for a dark primary', () => {
    // The cover panel reverses the wordmark out of the primary.
    expect(luminance(p.primary)).toBeLessThan(0.2);
  });
});
