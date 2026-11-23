import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { caseCreateSchema, validateBody } from '@/lib/validation';
import { logAudit, getClientIP } from '@/lib/audit';
import { refuseCaseWrite } from '@/lib/cases/api';

/**
 * POST /api/cases — open a case in evaluation, before anything is filed, on
 * the matters that will handle it. The cases trigger writes its subjects row.
 */
export async function POST(req: Request) {
  const session = await getSession();
  const refused = refuseCaseWrite(session);
  if (refused) return refused;

  const validation = await validateBody(req, caseCreateSchema);
  if (!validation.success) return validation.response;
  const body = validation.data;

  const supabase = await getSupabaseServerAuthClient();
  const id = randomUUID();
  const { error } = await supabase.from('cases').insert({
    firm_id: session!.firmId,
    id,
    working_title: body.workingTitle,
    nature: body.nature ?? null,
    client_role: body.clientRole ?? null,
    status: 'evaluation',
    created_by: session!.user.notionUserId,
  });
  if (error) return NextResponse.json({ error: `Opening the case failed: ${error.message}` }, { status: 500 });

  if (body.matterIds.length) {
    const { error: linkErr } = await supabase
      .from('matter_subjects')
      .insert(body.matterIds.map((m) => ({ firm_id: session!.firmId, subject_id: id, scope: 'case', matter_id: m })));
    if (linkErr) return NextResponse.json({ error: `The case was opened, but its matters weren't linked: ${linkErr.message}`, id }, { status: 500 });
  }

  logAudit({
    firmId: session!.firmId,
    entityType: 'Case',
    entityId: id,
    action: 'created',
    performedBy: session!.user.notionUserId,
    entityName: body.workingTitle,
    newValue: JSON.stringify({ matterIds: body.matterIds }),
    ipAddress: getClientIP(req),
  });
  return NextResponse.json({ id }, { status: 201 });
}
