/**
 * The shape of a firm's web identity, and the pure functions over it.
 *
 * Deliberately free of server imports: the brand rides to the browser through
 * a React context, so the client bundle needs `WebBrand` and the neutral default
 * without dragging in the storage reader (and, through it, `fs`). The loaders
 * that actually touch Supabase live in `web-brand.ts`, which is server-only.
 */

import type { FirmBranding } from '@/lib/firm/config';

/** The platform's own name — used only when no firm is resolved at all. */
export const PLATFORM_NAME = 'Lumilex';

export type BrandSlot = 'logo' | 'logo-light' | 'monogram' | 'monogram-light';

export const BRAND_SLOTS: readonly BrandSlot[] = [
  'logo',
  'logo-light',
  'monogram',
  'monogram-light',
];

export function isBrandSlot(value: string): value is BrandSlot {
  return (BRAND_SLOTS as readonly string[]).includes(value);
}

/**
 * The configured path for a slot. The `-light` variants fall back to their dark
 * counterpart — a firm whose mark reads on both grounds configures one file —
 * but nothing falls back across firms, and an unconfigured slot stays blank.
 */
export function brandSlotPath(branding: FirmBranding, slot: BrandSlot): string {
  switch (slot) {
    case 'logo':
      return branding.logoPath;
    case 'logo-light':
      return branding.logoLightPath || branding.logoPath;
    case 'monogram':
      return branding.monogramPath;
    case 'monogram-light':
      return branding.monogramLightPath || branding.monogramPath;
  }
}

/** Path to a firm's brand image, served by app/api/public/brand. */
export function brandAssetUrl(firmId: string, slot: BrandSlot): string {
  return `/api/public/brand/${firmId}/${slot}`;
}

export interface WebBrand {
  /** Null on the neutral platform chrome. */
  firmId: string | null;
  /**
   * Compact wordmark for tight chrome. Never blank — a header needs *something*
   * clickable — so it degrades to the platform name, never to a firm name.
   */
  shortName: string;
  /** Full display name. Blank when the firm has configured none. */
  fullName: string;
  /** Stacked lockup lines for the login card. Empty when unconfigured. */
  nameLines: string[];
  /** Spread small-caps line under the wordmark. Blank omits it. */
  tagline: string;
  /** Route URLs, or null when the slot is unconfigured. */
  logoUrl: string | null;
  logoLightUrl: string | null;
  monogramUrl: string | null;
}

export const NEUTRAL_WEB_BRAND: WebBrand = {
  firmId: null,
  shortName: PLATFORM_NAME,
  fullName: '',
  nameLines: [],
  tagline: '',
  logoUrl: null,
  logoLightUrl: null,
  monogramUrl: null,
};

/**
 * The name to print in prose ("Access is restricted to X members"). Blank when
 * the firm has no configured name and on the neutral chrome, so callers phrase
 * the sentence to survive an empty string rather than naming someone.
 */
export function brandDisplayName(brand: WebBrand): string {
  return brand.fullName || (brand.firmId ? brand.shortName : '');
}
