import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { caseMatterLinkSchema, validateBody } from '@/lib/validation';
import { logAudit, getClientIP } from '@/lib/audit';
import { caseResponse, refuseCaseWrite } from '@/lib/cases/api';

/**
 * PUT /api/cases/[id]/matters — a matter covers the case, handling the
 * proceedings named (none: it covers the evaluation). Replaces what that
 * matter handled before.
 */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  const refused = refuseCaseWrite(session);
  if (refused) return refused;
  const { id } = await params;

  const validation = await validateBody(req, caseMatterLinkSchema);
  if (!validation.success) return validation.response;
  const { matterId, proceedingIds } = validation.data;

  const supabase = await getSupabaseServerAuthClient();
  const { data: procs } = await supabase.from('case_proceedings').select('id').eq('case_id', id);
  const ours = new Set((procs ?? []).map((p) => p.id as string));
  if (proceedingIds.some((p) => !ours.has(p))) return NextResponse.json({ error: 'Those proceedings aren’t this case’s' }, { status: 400 });

  const { error } = await supabase
    .from('matter_subjects')
    .upsert({ firm_id: session!.firmId, subject_id: id, scope: 'case', matter_id: matterId }, { onConflict: 'subject_id,scope,matter_id', ignoreDuplicates: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (ours.size) await supabase.from('case_proceeding_matters').delete().eq('matter_id', matterId).in('proceeding_id', [...ours]);
  if (proceedingIds.length) {
    const { error: e2 } = await supabase.from('case_proceeding_matters').insert(proceedingIds.map((p) => ({ firm_id: session!.firmId, proceeding_id: p, matter_id: matterId })));
    if (e2) return NextResponse.json({ error: e2.message }, { status: 500 });
  }

  logAudit({
    firmId: session!.firmId,
    entityType: 'Case',
    entityId: id,
    action: 'matter linked',
    performedBy: session!.user.notionUserId,
    newValue: JSON.stringify({ matterId, proceedingIds }),
    ipAddress: getClientIP(req),
  });
  return caseResponse(session!.firmId, id);
}

const unlinkSchema = z.object({ matterId: z.string().min(1).max(100) });

/** DELETE — the matter no longer covers the case. Its hearings stay where they are. */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  const refused = refuseCaseWrite(session);
  if (refused) return refused;
  const { id } = await params;

  const validation = await validateBody(req, unlinkSchema);
  if (!validation.success) return validation.response;
  const { matterId } = validation.data;

  const supabase = await getSupabaseServerAuthClient();
  const { data: procs } = await supabase.from('case_proceedings').select('id').eq('case_id', id);
  const ids = (procs ?? []).map((p) => p.id as string);
  if (ids.length) await supabase.from('case_proceeding_matters').delete().eq('matter_id', matterId).in('proceeding_id', ids);
  const { error } = await supabase.from('matter_subjects').delete().eq('subject_id', id).eq('scope', 'case').eq('matter_id', matterId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  logAudit({
    firmId: session!.firmId,
    entityType: 'Case',
    entityId: id,
    action: 'matter unlinked',
    performedBy: session!.user.notionUserId,
    oldValue: matterId,
    ipAddress: getClientIP(req),
  });
  return caseResponse(session!.firmId, id);
}
