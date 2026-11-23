import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';

// Dev-only impersonation endpoint for examining the portal as a real
// client_users identity without going through the magic-link round-trip.
//
// GET /api/dev/portal-signin               → HTML picker of all client_users
// GET /api/dev/portal-signin?email=foo@... → signs in as that user, redirects to /portal
//
// Returns 404 in production. Mounted outside proxy.ts's auth gating so
// you can hit it while signed out (or while signed in as a team user).
export async function GET(req: NextRequest) {
  if (process.env.NODE_ENV !== 'development') {
    return new NextResponse('Not found', { status: 404 });
  }

  const url = new URL(req.url);
  const email = url.searchParams.get('email');
  // Raw service client, deliberately: dev-only impersonation (404 in prod)
  // lists identities across every firm and then does auth-admin work.
  const service = getSupabase();

  if (!email) {
    type RawRow = {
      id: string;
      email: string;
      name: string | null;
      client_id: string;
      clients: { full_company_name: string | null; name: string | null } | null;
    };

    const { data: users } = await service
      .from('client_users')
      .select('id, email, name, client_id, clients(full_company_name, name)')
      .eq('active', true)
      .order('email');

    const rows = ((users ?? []) as unknown as RawRow[])
      .map((u) => {
        const clientName = u.clients?.full_company_name || u.clients?.name || u.client_id;
        const label = u.name ? `${u.name} — ${clientName}` : `${u.email} — ${clientName}`;
        return `<li style="margin: 8px 0;">
          <a href="?email=${encodeURIComponent(u.email)}" style="color: #1e293b; text-decoration: underline;">
            Sign in as ${label}
          </a>
          <span style="color: #888; font-size: 12px; margin-left: 8px;">${u.email}</span>
        </li>`;
      })
      .join('');

    const empty = '<li style="color:#888;">No client_users yet. Invite one from /dashboard/clients/[id]/users.</li>';

    return new NextResponse(
      `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Dev Portal Impersonation</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 640px; margin: 0 auto; padding: 32px 24px; color: #1a1a1a;">
  <h1 style="margin: 0 0 6px 0;">Dev Portal Impersonation</h1>
  <p style="color: #555; margin: 0 0 24px 0;">Pick a client portal user. Clicking signs you in as that user and redirects to <code>/portal</code>. Only available in dev (returns 404 in production).</p>
  <ul style="list-style: none; padding: 0;">${(users && users.length) ? rows : empty}</ul>
</body>
</html>`,
      { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    );
  }

  const { data: row } = await service
    .from('client_users')
    .select('id, auth_user_id, email')
    .eq('email', email.toLowerCase())
    .maybeSingle();

  if (!row) {
    return new NextResponse(`No active client_users row for ${email}`, { status: 404 });
  }

  const { data: linkData, error: linkError } = await service.auth.admin.generateLink({
    type: 'magiclink',
    email: row.email,
  });

  if (linkError || !linkData?.properties?.hashed_token) {
    return new NextResponse(
      `admin.generateLink failed: ${linkError?.message ?? 'no hashed_token returned'}`,
      { status: 500 },
    );
  }

  const authClient = await getSupabaseServerAuthClient();
  const { error: verifyError } = await authClient.auth.verifyOtp({
    token_hash: linkData.properties.hashed_token,
    type: 'magiclink',
  });

  if (verifyError) {
    return new NextResponse(`verifyOtp failed: ${verifyError.message}`, { status: 500 });
  }

  return NextResponse.redirect(new URL('/portal', req.url));
}
