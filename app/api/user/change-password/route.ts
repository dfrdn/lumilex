import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getSession } from '@/lib/session';
import { getSupabase } from '@/lib/supabase';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { checkRateLimit, AUTH_LIMITS } from '@/lib/rate-limit';
import { logAudit, getClientIP } from '@/lib/audit';
import { refuseInDemo } from '@/lib/demo/guard';

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const refusal = await refuseInDemo(session.firmId, 'Changing the password');
  if (refusal) return refusal;

  // Rate limit by user
  const rl = checkRateLimit(`change-password:${session.user.email}`, AUTH_LIMITS.changePassword);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many attempts. Try again later.' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } },
    );
  }

  const { currentPassword, newPassword, confirmPassword } = await req.json();

  if (!currentPassword || !newPassword || !confirmPassword) {
    return NextResponse.json({ error: 'All fields are required' }, { status: 400 });
  }
  if (newPassword !== confirmPassword) {
    return NextResponse.json({ error: 'New passwords do not match' }, { status: 400 });
  }
  if (newPassword.length < 6) {
    return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 });
  }

  const email = session.user.email.toLowerCase().trim();

  // Verify the current password against Supabase Auth with a throwaway
  // publishable-key client — the service-role singleton must never hold a
  // user session, and the SSR client would clobber the caller's cookies.
  const verifier = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { error: verifyError } = await verifier.auth.signInWithPassword({
    email,
    password: currentPassword,
  });
  if (verifyError) {
    return NextResponse.json({ error: 'Current password is incorrect' }, { status: 401 });
  }

  const db = getServiceDbForFirm(session.firmId);
  const { data: member } = await db
    .from('team')
    .select('auth_user_id')
    .eq('email', email)
    .maybeSingle();

  if (!member?.auth_user_id) {
    return NextResponse.json({ error: 'No password set for this account' }, { status: 404 });
  }

  // Raw client: auth admin is not firm-scoped.
  const { error } = await getSupabase().auth.admin.updateUserById(member.auth_user_id, {
    password: newPassword,
  });

  if (error) {
    console.error('[change-password] Failed:', error);
    return NextResponse.json({ error: 'Failed to update password' }, { status: 500 });
  }

  // Fire-and-forget audit log (no old/new values for security)
  logAudit({
    firmId: session.firmId,
    entityType: 'auth',
    action: 'password_change',
    performedBy: session.user.notionUserId ?? session.user.email,
    ipAddress: getClientIP(req),
  });

  return NextResponse.json({ success: true });
}
