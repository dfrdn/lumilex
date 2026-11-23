/**
 * The firm identity the *web* chrome wears: the sidebar lockups, the login and
 * portal pages, the intake page, the push notification title, the email header.
 *
 * Same source and same contract as the document brand kit ({@link ../pdf/firm-brand}):
 * one loader, resolved from `firms.branding`, and nothing falls back to another
 * firm. Where the two differ is what "unconfigured" means. A document with no
 * logo prints empty space; a web header with no logo prints the firm's name as a
 * text wordmark, because a header is a navigation landmark and empty space there
 * is a bug. Neither ever renders a packaged mark.
 *
 * Pre-auth surfaces (login, portal login, intake) have no session, so they
 * resolve the firm from the request Host. An unmapped host is not an error and
 * not a guess — it renders `NEUTRAL_WEB_BRAND`, the platform's own chrome.
 *
 * Server-only. The shape and the pure helpers live in `brand-shape.ts` so the
 * client bundle can hold a `WebBrand` without importing any of this.
 */

import { cache } from 'react';
import { headers } from 'next/headers';
import { getFirmConfig, findFirmIdByHost } from '@/lib/firm/config';
import { getSession, getPortalSession } from '@/lib/session';
import {
  NEUTRAL_WEB_BRAND,
  PLATFORM_NAME,
  brandAssetUrl,
  brandSlotPath,
  type BrandSlot,
  type WebBrand,
} from '@/lib/firm/brand-shape';

export const loadWebBrand = cache(async (firmId: string): Promise<WebBrand> => {
  const config = await getFirmConfig(firmId);
  const { branding } = config;

  const configured = (slot: BrandSlot): string | null =>
    brandSlotPath(branding, slot).trim() ? brandAssetUrl(firmId, slot) : null;

  return {
    firmId,
    shortName: config.shortName.trim() || config.name.trim() || PLATFORM_NAME,
    fullName: branding.documentName.trim() || config.name.trim(),
    nameLines: branding.nameLines.filter((line) => line.trim().length > 0),
    tagline: branding.tagline.trim(),
    logoUrl: configured('logo'),
    logoLightUrl: configured('logo-light'),
    monogramUrl: configured('monogram'),
  };
});

/**
 * The brand for a request with no session, resolved from the Host header.
 * Unknown host — a preview deploy, a bare platform domain, a probe — renders the
 * neutral chrome rather than whichever firm happens to be first in the table.
 */
export const webBrandFromHost = cache(async (): Promise<WebBrand> => {
  const host = (await headers()).get('host');
  if (!host) return NEUTRAL_WEB_BRAND;
  const firmId = await findFirmIdByHost(host);
  if (!firmId) return NEUTRAL_WEB_BRAND;
  return loadWebBrand(firmId);
});

/**
 * The brand for the current request, whoever is asking. Staff session first,
 * portal session second, Host header last — a signed-in user's own firm always
 * wins over the domain they happened to arrive on, and an anonymous visitor on
 * an unmapped host gets the neutral chrome.
 *
 * Resolved once in the root layout and handed to the client tree, so no shell
 * needs a brand prop threaded through a hundred page components.
 */
export const resolveRequestBrand = cache(async (): Promise<WebBrand> => {
  const session = await getSession();
  if (session) return loadWebBrand(session.firmId);
  const portal = await getPortalSession();
  if (portal) return loadWebBrand(portal.firmId);
  return webBrandFromHost();
});

export { brandDisplayName, type WebBrand } from '@/lib/firm/brand-shape';
