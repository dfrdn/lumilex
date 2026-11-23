import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { getClientIP } from '@/lib/audit';
import { canSwitchPortal, portalSwitchPreview } from '@/lib/portal/switch-access';

/**
 * What the client will see once this is switched on, for the person deciding.
 * `?access` answers only whether they may switch it. Not under /api/portal,
 * which the proxy keeps for client users.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user?.notionUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const authed = await getSupabaseServerAuthClient();
  const { data: subject } = await authed.from('corporations').select('id').eq('id', id).maybeSingle();
  if (!subject) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const who = { firmId: session.firmId, personId: session.user.notionUserId, role: session.user.role };
  if (new URL(req.url).searchParams.has('access')) {
    const access = await canSwitchPortal(getServiceDbForFirm(session.firmId), 'corporation', id, who);
    if (!access.ok) return NextResponse.json({ error: access.error, code: access.code }, { status: access.status });
    return NextResponse.json({ canSwitch: access.canSwitch });
  }

  const result = await portalSwitchPreview(getServiceDbForFirm(session.firmId), 'corporation', id, who, getClientIP(req));
  if (!result.ok) return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
  return NextResponse.json(result.preview);
}
