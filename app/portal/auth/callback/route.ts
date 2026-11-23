import { NextResponse, type NextRequest } from 'next/server';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { getSupabase } from '@/lib/supabase';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';

export async function GET(req: NextRequest) {
  const { searchParams, origin } = req.nextUrl;
  const code = searchParams.get('code');
  const explicitNext = searchParams.get('next');

  if (!code) {
    return NextResponse.redirect(new URL('/portal/login?error=missing_code', origin));
  }

  const supabase = await getSupabaseServerAuthClient();
  const { error, data } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data.user) {
    return NextResponse.redirect(new URL('/portal/login?error=invalid_code', origin));
  }

  // Read last_login_at BEFORE updating so we know whether this is the user's
  // first sign-in. If so, route them through /portal/welcome unless the
  // invite link carried an explicit `next` (e.g. a deep-link to a matter).
  // firm-resolution lookup: scoped client follows. The portal session does not
  // exist yet at this point, so the auth user id → client_users row IS what
  // establishes which firm this sign-in belongs to.
  const { data: clientUser } = await getSupabase()
    .from('client_users')
    .select('last_login_at, firm_id')
    .eq('auth_user_id', data.user.id)
    .maybeSingle();
  const isFirstSignIn = clientUser !== null && clientUser.last_login_at === null;

  // Fire-and-forget update so the read above is meaningful next time too.
  if (clientUser) {
    getServiceDbForFirm(clientUser.firm_id as string)
      .from('client_users')
      .update({ last_login_at: new Date().toISOString() })
      .eq('auth_user_id', data.user.id)
      .then(() => {});
  }

  const next = explicitNext ?? (isFirstSignIn ? '/portal/welcome' : '/portal');
  return NextResponse.redirect(new URL(next, origin));
}
