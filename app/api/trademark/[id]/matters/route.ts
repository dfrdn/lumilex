import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { setMatterLink } from '@/lib/corporations/matter-links';
import { MARK_SCOPES, MARK_SCOPE_LABEL, markMatterLinks } from '@/lib/trademarks/matter-links';
import { TRADEMARK_SELECT, rowToTrademark } from '@/lib/trademark-row';
import { validateBody } from '@/lib/validation';
import { logAudit, getClientIP } from '@/lib/audit';

const schema = z.object({
  scope: z.enum(MARK_SCOPES),
  matterId: z.string().trim().min(1).max(200).nullable(),
});

/** GET /api/trademark/[id]/matters — the matters covering a mark, by role. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user?.notionUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const supabase = await getSupabaseServerAuthClient();
  return NextResponse.json({ links: await markMatterLinks(supabase, id) });
}

/**
 * PUT /api/trademark/[id]/matters — which matter covers the mark in a role
 * (filing, DAU & renewal, opposition, retainer), or none. Writes the mark's
 * matter_subjects link; the database keeps trademarks.matter_id pointing at
 * its main matter for the readers that still show one.
 */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user?.notionUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const validation = await validateBody(req, schema);
  if (!validation.success) return validation.response;
  const { scope, matterId } = validation.data;
  const { id } = await params;

  const supabase = await getSupabaseServerAuthClient();
  const { data: mark } = await supabase.from('trademarks').select('id, mark').eq('id', id).maybeSingle();
  if (!mark) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (matterId) {
    const { data: matter } = await supabase.from('matters').select('notion_id').eq('notion_id', matterId).maybeSingle();
    if (!matter) return NextResponse.json({ error: 'That matter does not exist.' }, { status: 400 });
  }

  const before = (await markMatterLinks(supabase, id)).find((l) => l.scope === scope);
  try {
    await setMatterLink(supabase, session.firmId, id, scope, matterId);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Linking failed' }, { status: 500 });
  }

  logAudit({
    firmId: session.firmId,
    entityType: 'Trademark',
    entityId: id,
    entityName: (mark.mark as string | null) ?? undefined,
    action: 'matter_linked',
    fieldChanged: MARK_SCOPE_LABEL[scope],
    oldValue: before?.matterName,
    newValue: matterId ?? undefined,
    performedBy: session.user.notionUserId,
    ipAddress: getClientIP(req),
  });

  const [links, { data: fresh }] = await Promise.all([
    markMatterLinks(supabase, id),
    supabase.from('trademarks').select(TRADEMARK_SELECT).eq('id', id).single(),
  ]);
  return NextResponse.json({ links, trademark: fresh ? rowToTrademark(fresh) : null });
}
