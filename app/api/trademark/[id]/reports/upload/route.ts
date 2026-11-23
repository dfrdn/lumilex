import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { reportUploadPath } from '@/lib/trademarks/report-attachments';

const ALLOWED_ROLES = new Set(['admin', 'lawyer', 'partner', 'super_user']);
const MAX_BYTES = 25 * 1024 * 1024;

/**
 * POST /api/trademark/[id]/reports/upload  { name, size }
 * A signed URL to put one report file — a letter the team wrote, its annexes,
 * or what went out by other means — straight into the mark's report folder.
 * Nothing is recorded until the report is sent or recorded with it.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!ALLOWED_ROLES.has(session.user.role ?? '')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const body = await req.json().catch(() => null);
  const name = String(body?.name ?? '').trim();
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 });
  if ((Number(body?.size) || 0) > MAX_BYTES) {
    return NextResponse.json({ error: `${name} is over 25 MB` }, { status: 413 });
  }

  const { id } = await params;
  const authed = await getSupabaseServerAuthClient();
  const { data: mark } = await authed.from('trademarks').select('id').eq('id', id).maybeSingle();
  if (!mark) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const storagePath = reportUploadPath(session.firmId, id, name);
  const { data, error } = await getServiceDbForFirm(session.firmId).storage.from('files').createSignedUploadUrl(storagePath);
  if (error || !data) return NextResponse.json({ error: `Could not prepare the upload for ${name}` }, { status: 500 });
  return NextResponse.json({ storagePath, signedUrl: data.signedUrl });
}
