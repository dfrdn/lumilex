import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { TRADEMARK_SELECT, rowToTrademark } from '@/lib/trademark-row';
import { validateBody, localDeadlineCreateSchema } from '@/lib/validation';
import { logAudit, getClientIP } from '@/lib/audit';

/**
 * POST /api/trademark/[id]/local-deadlines — a filing a designated country
 * requires (a use declaration, a local renewal), due on a date entered by
 * hand: no rule for each country's filings is kept here.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const validation = await validateBody(req, localDeadlineCreateSchema);
  if (!validation.success) return validation.response;
  const { id } = await params;

  const supabase = await getSupabaseServerAuthClient();
  const { data: mark } = await supabase.from('trademarks').select('id, mark, origin').eq('id', id).maybeSingle();
  if (!mark) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  // A Philippine mark's filings follow IPOPHL's rules, counted for it; only a country designated abroad keeps its own by hand.
  if (mark.origin !== 'madrid_out') {
    return NextResponse.json({ error: 'Local filings are for a country designated abroad.' }, { status: 409 });
  }

  const { error } = await supabase.from('trademark_local_deadlines').insert({
    firm_id: session.firmId,
    trademark_id: id,
    label: validation.data.label,
    due_date: validation.data.dueDate,
    created_by: session.user.notionUserId,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  logAudit({
    firmId: session.firmId,
    entityType: 'Trademark',
    entityId: id,
    entityName: mark.mark || undefined,
    action: 'updated',
    fieldChanged: 'local_deadline',
    newValue: JSON.stringify(validation.data),
    performedBy: session.user.notionUserId,
    ipAddress: getClientIP(req),
  });

  const { data: row } = await supabase.from('trademarks').select(TRADEMARK_SELECT).eq('id', id).single();
  return NextResponse.json({ ok: true, trademark: row ? rowToTrademark(row) : null });
}
