/**
 * Fetches a firm's logo and monogram out of its own storage prefix and lands
 * them on the local filesystem so pdfkit can draw them.
 *
 * Why files and not Buffers: pdfkit only consults its per-document image cache
 * when `doc.image()` is handed a string (`_imageRegistry[src]`). Given a Buffer
 * it re-decodes on every call — for an RGBA PNG that means inflating every pixel
 * and re-deflating the split colour and alpha planes, ~250ms a draw. The mark is
 * drawn 2–3× per page (watermark, footer, section headers), so a Buffer here
 * cost ~12s on the firm profile alone against ~0.5s via a path. The download
 * therefore goes to a temp file once and the *path* is handed to the renderers.
 *
 * Nothing here falls back to a packaged mark. A firm with no logo configured
 * resolves to null and the renderers leave clean empty space, which is the only
 * safe answer — the alternative is printing some other firm's mark on a client's
 * engagement letter.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { getSupabase } from '@/lib/supabase';
import { firmStoragePath } from '@/lib/tenancy/service-db';
import type { FirmBranding } from '@/lib/firm/config';

const BUCKET = 'files';

export interface BrandAssets {
  /** Full-width logo lockup (DOCX headers, breakdown letterhead). */
  logo: string | null;
  /** Square-ish mark used as watermark, footer glyph, section ornament. */
  monogram: string | null;
  /** Reversed-out variant for dark grounds; falls back to `monogram`. */
  monogramLight: string | null;
}

export const NO_BRAND_ASSETS: BrandAssets = { logo: null, monogram: null, monogramLight: null };

/**
 * Cached by resolved object key. A branding change mints a new key (the admin
 * UI uploads under a fresh filename), so a cached entry can never go stale;
 * the bound keeps a long-lived lambda from accumulating every logo ever set.
 */
const CACHE = new Map<string, string | null>();
const CACHE_MAX = 32;

function cacheDir(): string {
  const dir = path.join(os.tmpdir(), 'lumilex-brand');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const EXT = /\.(png|jpe?g)$/i;

/**
 * Object key for a configured asset, inside the firm's own prefix. Returns null
 * for an unconfigured slot, and throws on a key that tries to climb out of the
 * prefix — a branding row is admin-editable data, not trusted input.
 */
export function brandObjectKey(firmId: string, configured: string): string | null {
  const raw = configured.trim();
  if (!raw) return null;
  if (raw.split('/').some((seg) => seg === '..')) {
    throw new Error(`branding path ${JSON.stringify(configured)} may not traverse outside the firm prefix`);
  }
  if (!EXT.test(raw)) {
    throw new Error(`branding path ${JSON.stringify(configured)} must be a .png or .jpg image`);
  }
  return firmStoragePath(firmId, raw);
}

async function download(key: string): Promise<string | null> {
  if (CACHE.has(key)) return CACHE.get(key) ?? null;

  let local: string | null = null;
  try {
    const { data, error } = await getSupabase().storage.from(BUCKET).download(key);
    if (!error && data) {
      const bytes = Buffer.from(await data.arrayBuffer());
      const name = crypto.createHash('sha1').update(key).digest('hex') + path.extname(key).toLowerCase();
      const file = path.join(cacheDir(), name);
      fs.writeFileSync(file, bytes);
      local = file;
    }
  } catch {
    // A storage hiccup must not take an engagement letter down with it; the
    // document renders without the mark, which is the same as "not configured".
    local = null;
  }

  if (CACHE.size >= CACHE_MAX) CACHE.clear();
  CACHE.set(key, local);
  return local;
}

/** Resolve every configured branding image to a local path (or null). */
export async function resolveBrandAssets(firmId: string, branding: FirmBranding): Promise<BrandAssets> {
  const keys = {
    logo: brandObjectKey(firmId, branding.logoPath),
    monogram: brandObjectKey(firmId, branding.monogramPath),
    monogramLight: brandObjectKey(firmId, branding.monogramLightPath),
  };
  const [logo, monogram, monogramLight] = await Promise.all([
    keys.logo ? download(keys.logo) : Promise.resolve(null),
    keys.monogram ? download(keys.monogram) : Promise.resolve(null),
    keys.monogramLight ? download(keys.monogramLight) : Promise.resolve(null),
  ]);
  return { logo, monogram, monogramLight };
}
