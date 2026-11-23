import { NextResponse } from 'next/server';
import { getFirmConfig } from '@/lib/firm/config';
import { isBrandSlot } from '@/lib/firm/brand-shape';
import { readBrandImage } from '@/lib/firm/brand-bytes';

/**
 * A firm's own logo or monogram, by stable URL.
 *
 * Unauthenticated on purpose: these marks go into client-facing email HTML and
 * into the pre-auth login and intake pages, neither of which can hold a signed
 * URL. A letterhead mark is public identity, and nothing else in the firm's
 * storage prefix is reachable — the object key comes from `branding.*Path`, not
 * from the request.
 *
 * An unconfigured slot is a 404, never a stand-in mark: the callers all render a
 * text wordmark when the image does not load.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ firmId: string; asset: string }> },
) {
  const { firmId, asset } = await params;
  if (!isBrandSlot(asset)) return new NextResponse(null, { status: 404 });

  let branding;
  try {
    ({ branding } = await getFirmConfig(firmId));
  } catch {
    return new NextResponse(null, { status: 404 });
  }

  let image;
  try {
    image = await readBrandImage(firmId, branding, asset);
  } catch {
    // brandObjectKey rejects a path that is not an image or tries to climb out
    // of the firm prefix. Misconfiguration, not a request the caller can fix.
    return new NextResponse(null, { status: 404 });
  }
  if (!image) return new NextResponse(null, { status: 404 });

  return new NextResponse(new Uint8Array(image.bytes), {
    headers: {
      'Content-Type': image.contentType,
      'Content-Length': String(image.bytes.byteLength),
      // Branding changes mint a new filename, but the URL is slot-stable, so
      // keep the shared cache short enough that a re-upload lands the same day.
      'Cache-Control': 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400',
    },
  });
}
