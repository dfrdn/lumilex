/**
 * One call from a firm id to a renderable brand kit: read the firm's config,
 * pull its logo and monogram out of its own storage prefix, and resolve the
 * palette and typeface set.
 *
 * Every document renderer takes a `Brand`, never a firm id, so the IO happens
 * once at the route boundary and a bound package (letter + fee schedules +
 * dividers + profile) renders every part in the identical kit.
 */

import { cache } from 'react';
import { getFirmConfig } from '@/lib/firm/config';
import { brandFromConfig, type Brand } from './brand';
import { resolveBrandAssets } from './brand-assets';

/**
 * Cached per request: a proposal package renders the letter, up to four fee
 * schedules, two dividers and the firm profile, and they must all resolve to the
 * same kit — including the same local asset paths, so pdfkit's per-document
 * image cache keeps working.
 */
export const loadFirmBrand = cache(async (firmId: string): Promise<Brand> => {
  const config = await getFirmConfig(firmId);
  const assets = await resolveBrandAssets(firmId, config.branding);
  return brandFromConfig(config.branding, assets);
});
