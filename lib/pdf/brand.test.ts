import { describe, it, expect } from 'vitest';
import { brandFromConfig } from './brand';
import { NO_BRAND_ASSETS, brandObjectKey } from './brand-assets';
import type { FirmBranding } from '@/lib/firm/config';

const COMPLETE: FirmBranding = {
  nameLines: ['Lumilex', 'Dev Firm'],
  documentName: 'Lumilex Dev Firm',
  tagline: 'Development Tenant',
  logoPath: '',
  logoLightPath: '',
  monogramPath: '',
  monogramLightPath: '',
  palette: { primary: '#26333f', accent: '#8a7c53' },
  fontSet: 'standard',
  letterhead: 'auto',
};

describe('brandFromConfig', () => {
  it('resolves a complete branding row', () => {
    const b = brandFromConfig(COMPLETE);
    expect(b.documentName).toBe('Lumilex Dev Firm');
    expect(b.nameLines).toEqual(['Lumilex', 'Dev Firm']);
    expect(b.palette.primary).toBe('#26333f');
    expect(b.fonts.name).toBe('standard');
  });

  it('renders no mark at all when none is configured', () => {
    // The single-firm kit drew a vector stand-in of its own logo here. On a
    // whitelabel product that puts one firm's mark on another firm's letter.
    const b = brandFromConfig(COMPLETE);
    expect(b.assets).toEqual(NO_BRAND_ASSETS);
    expect(b.assets.monogram).toBeNull();
  });

  it.each([
    ['nameLines', { ...COMPLETE, nameLines: [] }],
    ['nameLines of only blanks', { ...COMPLETE, nameLines: ['  ', ''] }],
    ['documentName', { ...COMPLETE, documentName: '' }],
    ['palette.primary', { ...COMPLETE, palette: { primary: '', accent: '#8a7c53' } }],
    ['palette.accent', { ...COMPLETE, palette: { primary: '#26333f', accent: '' } }],
  ])('throws rather than substituting a default for a missing %s', (_label, branding) => {
    expect(() => brandFromConfig(branding as FirmBranding)).toThrow(/branding/);
  });

  it('throws on an unknown font set instead of silently substituting one', () => {
    expect(() => brandFromConfig({ ...COMPLETE, fontSet: 'garamond-pro' }))
      .toThrow(/Unknown branding\.fontSet/);
  });

  it('reports the peso prefix the resolved faces can actually print', () => {
    // The default set bundles EB Garamond, which carries U+20B1.
    expect(brandFromConfig(COMPLETE).pesoSymbol).toBe('₱');
    // The core PDF fonts are WinAnsi-encoded and have none, so amounts set in
    // them are prefixed "P" rather than dropping a notdef box.
    expect(brandFromConfig({ ...COMPLETE, fontSet: 'core' }).pesoSymbol).toBe('P');
  });
});

describe('brandObjectKey', () => {
  const FIRM = '00000000-0000-4000-8000-000000000001';

  it('resolves against the firm\'s own storage prefix', () => {
    expect(brandObjectKey(FIRM, 'branding/logo.png')).toBe(`${FIRM}/branding/logo.png`);
  });

  it('returns null for an unconfigured slot', () => {
    expect(brandObjectKey(FIRM, '')).toBeNull();
    expect(brandObjectKey(FIRM, '   ')).toBeNull();
  });

  it('refuses a path that climbs out of the prefix', () => {
    // Branding is admin-editable data, not trusted input.
    expect(() => brandObjectKey(FIRM, '../other-firm/logo.png')).toThrow(/traverse/);
  });

  it('refuses a non-image key', () => {
    expect(() => brandObjectKey(FIRM, 'branding/logo.svg')).toThrow(/\.png or \.jpg/);
  });
});
