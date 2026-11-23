import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';

export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { fileId } = await req.json();
  if (!fileId) {
    return NextResponse.json({ error: 'Missing fileId' }, { status: 400 });
  }

  const userId = session.user.notionUserId;
  const supabase = getServiceDbForFirm(session.firmId);

  // Check current persons_read_ids
  const { data: file, error: fetchErr } = await supabase
    .from('files')
    .select('persons_read_ids')
    .eq('notion_id', fileId)
    .single();

  if (fetchErr || !file) {
    return NextResponse.json({ error: 'File not found' }, { status: 404 });
  }

  const currentIds: string[] = file.persons_read_ids ?? [];
  if (currentIds.includes(userId)) {
    return NextResponse.json({ ok: true, alreadyRead: true });
  }

  // Update Supabase
  const updatedIds = [...currentIds, userId];
  const { error: updateErr } = await supabase
    .from('files')
    .update({ persons_read_ids: updatedIds })
    .eq('notion_id', fileId);

  if (updateErr) {
    console.error('[mark-read] Supabase update error:', updateErr.message);
    return NextResponse.json({ error: 'Update failed' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

/** DELETE /api/mark-read — mark a file as unread (remove user from persons_read_ids) */
export async function DELETE(req: Request) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { fileId } = await req.json();
  if (!fileId) {
    return NextResponse.json({ error: 'Missing fileId' }, { status: 400 });
  }

  const userId = session.user.notionUserId;
  const supabase = getServiceDbForFirm(session.firmId);

  const { data: file, error: fetchErr } = await supabase
    .from('files')
    .select('persons_read_ids')
    .eq('notion_id', fileId)
    .single();

  if (fetchErr || !file) {
    return NextResponse.json({ error: 'File not found' }, { status: 404 });
  }

  const currentIds: string[] = file.persons_read_ids ?? [];
  if (!currentIds.includes(userId)) {
    return NextResponse.json({ ok: true, alreadyUnread: true });
  }

  const updatedIds = currentIds.filter((id) => id !== userId);
  const { error: updateErr } = await supabase
    .from('files')
    .update({ persons_read_ids: updatedIds })
    .eq('notion_id', fileId);

  if (updateErr) {
    console.error('[mark-unread] Supabase update error:', updateErr.message);
    return NextResponse.json({ error: 'Update failed' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
