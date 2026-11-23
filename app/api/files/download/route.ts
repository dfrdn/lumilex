import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/session';
import { getSupabase } from '@/lib/supabase';
import { firmStoragePath } from '@/lib/tenancy/service-db';
import { attachmentDisposition } from '@/lib/download-headers';
import { storagePathSchema } from '@/lib/validation';

/**
 * GET /api/files/download?path=<storage-path>&name=<filename>
 *
 * Same-origin streaming download. We can't rely on Supabase Storage's
 * `?download=` query option to set Content-Disposition reliably — the signed
 * URL the SDK produces double-encodes the filename, and the upstream server
 * returns the file with no attachment disposition at all. The browser then
 * navigates to the PDF inline, killing the current session.
 *
 * Instead, we re-sign the URL server-side, stream the body straight through,
 * and set Content-Disposition ourselves with RFC 5987 encoding so brackets,
 * spaces, and non-ASCII characters round-trip into the saved filename.
 */

const querySchema = z.object({
  path: storagePathSchema,
  name: z.string().min(1).max(500).optional(),
});

export async function GET(req: Request) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const parsed = querySchema.safeParse({
    path: searchParams.get('path') ?? '',
    name: searchParams.get('name') ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
  const { path, name } = parsed.data;

  // Object keys are firm-prefixed; a path outside the caller's prefix belongs
  // to another firm and must not be signed.
  if (!path.startsWith(firmStoragePath(session.firmId, ''))) {
    return NextResponse.json({ error: 'File not found' }, { status: 404 });
  }

  // Raw client for a storage handle only (permanent exception).
  const supabase = getSupabase();
  const { data: signed, error: signError } = await supabase.storage
    .from('files')
    .createSignedUrl(path, 60);
  if (signError || !signed?.signedUrl) {
    return NextResponse.json({ error: 'File not found' }, { status: 404 });
  }

  const upstream = await fetch(signed.signedUrl);
  if (!upstream.ok || !upstream.body) {
    return NextResponse.json({ error: 'File fetch failed' }, { status: 502 });
  }

  const headers = new Headers();
  headers.set('Content-Type', upstream.headers.get('content-type') || 'application/octet-stream');
  const len = upstream.headers.get('content-length');
  if (len) headers.set('Content-Length', len);
  headers.set('Content-Disposition', attachmentDisposition(name || path.split('/').pop() || 'file'));
  headers.set('Cache-Control', 'private, no-store');

  return new Response(upstream.body, { headers });
}
