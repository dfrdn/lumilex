import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/session';
import { getSupabase } from '@/lib/supabase';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { validateBody } from '@/lib/validation';
import { logAudit, getClientIP } from '@/lib/audit';
import { refuseInDemo } from '@/lib/demo/guard';
import { sendPortalInviteEmail } from '@/lib/email';

const InviteSchema = z.object({
  email: z.string().email().transform((s) => s.toLowerCase().trim()),
  name: z.string().trim().min(1).max(120),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const role = session.user.role;
  if (role !== 'partner' && role !== 'admin' && role !== 'super_user') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const demoRefusal = await refuseInDemo(session.firmId, 'Inviting portal users');
  if (demoRefusal) return demoRefusal;

  const { id: clientId } = await params;

  const validation = await validateBody(req, InviteSchema);
  if (!validation.success) return validation.response;
  const { email, name } = validation.data;

  const supabase = getSupabase();
  const db = getServiceDbForFirm(session.firmId);

  // Firm-scoped: a client id from another firm reads as absent → 404.
  const { data: client } = await db
    .from('clients')
    .select('notion_id')
    .eq('notion_id', clientId)
    .maybeSingle();
  if (!client) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 });
  }

  // The two email checks below stay on the raw client on purpose: auth.users
  // is a global namespace, so a collision in ANY firm must surface as a 409
  // here rather than as an opaque email_exists failure from createUser.
  const { data: existingTeam } = await supabase
    .from('team')
    .select('person_id')
    .eq('email', email)
    .maybeSingle();
  if (existingTeam) {
    return NextResponse.json(
      { error: 'This email belongs to a team member.' },
      { status: 409 },
    );
  }

  const { data: existingClient } = await supabase
    .from('client_users')
    .select('id, client_id')
    .eq('email', email)
    .maybeSingle();
  if (existingClient) {
    return NextResponse.json(
      {
        error:
          existingClient.client_id === clientId
            ? 'This email is already invited.'
            : 'This email belongs to another client.',
      },
      { status: 409 },
    );
  }

  const origin = new URL(req.url).origin;

  // Step 1: provision the auth user without sending Supabase's default email.
  // (The default email routes through Supabase SMTP and lands in iCloud junk.)
  const { data: created, error: createError } = await supabase.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { name },
  });
  if (createError || !created.user) {
    console.error('admin.createUser failed:', createError);
    return NextResponse.json({ error: 'Failed to provision auth user' }, { status: 500 });
  }

  // Step 2: insert the client_users row before sending the email so we never
  // leave an orphan auth.users behind if the row insert fails.
  const { error: insertError } = await db.from('client_users').insert({
    firm_id: session.firmId,
    auth_user_id: created.user.id,
    client_id: clientId,
    email,
    name,
  });
  if (insertError) {
    await supabase.auth.admin.deleteUser(created.user.id).catch(() => {});
    console.error('client_users insert failed:', insertError);
    return NextResponse.json({ error: 'Failed to register client user' }, { status: 500 });
  }

  // Step 3: mint a magic-link and deliver via Resend (DKIM-verified domain).
  // Mirrors the resend route — the auth user already exists at this point
  // so we cannot use the 'invite' link type (Supabase rejects it as email_exists).
  const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
    type: 'magiclink',
    email,
    options: { redirectTo: `${origin}/portal/auth/callback` },
  });
  if (linkError || !linkData?.properties?.action_link) {
    await db.from('client_users').delete().eq('auth_user_id', created.user.id);
    await supabase.auth.admin.deleteUser(created.user.id).catch(() => {});
    console.error('generateLink failed:', linkError);
    return NextResponse.json({ error: 'Failed to generate invite link' }, { status: 500 });
  }

  const emailResult = await sendPortalInviteEmail({
    firmId: session.firmId,
    to: email,
    name,
    actionLink: linkData.properties.action_link,
  });
  if (!emailResult.ok) {
    await db.from('client_users').delete().eq('auth_user_id', created.user.id);
    await supabase.auth.admin.deleteUser(created.user.id).catch(() => {});
    return NextResponse.json({ error: emailResult.reason }, { status: 502 });
  }

  logAudit({
    firmId: session.firmId,
    entityType: 'client_user',
    entityId: created.user.id,
    entityName: email,
    action: 'invited',
    performedBy: session.user.notionUserId,
    ipAddress: getClientIP(req),
  });

  return NextResponse.json({ ok: true });
}
