import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { caseUpdateSchema, validateBody } from '@/lib/validation';
import { logAudit, getClientIP } from '@/lib/audit';
import { caseResponse, refuseCaseWrite } from '@/lib/cases/api';

/**
 * PATCH /api/cases/[id] — the case's own facts: a pinned title (or unpinning
 * it, so its proceedings title it again), its working title, nature and the
 * client's side, the demand letter, and closing or reopening it.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  const refused = refuseCaseWrite(session);
  if (refused) return refused;
  const { id } = await params;

  const validation = await validateBody(req, caseUpdateSchema);
  if (!validation.success) return validation.response;
  const body = validation.data;

  const patch: Record<string, unknown> = {};
  if (body.pinnedTitle !== undefined) {
    if (body.pinnedTitle === null) patch.title_pinned = false;
    else Object.assign(patch, { title_pinned: true, title: body.pinnedTitle });
  }
  if (body.workingTitle !== undefined) patch.working_title = body.workingTitle;
  if (body.nature !== undefined) patch.nature = body.nature;
  if (body.clientRole !== undefined) patch.client_role = body.clientRole;
  if (body.demandSentOn !== undefined) patch.demand_sent_on = body.demandSentOn;
  if (body.demandDueOn !== undefined) patch.demand_due_on = body.demandDueOn;
  if (body.close) Object.assign(patch, { status: 'closed', outcome: body.close.outcome, closed_on: body.close.closedOn });

  const supabase = await getSupabaseServerAuthClient();
  if (body.reopen) {
    // Back to active if anything was filed, else back to evaluation.
    const { count } = await supabase.from('case_proceedings').select('id', { count: 'exact', head: true }).eq('case_id', id);
    Object.assign(patch, { status: count ? 'active' : 'evaluation', outcome: null, closed_on: null });
  }

  const { data, error } = await supabase.from('cases').update(patch).eq('id', id).select('id').maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  logAudit({
    firmId: session!.firmId,
    entityType: 'Case',
    entityId: id,
    action: body.close ? 'closed' : body.reopen ? 'reopened' : 'updated',
    performedBy: session!.user.notionUserId,
    newValue: JSON.stringify(body),
    ipAddress: getClientIP(req),
  });
  return caseResponse(session!.firmId, id);
}
