import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { TRADEMARK_SELECT, rowToTrademark } from '@/lib/trademark-row';
import { logAudit, getClientIP } from '@/lib/audit';
import { validateBody, trademarkUndoSchema } from '@/lib/validation';
import { planUndo } from '@/lib/trademarks/undo';

/** Takes back a recorded step: clears what it recorded and returns the status to where it was. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const validation = await validateBody(req, trademarkUndoSchema);
  if (!validation.success) return validation.response;
  const { action, previousStatus, officeActionId } = validation.data;
  const { id } = await params;

  const supabase = await getSupabaseServerAuthClient();
  const { data: current, error: getErr } = await supabase
    .from('trademarks').select(TRADEMARK_SELECT).eq('id', id).single();
  if (getErr || !current) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const plan = planUndo(action, rowToTrademark(current), previousStatus, officeActionId);
  if (!plan.ok) return NextResponse.json({ error: plan.error }, { status: 409 });

  if (plan.round) {
    const rounds = supabase.from('trademark_office_actions');
    const { error } = 'delete' in plan.round
      ? await rounds.delete().eq('id', plan.round.id).eq('trademark_id', id)
      : await rounds.update({ ...plan.round.set, updated_at: new Date().toISOString() }).eq('id', plan.round.id).eq('trademark_id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const { data, error } = await supabase
    .from('trademarks')
    .update({ ...plan.updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select(TRADEMARK_SELECT)
    .single();
  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? 'Update failed' }, { status: 500 });
  }

  logAudit({
    firmId: session.firmId,
    entityType: 'Trademark',
    entityId: id,
    entityName: data.mark ?? undefined,
    action: 'updated',
    fieldChanged: 'undo',
    oldValue: action,
    newValue: JSON.stringify({ ...plan.updates, ...(plan.round ? { round: plan.round } : {}) }),
    performedBy: session.user.notionUserId,
    ipAddress: getClientIP(req),
  });

  return NextResponse.json({ ok: true, trademark: rowToTrademark(data) });
}
