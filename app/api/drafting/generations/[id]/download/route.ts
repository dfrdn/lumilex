import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';

/**
 * GET /api/drafting/generations/[id]/download
 *
 * Mints a fresh short-lived signed URL for a previously generated document and
 * redirects to it, so a draft is always re-downloadable from the generations
 * list (the original on-screen link is one-hour and one-time).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user?.notionUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const docId = Number(id);
  if (!Number.isFinite(docId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  const service = getServiceDbForFirm(session.firmId);
  const { data: doc } = await service
    .from('generated_documents')
    .select('storage_path, matter_id')
    .eq('id', docId)
    .maybeSingle();
  if (!doc?.storage_path) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // RLS gate: the caller must be able to access the document's matter.
  if (doc.matter_id) {
    const authed = await getSupabaseServerAuthClient();
    const { data: matter } = await authed.from('matters').select('notion_id').eq('notion_id', doc.matter_id).maybeSingle();
    if (!matter) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const { data: signed } = await service.storage
    .from('files')
    .createSignedUrl(doc.storage_path, 60 * 5, { download: true });
  if (!signed?.signedUrl) return NextResponse.json({ error: 'Could not produce a download link' }, { status: 500 });

  return NextResponse.redirect(signed.signedUrl);
}
