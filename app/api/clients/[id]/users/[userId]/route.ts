import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabase } from '@/lib/supabase';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { logAudit, getClientIP } from '@/lib/audit';
import { refuseInDemo } from '@/lib/demo/guard';

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; userId: string }> },
) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const role = session.user.role;
  if (role !== 'partner' && role !== 'admin' && role !== 'super_user') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const demoRefusal = await refuseInDemo(session.firmId, 'Removing portal users');
  if (demoRefusal) return demoRefusal;

  const { id: clientId, userId } = await params;
  const supabase = getSupabase();
  const db = getServiceDbForFirm(session.firmId);

  const { data: row } = await db
    .from('client_users')
    .select('id, auth_user_id, email, client_id')
    .eq('id', userId)
    .maybeSingle();

  if (!row || row.client_id !== clientId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  if (row.auth_user_id) {
    const { error: deleteAuthError } = await supabase.auth.admin.deleteUser(row.auth_user_id);
    if (deleteAuthError) {
      console.error('admin.deleteUser failed:', deleteAuthError);
      return NextResponse.json({ error: 'Failed to revoke access' }, { status: 500 });
    }
    // client_users row deletes via ON DELETE CASCADE on auth_user_id FK.
  } else {
    const { error } = await db.from('client_users').delete().eq('id', userId);
    if (error) {
      return NextResponse.json({ error: 'Failed to revoke access' }, { status: 500 });
    }
  }

  logAudit({
    firmId: session.firmId,
    entityType: 'client_user',
    entityId: userId,
    entityName: row.email,
    action: 'revoked',
    performedBy: session.user.notionUserId,
    ipAddress: getClientIP(req),
  });

  return NextResponse.json({ ok: true });
}
