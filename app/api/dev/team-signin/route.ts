import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';

// Dev-only impersonation endpoint for examining the dashboard as a real
// team identity without password sign-in. Sibling of /api/dev/portal-signin.
//
// GET /api/dev/team-signin               → HTML picker of active team users
// GET /api/dev/team-signin?email=foo@... → signs in as that user, redirects to /dashboard
//
// Returns 404 in production. Mounted outside proxy.ts's auth gating so
// you can hit it while signed out.
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
    const { data: users } = await service
      .from('team')
      .select('person_id, email, name, role')
      .eq('active', true)
      .not('auth_user_id', 'is', null)
      .order('name');

    const rows = (users ?? [])
      .map(
        (u) => `<li style="margin: 8px 0;">
          <a href="?email=${encodeURIComponent(u.email)}" style="color: #1e293b; text-decoration: underline;">
            Sign in as ${u.name}
          </a>
          <span style="color: #888; font-size: 12px; margin-left: 8px;">${u.email} · ${u.role}</span>
        </li>`,
      )
      .join('');

    return new NextResponse(
      `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Dev Team Impersonation</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 640px; margin: 0 auto; padding: 32px 24px; color: #1a1a1a;">
  <h1 style="margin: 0 0 6px 0;">Dev Team Impersonation</h1>
  <p style="color: #555; margin: 0 0 24px 0;">Pick a team user. Clicking signs you in as that user and redirects to <code>/dashboard</code>. Only available in dev (returns 404 in production).</p>
  <ul style="list-style: none; padding: 0;">${rows || '<li style="color:#888;">No team users with auth accounts.</li>'}</ul>
</body>
</html>`,
      { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    );
  }

  const { data: row } = await service
    .from('team')
    .select('person_id, auth_user_id, email')
    .eq('email', email.toLowerCase())
    .maybeSingle();

  if (!row?.auth_user_id) {
    return new NextResponse(`No team row with an auth account for ${email}`, { status: 404 });
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

  return NextResponse.redirect(new URL('/dashboard', req.url));
}
