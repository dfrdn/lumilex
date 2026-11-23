import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabase } from '@/lib/supabase';
import { firmStoragePath } from '@/lib/tenancy/service-db';
import { signStoragePaths } from '@/lib/storage-sign';
import { fileSignSchema, validateBody } from '@/lib/validation';

/**
 * POST /api/file-sign
 * Generate fresh signed URLs for one or more storage paths.
 * Body: { paths: string[], download?: string }
 *   When `download` is set, URLs are signed with Content-Disposition:
 *   attachment and that filename, so the browser saves the file instead of
 *   navigating to it. Otherwise URLs use inline disposition for previews.
 * Returns: { urls: Record<string, string> }
 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const validation = await validateBody(req, fileSignSchema);
  if (!validation.success) return validation.response;
  const { paths, download } = validation.data;

  // Raw client for a storage handle only (permanent exception). Object keys are
  // firm-prefixed, so a path outside the caller's prefix belongs to another firm
  // and is refused rather than signed.
  const firmPrefix = firmStoragePath(session.firmId, '');
  const signed = await signStoragePaths(
    getSupabase(),
    'files',
    paths.filter((p) => p.startsWith(firmPrefix)),
    60 * 60,
    { download },
  );

  return NextResponse.json({ urls: Object.fromEntries(signed) });
}
