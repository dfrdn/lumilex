import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { rowToCorporation } from '@/lib/corporation-row';
import { CORPORATE_SCOPES, CORPORATION_SELECT, setMatterLink } from '@/lib/corporations/matter-links';
import { validateBody } from '@/lib/validation';
import { logAudit, getClientIP } from '@/lib/audit';

const schema = z.object({
  scope: z.enum(CORPORATE_SCOPES),
  matterId: z.string().trim().min(1).max(200).nullable(),
});

/**
 * PUT /api/corporation/[id]/matters — which matter covers the company in a
 * role (incorporation, post-incorporation, housekeeping, retainer), or none.
 * A company is a subject; this writes its matter_subjects link.
 */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user?.notionUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const validation = await validateBody(req, schema);
  if (!validation.success) return validation.response;
  const { scope, matterId } = validation.data;
  const { id } = await params;

  const supabase = await getSupabaseServerAuthClient();
  const { data: before } = await supabase.from('corporations').select(CORPORATION_SELECT).eq('id', id).maybeSingle();
  if (!before) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (matterId) {
    const { data: matter } = await supabase.from('matters').select('notion_id').eq('notion_id', matterId).maybeSingle();
    if (!matter) return NextResponse.json({ error: 'That matter does not exist.' }, { status: 400 });
  }

  try {
    await setMatterLink(supabase, session.firmId, id, scope, matterId);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Linking failed' }, { status: 500 });
  }

  const prior = rowToCorporation(before as Record<string, unknown>);
  logAudit({
    firmId: session.firmId,
    entityType: 'Corporation',
    entityId: id,
    entityName: prior.approvedName ?? prior.proposedNames[0] ?? undefined,
    action: 'matter_linked',
    fieldChanged: scope,
    oldValue: { incorporation: prior.incorporationMatterId, post_incorporation: prior.postIncorporationMatterId, housekeeping: prior.housekeepingMatterId, retainer: prior.retainerMatterId }[scope] ?? undefined,
    newValue: matterId ?? undefined,
    performedBy: session.user.notionUserId,
    ipAddress: getClientIP(req),
  });

  const { data: fresh } = await supabase.from('corporations').select(CORPORATION_SELECT).eq('id', id).single();
  return NextResponse.json({ corporation: rowToCorporation(fresh as Record<string, unknown>) });
}
