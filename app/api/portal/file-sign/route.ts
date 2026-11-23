import { NextResponse } from 'next/server';
import { requirePortalSession } from '@/lib/portal/guards';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { signStoragePaths } from '@/lib/storage-sign';
import { fileSignSchema, validateBody } from '@/lib/validation';
import { loadPortalVisiblePaths } from '@/lib/portal/data';

/**
 * POST /api/portal/file-sign
 * Portal mirror of /api/file-sign. Signs only the requested paths the
 * client's matter pages show (`loadPortalVisiblePaths`, scoped to the
 * session's client) and drops the rest. Same body shape
 * + same response shape as the firm endpoint, so the shared FilePreviewModal
 * can target either.
 *
 * Body: { paths: string[], download?: string }
 * Returns: { urls: Record<string, string> }
 */
export async function POST(req: Request) {
  const guard = await requirePortalSession();
  if (!guard.ok) return guard.response;
  const { session } = guard;

  const validation = await validateBody(req, fileSignSchema);
  if (!validation.success) return validation.response;
  const { paths, download } = validation.data;

  const service = getServiceDbForFirm(session.firmId);
  const allowed = await loadPortalVisiblePaths(service, session.user.clientId);

  const signed = await signStoragePaths(
    service,
    'files',
    paths.filter((p) => allowed.has(p)),
    60 * 60,
    { download },
  );

  return NextResponse.json({ urls: Object.fromEntries(signed) });
}
