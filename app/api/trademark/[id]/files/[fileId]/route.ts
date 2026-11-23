import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { rowToTrademarkFile } from '@/lib/trademark-row';
import { logAudit, getClientIP } from '@/lib/audit';
import { validateBody, trademarkFileTagSchema } from '@/lib/validation';
import { ROUND_STEPS } from '@/lib/trademarks/file-steps';

/**
 * Files a paper under a timeline step (and, for an Office Action step, the
 * round it belongs to), or takes it out of one. The paper itself is untouched.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string; fileId: string }> }) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const validation = await validateBody(req, trademarkFileTagSchema);
  if (!validation.success) return validation.response;
  const { step } = validation.data;
  const officeActionId = step && ROUND_STEPS.has(step) ? validation.data.officeActionId ?? null : null;
  if (step && ROUND_STEPS.has(step) && !officeActionId) {
    return NextResponse.json({ error: 'Say which Office Action this paper belongs to' }, { status: 400 });
  }

  const { id, fileId } = await params;
  const supabase = await getSupabaseServerAuthClient();
  if (officeActionId) {
    const { data: round } = await supabase
      .from('trademark_office_actions').select('id').eq('id', officeActionId).eq('trademark_id', id).maybeSingle();
    if (!round) return NextResponse.json({ error: 'That Office Action is not on this mark' }, { status: 400 });
  }

  const { data: row, error } = await supabase
    .from('trademark_files')
    .update({ step, office_action_id: officeActionId })
    .eq('id', Number(fileId))
    .eq('trademark_id', id)
    .select('*')
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  logAudit({
    firmId: session.firmId,
    entityType: 'Trademark',
    entityId: id,
    action: 'updated',
    fieldChanged: 'file_step',
    oldValue: row.name,
    newValue: JSON.stringify({ step, officeActionId }),
    performedBy: session.user.notionUserId,
    ipAddress: getClientIP(req),
  });

  return NextResponse.json({ ok: true, file: rowToTrademarkFile(row) });
}
