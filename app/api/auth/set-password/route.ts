import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { getSession } from '@/lib/session';
import { getSupabase } from '@/lib/supabase';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { setPasswordSchema, validateBody } from '@/lib/validation';
import { checkRateLimit, AUTH_LIMITS } from '@/lib/rate-limit';
import { logAudit, getClientIP } from '@/lib/audit';
import { refuseInDemo } from '@/lib/demo/guard';

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const rl = checkRateLimit(`set-password:${ip}`, AUTH_LIMITS.setPassword);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many attempts. Try again later.' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } },
    );
  }

  const session = await getSession();
  const setupSecret = req.headers.get('x-setup-secret');
  const expectedSecret = process.env.SETUP_SECRET;
  let isSetupMode = false;
  if (setupSecret && expectedSecret) {
    try {
      const a = Buffer.from(setupSecret);
      const b = Buffer.from(expectedSecret);
      isSetupMode = a.length === b.length && timingSafeEqual(a, b);
    } catch {
      isSetupMode = false;
    }
  }
  const role = session?.user?.role;
  const isAdmin = role === 'partner' || role === 'super_user' || role === 'admin';

  if (!isSetupMode && !isAdmin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const validation = await validateBody(req, setPasswordSchema);
  if (!validation.success) return validation.response;
  const { email, password } = validation.data;

  const normalizedEmail = email.toLowerCase().trim();
  // firm-resolution lookup: scoped client follows. In setup mode there is no
  // session (and so no firmId) — the email → team lookup IS the firm/user
  // resolution. Everything after it is either auth-admin work (not firm-scoped)
  // or goes through the scoped client below.
  const supabase = getSupabase();

  const { data: member } = await supabase
    .from('team')
    .select('person_id, name, auth_user_id, firm_id')
    .eq('email', normalizedEmail)
    .eq('active', true)
    .single();

  if (!member) {
    return NextResponse.json({ error: 'No active team member found with this email' }, { status: 404 });
  }
  const firmId = member.firm_id as string;

  // The lookup above is by email across every firm, because setup mode has no
  // session to scope it by. A signed-in admin is held to their own firm here —
  // without this, a partner at one firm could set, and so take over, the login
  // of anyone at another.
  if (!isSetupMode && firmId !== session?.firmId) {
    return NextResponse.json({ error: 'No active team member found with this email' }, { status: 404 });
  }
  const refusal = await refuseInDemo(firmId, 'Setting a password');
  if (refusal) return refusal;

  if (member.auth_user_id) {
    const { error } = await supabase.auth.admin.updateUserById(member.auth_user_id, {
      password,
    });
    if (error) {
      console.error('Failed to update auth user password:', error);
      return NextResponse.json({ error: 'Failed to set password' }, { status: 500 });
    }
  } else {
    const { data: created, error } = await supabase.auth.admin.createUser({
      email: normalizedEmail,
      password,
      email_confirm: true,
      user_metadata: { name: member.name, person_id: member.person_id },
    });
    if (error || !created.user) {
      console.error('Failed to create auth user:', error);
      return NextResponse.json({ error: 'Failed to set password' }, { status: 500 });
    }
    const { error: linkError } = await getServiceDbForFirm(firmId)
      .from('team')
      .update({ auth_user_id: created.user.id })
      .eq('person_id', member.person_id);
    if (linkError) {
      console.error('Failed to link team row to auth user:', linkError);
      return NextResponse.json({ error: 'Failed to set password' }, { status: 500 });
    }
  }

  logAudit({
    firmId,
    entityType: 'auth',
    action: 'password_set',
    entityName: normalizedEmail,
    performedBy: session?.user?.notionUserId ?? 'system',
    ipAddress: getClientIP(req),
  });

  return NextResponse.json({ success: true });
}
