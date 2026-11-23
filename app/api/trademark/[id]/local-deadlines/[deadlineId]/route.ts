import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { TRADEMARK_SELECT, rowToTrademark } from '@/lib/trademark-row';
import { validateBody, localDeadlinePatchSchema } from '@/lib/validation';
import { logAudit, getClientIP } from '@/lib/audit';
import { manilaToday } from '@/lib/dates';

type Params = { params: Promise<{ id: string; deadlineId: string }> };

async function respond(supabase: Awaited<ReturnType<typeof getSupabaseServerAuthClient>>, id: string) {
  const { data: row } = await supabase.from('trademarks').select(TRADEMARK_SELECT).eq('id', id).single();
  return NextResponse.json({ ok: true, trademark: row ? rowToTrademark(row) : null });
}

/** PATCH — renames a local deadline, moves its due date, or records (or clears) its filing. */
export async function PATCH(req: Request, { params }: Params) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const validation = await validateBody(req, localDeadlinePatchSchema);
  if (!validation.success) return validation.response;
  const { id, deadlineId } = await params;
  const { label, dueDate, filedDate } = validation.data;
  if (filedDate && filedDate > manilaToday()) return NextResponse.json({ error: 'That date is in the future' }, { status: 400 });

  const updates: Record<string, string | null> = {};
  if (label !== undefined) updates.label = label;
  if (dueDate !== undefined) updates.due_date = dueDate;
  if (filedDate !== undefined) updates.filed_date = filedDate;
  if (!Object.keys(updates).length) return NextResponse.json({ error: 'Nothing to change' }, { status: 400 });

  const supabase = await getSupabaseServerAuthClient();
  const { data, error } = await supabase
    .from('trademark_local_deadlines')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', deadlineId)
    .eq('trademark_id', id)
    .select('id');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data?.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  logAudit({
    firmId: session.firmId,
    entityType: 'Trademark',
    entityId: id,
    action: 'updated',
    fieldChanged: 'local_deadline',
    newValue: JSON.stringify({ deadlineId, ...updates }),
    performedBy: session.user.notionUserId,
    ipAddress: getClientIP(req),
  });
  return respond(supabase, id);
}

/** DELETE — takes off a local deadline entered by mistake. */
export async function DELETE(req: Request, { params }: Params) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id, deadlineId } = await params;
  const supabase = await getSupabaseServerAuthClient();
  const { data, error } = await supabase
    .from('trademark_local_deadlines').delete().eq('id', deadlineId).eq('trademark_id', id).select('id, label');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data?.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  logAudit({
    firmId: session.firmId,
    entityType: 'Trademark',
    entityId: id,
    action: 'updated',
    fieldChanged: 'local_deadline',
    oldValue: data[0].label as string,
    newValue: 'deleted',
    performedBy: session.user.notionUserId,
    ipAddress: getClientIP(req),
  });
  return respond(supabase, id);
}
