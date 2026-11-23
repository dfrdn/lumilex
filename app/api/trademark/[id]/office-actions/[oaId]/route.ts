import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { TRADEMARK_SELECT, rowToTrademark } from '@/lib/trademark-row';
import { logAudit, getClientIP } from '@/lib/audit';
import { validateBody, officeActionPatchSchema } from '@/lib/validation';
import { manilaToday } from '@/lib/dates';
import { isNational } from '@/lib/trademark-deadlines';

const COLUMN = {
  kind: 'kind',
  title: 'title',
  mailingDate: 'mailing_date',
  receivedDate: 'received_date',
  respondBy: 'respond_by',
  responseFiledDate: 'response_filed_date',
} as const;

/**
 * Corrects a recorded Office Action round — its kind, title, the date on the
 * document, the day it arrived, a period the examiner set, or when it was
 * answered. Recording and taking back a round go through /action and /undo.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string; oaId: string }> }) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const validation = await validateBody(req, officeActionPatchSchema);
  if (!validation.success) return validation.response;
  const { id, oaId } = await params;

  const today = manilaToday();
  const updates: Record<string, string | null> = {};
  for (const [key, col] of Object.entries(COLUMN) as [keyof typeof COLUMN, string][]) {
    const v = validation.data[key];
    if (v === undefined) continue;
    if (key !== 'respondBy' && key !== 'kind' && key !== 'title' && typeof v === 'string' && v > today) {
      return NextResponse.json({ error: 'That date is in the future' }, { status: 400 });
    }
    updates[col] = v;
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'Nothing to change' }, { status: 400 });
  }

  const supabase = await getSupabaseServerAuthClient();
  const { data: before } = await supabase
    .from('trademark_office_actions')
    .select('*')
    .eq('id', oaId)
    .eq('trademark_id', id)
    .maybeSingle();
  if (!before) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (updates.kind || 'respond_by' in updates) {
    const { data: mark } = await supabase.from('trademarks').select('origin').eq('id', id).maybeSingle();
    // Either kind of designation: the Philippines in a foreign IR, or a country in one of ours.
    const designation = !!mark && !isNational(mark);
    const wrongKind = designation ? updates.kind === 'office_action' : updates.kind === 'provisional_refusal';
    if (wrongKind) {
      return NextResponse.json({ error: designation ? 'A designation’s round is a provisional or final refusal' : 'A provisional refusal is for a designation under the Madrid Protocol' }, { status: 400 });
    }
    if (designation && updates.respond_by === null) {
      return NextResponse.json({ error: 'A designation’s refusal keeps the response date stated on the notice' }, { status: 400 });
    }
  }

  const mailing = updates.mailing_date ?? before.mailing_date;
  if ((updates.received_date ?? before.received_date) && (updates.received_date ?? before.received_date) < mailing) {
    return NextResponse.json({ error: 'It can’t have been received before the date on the document' }, { status: 400 });
  }
  if ((updates.respond_by ?? before.respond_by) && (updates.respond_by ?? before.respond_by) <= mailing) {
    return NextResponse.json({ error: 'The response date must be after the date on the document' }, { status: 400 });
  }

  const { error } = await supabase
    .from('trademark_office_actions')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', oaId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data: tm, error: tmErr } = await supabase.from('trademarks').select(TRADEMARK_SELECT).eq('id', id).single();
  if (tmErr || !tm) return NextResponse.json({ error: tmErr?.message ?? 'Not found' }, { status: 500 });

  for (const [col, v] of Object.entries(updates)) {
    logAudit({
      firmId: session.firmId,
      entityType: 'Trademark',
      entityId: id,
      entityName: tm.mark ?? undefined,
      action: 'updated',
      fieldChanged: `office_action.${col}`,
      oldValue: before[col] ?? undefined,
      newValue: v ?? undefined,
      performedBy: session.user.notionUserId,
      ipAddress: getClientIP(req),
    });
  }

  return NextResponse.json({ ok: true, trademark: rowToTrademark(tm) });
}
