import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabase } from '@/lib/supabase';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { sendPortalInviteEmail } from '@/lib/email';
import { logAudit, getClientIP } from '@/lib/audit';
import { refuseInDemo } from '@/lib/demo/guard';

export async function POST(
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
  const demoRefusal = await refuseInDemo(session.firmId, 'Sending portal invitations');
  if (demoRefusal) return demoRefusal;

  const { id: clientId, userId } = await params;
  const supabase = getSupabase();

  const { data: row } = await getServiceDbForFirm(session.firmId)
    .from('client_users')
    .select('id, email, name, client_id, auth_user_id, last_login_at')
    .eq('id', userId)
    .maybeSingle();

  if (!row || row.client_id !== clientId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  if (row.last_login_at) {
    return NextResponse.json(
      { error: 'This user has already signed in. Resend is only available for pending invites.' },
      { status: 409 },
    );
  }

  const origin = new URL(req.url).origin;
  // 'magiclink' rather than 'invite' here: the user already exists in auth.users
  // (the initial inviteUserByEmail created them). Supabase rejects 'invite' for
  // existing users with email_exists. magiclink works for an existing user, and
  // clicking the link both confirms the email (if needed) and signs them in —
  // same effective outcome as accepting an invite.
  const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
    type: 'magiclink',
    email: row.email,
    options: {
      redirectTo: `${origin}/portal/auth/callback`,
    },
  });

  if (linkError || !linkData?.properties?.action_link) {
    console.error('generateLink failed:', linkError);
    return NextResponse.json({ error: 'Failed to generate invite link' }, { status: 500 });
  }

  const emailResult = await sendPortalInviteEmail({
    firmId: session.firmId,
    to: row.email,
    name: row.name ?? '',
    actionLink: linkData.properties.action_link,
  });

  if (!emailResult.ok) {
    return NextResponse.json({ error: emailResult.reason }, { status: 502 });
  }

  logAudit({
    firmId: session.firmId,
    entityType: 'client_user',
    entityId: userId,
    entityName: row.email,
    action: 'invite_resent',
    performedBy: session.user.notionUserId,
    ipAddress: getClientIP(req),
  });

  return NextResponse.json({ ok: true });
}
