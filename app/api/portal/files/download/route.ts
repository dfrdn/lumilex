import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requirePortalSession } from '@/lib/portal/guards';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { attachmentDisposition } from '@/lib/download-headers';
import { storagePathSchema } from '@/lib/validation';
import { loadPortalVisiblePaths } from '@/lib/portal/data';

/**
 * GET /api/portal/files/download?path=<storage-path>&name=<filename>
 *
 * Portal mirror of /api/files/download. Same reason for existing: we can't
 * trust Supabase Storage to set Content-Disposition, so we stream the file
 * through our origin with a properly-encoded attachment header.
 *
 * Authorization: the requested path must be one the client's matter pages
 * show — `loadPortalVisiblePaths`, scoped to the session's client. A client's
 * JWT reads no firm table, so the allowlist is built with the service client.
 */

const querySchema = z.object({
  path: storagePathSchema,
  name: z.string().min(1).max(500).optional(),
});

export async function GET(req: Request) {
  const guard = await requirePortalSession();
  if (!guard.ok) return guard.response;
  const { session } = guard;

  const { searchParams } = new URL(req.url);
  const parsed = querySchema.safeParse({
    path: searchParams.get('path') ?? '',
    name: searchParams.get('name') ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
  const { path, name } = parsed.data;

  const service = getServiceDbForFirm(session.firmId);
  const allowed = await loadPortalVisiblePaths(service, session.user.clientId);
  if (!allowed.has(path)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const { data: signed, error: signError } = await service.storage
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
