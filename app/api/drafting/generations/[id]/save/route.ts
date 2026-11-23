import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { logAudit, getClientIP } from '@/lib/audit';

export const maxDuration = 60;

const DOCX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const MAX_BYTES = 25 * 1024 * 1024;

/**
 * POST /api/drafting/generations/[id]/save  (multipart: file=<docx>)
 *
 * Writes edits made in the in-browser SuperDoc preview back to the stored
 * document — overwriting the same storage object, so both the Recent Drafts
 * download and any deliverable attached to that file serve the edited version.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user?.notionUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const docId = Number(id);
  if (!Number.isFinite(docId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: 'No file provided' }, { status: 400 });
  if (file.size === 0 || file.size > MAX_BYTES) return NextResponse.json({ error: 'File missing or too large' }, { status: 400 });

  const service = getServiceDbForFirm(session.firmId);
  const { data: doc } = await service
    .from('generated_documents')
    .select('storage_path, matter_id')
    .eq('id', docId)
    .maybeSingle();
  if (!doc?.storage_path) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // RLS gate: caller must be able to access the document's matter.
  if (doc.matter_id) {
    const authed = await getSupabaseServerAuthClient();
    const { data: matter } = await authed.from('matters').select('notion_id').eq('notion_id', doc.matter_id).maybeSingle();
    if (!matter) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const { error: upErr } = await service.storage
    .from('files')
    .upload(doc.storage_path, buffer, { contentType: DOCX_CONTENT_TYPE, upsert: true });
  if (upErr) return NextResponse.json({ error: `Save failed: ${upErr.message}` }, { status: 500 });

  // Keep an attached deliverable's file size in sync (content is the same object).
  await service.from('deliverable_files').update({ file_size: buffer.length }).eq('file_url', doc.storage_path);

  logAudit({
    firmId: session.firmId,
    entityType: 'AIDraft',
    entityId: doc.storage_path,
    action: 'edited',
    performedBy: session.user.notionUserId,
    ipAddress: getClientIP(req),
  });

  return NextResponse.json({ ok: true });
}
