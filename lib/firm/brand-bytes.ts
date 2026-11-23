/**
 * Raw bytes for one of a firm's configured brand images, straight out of that
 * firm's own storage prefix.
 *
 * The PDF/DOCX side ({@link ../pdf/brand-assets}) lands the same objects on the
 * local filesystem because pdfkit needs a path. The web side needs bytes and a
 * content type to stream from a route, and — unlike a document render — it needs
 * a URL that survives longer than a signed link, because it goes into email HTML
 * that a client may open next week. Hence a public route over stored bytes
 * rather than a signed URL.
 *
 * Only the two slots a firm has actually configured are reachable: the object
 * key is derived from `branding.*Path`, never from the request.
 */

import { getSupabase } from '@/lib/supabase';
import { brandObjectKey } from '@/lib/pdf/brand-assets';
import { brandSlotPath, type BrandSlot } from '@/lib/firm/brand-shape';
import type { FirmBranding } from '@/lib/firm/config';

const BUCKET = 'files';

export interface BrandImage {
  bytes: Buffer;
  contentType: string;
}

/** Null when the slot is unconfigured or the object is missing. */
export async function readBrandImage(
  firmId: string,
  branding: FirmBranding,
  slot: BrandSlot,
): Promise<BrandImage | null> {
  const key = brandObjectKey(firmId, brandSlotPath(branding, slot));
  if (!key) return null;

  const { data, error } = await getSupabase().storage.from(BUCKET).download(key);
  if (error || !data) return null;

  return {
    bytes: Buffer.from(await data.arrayBuffer()),
    contentType: /\.png$/i.test(key) ? 'image/png' : 'image/jpeg',
  };
}
