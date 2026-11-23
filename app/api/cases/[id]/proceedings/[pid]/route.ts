import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { proceedingUpdateSchema, validateBody } from '@/lib/validation';
import { logAudit, getClientIP } from '@/lib/audit';
import { caseResponse, refuseCaseWrite } from '@/lib/cases/api';
import { finalStage, STAGES, type Track } from '@/lib/cases/stages';

/**
 * PATCH /api/cases/[id]/proceedings/[pid] — a proceeding's details, its
 * stage, or what happened: a decision (resolved, at its decision stage, with
 * the date it was received and an MR due date if a lawyer wants one
 * tracked), an MR filed against it (open again, at the MR period), or
 * reopening it.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string; pid: string }> }) {
  const session = await getSession();
  const refused = refuseCaseWrite(session);
  if (refused) return refused;
  const { id, pid } = await params;

  const validation = await validateBody(req, proceedingUpdateSchema);
  if (!validation.success) return validation.response;
  const b = validation.data;

  const supabase = await getSupabaseServerAuthClient();
  const { data: p } = await supabase.from('case_proceedings').select('id, track, status').eq('id', pid).eq('case_id', id).maybeSingle();
  if (!p) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const track = (b.track ?? p.track) as Track | null;

  const patch: Record<string, unknown> = {};
  if (b.office !== undefined) patch.office = b.office;
  if (b.docketNo !== undefined) patch.docket_no = b.docketNo;
  if (b.caption !== undefined) patch.caption = b.caption;
  if (b.filedOn !== undefined) patch.filed_on = b.filedOn;
  if (b.track !== undefined) {
    patch.track = b.track;
    // A new track's stages are different; start it at its first.
    if (b.stage === undefined) patch.stage = STAGES[b.track][0].key;
  }
  if (b.stage !== undefined) {
    if (!track || !STAGES[track].some((s) => s.key === b.stage)) {
      return NextResponse.json({ error: 'That stage isn’t on this proceeding’s track' }, { status: 400 });
    }
    patch.stage = b.stage;
    if (b.stage === finalStage(track)) patch.status = 'resolved';
    else if (p.status === 'resolved') patch.status = 'active';
  }
  if (b.decision) {
    if (!track) return NextResponse.json({ error: 'Set the kind of proceeding first' }, { status: 400 });
    Object.assign(patch, {
      status: 'resolved',
      stage: finalStage(track),
      resolution: b.decision.resolution,
      resolved_on: b.decision.resolvedOn,
      decision_received_on: b.decision.receivedOn,
      mr_due_on: b.decision.mrDueOn,
    });
  }
  if (b.mrFiled) Object.assign(patch, { status: 'active', stage: 'reconsideration', mr_due_on: null });
  if (b.reopen) Object.assign(patch, { status: 'active' });

  const { error } = await supabase.from('case_proceedings').update(patch).eq('id', pid);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  logAudit({
    firmId: session!.firmId,
    entityType: 'Case',
    entityId: id,
    action: b.decision ? 'decision recorded' : b.mrFiled ? 'MR filed' : b.stage ? 'stage moved' : 'proceeding updated',
    performedBy: session!.user.notionUserId,
    newValue: JSON.stringify({ proceedingId: pid, ...b }),
    ipAddress: getClientIP(req),
  });
  return caseResponse(session!.firmId, id);
}

/** DELETE — a proceeding filed by mistake. One with proceedings filed on it can't go (the tree would break). */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string; pid: string }> }) {
  const session = await getSession();
  const refused = refuseCaseWrite(session);
  if (refused) return refused;
  const { id, pid } = await params;

  const supabase = await getSupabaseServerAuthClient();
  const { count } = await supabase.from('case_proceedings').select('id', { count: 'exact', head: true }).eq('parent_id', pid);
  if (count) return NextResponse.json({ error: 'Remove what was filed on this proceeding first' }, { status: 409 });
  const { error } = await supabase.from('case_proceedings').delete().eq('id', pid).eq('case_id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  logAudit({
    firmId: session!.firmId,
    entityType: 'Case',
    entityId: id,
    action: 'proceeding removed',
    performedBy: session!.user.notionUserId,
    oldValue: pid,
    ipAddress: getClientIP(req),
  });
  return caseResponse(session!.firmId, id);
}
