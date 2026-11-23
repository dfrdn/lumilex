import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { logAudit, getClientIP } from '@/lib/audit';

type Kind = 'hearing' | 'filing' | 'file' | null;

export async function PATCH(req: Request) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const personId = session.user.notionUserId;
  const role = session.user.role ?? 'lawyer';
  if (role !== 'admin' && role !== 'super_user') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { statusReportId, kind, parentId } = (await req.json()) as {
    statusReportId?: string;
    kind?: Kind;
    parentId?: string | null;
  };

  if (!statusReportId) {
    return NextResponse.json({ error: 'Missing statusReportId' }, { status: 400 });
  }
  if (kind && kind !== 'hearing' && kind !== 'filing' && kind !== 'file') {
    return NextResponse.json({ error: 'Invalid kind' }, { status: 400 });
  }
  if (kind && !parentId) {
    return NextResponse.json({ error: 'Missing parentId' }, { status: 400 });
  }

  const supabase = await getSupabaseServerAuthClient();

  const { data: current, error: fetchErr } = await supabase
    .from('deliverables')
    .select('notion_id, type, related_hearing_id, source_deliverable_id, source_file_id')
    .eq('notion_id', statusReportId)
    .single();

  if (fetchErr || !current) {
    return NextResponse.json({ error: 'Status report not found' }, { status: 404 });
  }
  if (current.type !== 'Status Report') {
    return NextResponse.json({ error: 'Not a status report' }, { status: 400 });
  }

  let newHearingId: string | null = null;
  let newSourceId: string | null = null;
  let newFileId: string | null = null;
  let newParentName: string | null = null;

  if (kind === 'hearing' && parentId) {
    const { data: h } = await supabase
      .from('hearings')
      .select('notion_id, name')
      .eq('notion_id', parentId)
      .single();
    if (!h) return NextResponse.json({ error: 'Hearing not found' }, { status: 404 });
    newHearingId = h.notion_id;
    newParentName = h.name ?? '';
  } else if (kind === 'filing' && parentId) {
    const { data: d } = await supabase
      .from('deliverables')
      .select('notion_id, name, type')
      .eq('notion_id', parentId)
      .single();
    if (!d) return NextResponse.json({ error: 'Deliverable not found' }, { status: 404 });
    if (d.notion_id === statusReportId) {
      return NextResponse.json({ error: 'Cannot link to itself' }, { status: 400 });
    }
    newSourceId = d.notion_id;
    newParentName = d.name ?? '';
  } else if (kind === 'file' && parentId) {
    const { data: f } = await supabase
      .from('files')
      .select('notion_id, name')
      .eq('notion_id', parentId)
      .single();
    if (!f) return NextResponse.json({ error: 'File not found' }, { status: 404 });
    newFileId = f.notion_id;
    newParentName = f.name ?? '';
  }

  const { error: updateErr } = await supabase
    .from('deliverables')
    .update({
      related_hearing_id: newHearingId,
      source_deliverable_id: newSourceId,
      source_file_id: newFileId,
    })
    .eq('notion_id', statusReportId);

  if (updateErr) {
    console.error('[status-report/parent]', updateErr);
    return NextResponse.json({ error: 'Update failed' }, { status: 500 });
  }

  const oldParent = current.related_hearing_id
    ? `hearing:${current.related_hearing_id}`
    : current.source_deliverable_id
      ? `filing:${current.source_deliverable_id}`
      : '(none)';
  const newParent = newHearingId
    ? `hearing:${newHearingId}`
    : newSourceId
      ? `filing:${newSourceId}`
      : '(none)';

  logAudit({
    firmId: session.firmId,
    entityType: 'deliverable',
    entityId: statusReportId,
    action: 'field_update',
    fieldChanged: 'parent',
    oldValue: oldParent,
    newValue: newParent,
    performedBy: personId,
    ipAddress: getClientIP(req),
  });

  await supabase.from('deliverable_actions').insert({
    firm_id: session.firmId,
    deliverable_id: statusReportId,
    action: 'Updated Parent',
    old_status: oldParent,
    new_status: newParent,
    performed_by: personId,
  });

  return NextResponse.json({
    success: true,
    parentKind: kind ?? null,
    parentId: newHearingId ?? newSourceId ?? null,
    parentName: newParentName,
  });
}
