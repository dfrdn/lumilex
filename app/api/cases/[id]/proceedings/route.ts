import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { proceedingCreateSchema, validateBody } from '@/lib/validation';
import { logAudit, getClientIP } from '@/lib/audit';
import { caseResponse, refuseCaseWrite } from '@/lib/cases/api';
import { STAGES } from '@/lib/cases/stages';

/**
 * POST /api/cases/[id]/proceedings — file the case in a forum: the first
 * complaint, or a review, Information, appeal or petition on a proceeding
 * already in the tree. The case leaves evaluation; the parent a review,
 * Information or appeal was filed on is resolved (a Rule 65 petition runs
 * beside it). The proceeding starts at its track's first stage.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  const refused = refuseCaseWrite(session);
  if (refused) return refused;
  const { id } = await params;

  const validation = await validateBody(req, proceedingCreateSchema);
  if (!validation.success) return validation.response;
  const b = validation.data;
  if ((b.relation === 'original') !== (b.parentId === null)) {
    return NextResponse.json({ error: 'A first filing has no parent; anything else is filed on one' }, { status: 400 });
  }
  if ((b.forumType === 'court') !== (b.courtLevel !== null)) {
    return NextResponse.json({ error: 'Pick the court level for a court, and only for a court' }, { status: 400 });
  }

  const supabase = await getSupabaseServerAuthClient();
  const { data: c } = await supabase.from('cases').select('id, status').eq('id', id).maybeSingle();
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const pid = randomUUID();
  const { error } = await supabase.from('case_proceedings').insert({
    firm_id: session!.firmId,
    id: pid,
    case_id: id,
    parent_id: b.parentId,
    relation: b.relation,
    forum_type: b.forumType,
    court_level: b.courtLevel,
    office: b.office,
    docket_no: b.docketNo,
    caption: b.caption,
    track: b.track,
    stage: STAGES[b.track][0].key,
    filed_on: b.filedOn,
  });
  if (error) return NextResponse.json({ error: `Filing the proceeding failed: ${error.message}` }, { status: error.code === '23514' ? 400 : 500 });

  if (b.matterIds.length) {
    await supabase.from('case_proceeding_matters').insert(b.matterIds.map((m) => ({ firm_id: session!.firmId, proceeding_id: pid, matter_id: m })));
    await supabase
      .from('matter_subjects')
      .upsert(b.matterIds.map((m) => ({ firm_id: session!.firmId, subject_id: id, scope: 'case', matter_id: m })), { onConflict: 'subject_id,scope,matter_id', ignoreDuplicates: true });
  }
  if (b.parentId && b.relation !== 'rule_65' && b.relation !== 'other') {
    const { data: parent } = await supabase.from('case_proceedings').select('status, track').eq('id', b.parentId).maybeSingle();
    if (parent?.status === 'active') {
      const final = parent.track ? [...STAGES[parent.track as keyof typeof STAGES]].reverse().find((s) => !s.optional)?.key : null;
      await supabase.from('case_proceedings').update({ status: 'resolved', ...(final ? { stage: final } : {}) }).eq('id', b.parentId);
    }
  }
  if (c.status === 'evaluation') await supabase.from('cases').update({ status: 'active' }).eq('id', id);

  logAudit({
    firmId: session!.firmId,
    entityType: 'Case',
    entityId: id,
    action: 'proceeding filed',
    performedBy: session!.user.notionUserId,
    newValue: JSON.stringify({ proceedingId: pid, relation: b.relation, office: b.office, docketNo: b.docketNo }),
    ipAddress: getClientIP(req),
  });
  return caseResponse(session!.firmId, id, 201);
}
