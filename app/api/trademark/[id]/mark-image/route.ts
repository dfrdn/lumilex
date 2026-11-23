import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getServiceDbForFirm, firmStoragePath } from '@/lib/tenancy/service-db';

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const formData = await req.formData();
  const file = formData.get('file') as File | null;
  if (!file) return NextResponse.json({ error: 'file is required' }, { status: 400 });
  if (!file.type.startsWith('image/')) {
    return NextResponse.json({ error: 'File must be an image' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'Image too large (max 10MB)' }, { status: 413 });
  }

  const supabase = getServiceDbForFirm(session.firmId);
  const { data: tm } = await supabase
    .from('trademarks').select('id, mark_image_path').eq('id', id).single();
  if (!tm) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Remove the existing image (if any) so we don't accumulate orphans
  if (tm.mark_image_path) {
    await supabase.storage.from('files').remove([tm.mark_image_path]);
  }

  const ext = (file.name.split('.').pop() || 'png').replace(/[^\w]+/g, '');
  const storagePath = firmStoragePath(session.firmId, `trademarks/${id}/mark-${Date.now()}.${ext}`);
  const buffer = Buffer.from(await file.arrayBuffer());
  const { error: upErr } = await supabase.storage
    .from('files')
    .upload(storagePath, buffer, { contentType: file.type, upsert: true });
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  const { error: updErr } = await supabase
    .from('trademarks')
    .update({ mark_image_path: storagePath, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  const { data: signed } = await supabase.storage
    .from('files')
    .createSignedUrl(storagePath, 60 * 60, { download: false });

  return NextResponse.json({
    ok: true,
    markImagePath: storagePath,
    url: signed?.signedUrl ?? null,
  });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  const supabase = getServiceDbForFirm(session.firmId);
  const { data: tm } = await supabase
    .from('trademarks').select('mark_image_path').eq('id', id).single();
  if (tm?.mark_image_path) {
    await supabase.storage.from('files').remove([tm.mark_image_path]);
  }
  await supabase
    .from('trademarks')
    .update({ mark_image_path: null, updated_at: new Date().toISOString() })
    .eq('id', id);
  return NextResponse.json({ ok: true });
}
