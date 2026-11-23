import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { logAudit, getClientIP } from '@/lib/audit';

const TEAM_ROLES_ALLOWED = new Set([
  'lawyer',
  'partner',
  'admin',
  'super_user',
  'chief_liaison_officer',
  'liaison_officer',
]);

/**
 * PATCH /api/matters/[id]/file-requests/[requestId]
 * Cancels the request (soft-delete via canceled_at). Idempotent: a request
 * already canceled returns 200.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; requestId: string }> },
) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!TEAM_ROLES_ALLOWED.has(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id: matterId, requestId } = await params;
  const supabase = await getSupabaseServerAuthClient();

  const { data: existing } = await supabase
    .from('file_requests')
    .select('id, matter_id, canceled_at, description')
    .eq('id', requestId)
    .maybeSingle();
  if (!existing || existing.matter_id !== matterId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (existing.canceled_at) {
    return NextResponse.json({ ok: true, alreadyCanceled: true });
  }

  const { error } = await supabase
    .from('file_requests')
    .update({ canceled_at: new Date().toISOString() })
    .eq('id', requestId);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  logAudit({
    firmId: session.firmId,
    entityType: 'file_request',
    entityId: requestId,
    entityName: existing.description.slice(0, 80),
    action: 'canceled',
    performedBy: session.user.notionUserId,
    ipAddress: getClientIP(req),
  });

  return NextResponse.json({ ok: true });
}
