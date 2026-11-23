import { getSession } from '@/lib/session';
import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { logAudit, getClientIP } from '@/lib/audit';
import { mintId } from '@/lib/ids';
import { USER_ROLES, isUserRole } from '@/lib/roles';
import { refuseInDemo } from '@/lib/demo/guard';
import { cascadeTeamRename } from '@/lib/team/cascade-rename';


async function assertSuperUser() {
  const session = await getSession();
  if (!session?.user?.role || session.user.role !== 'super_user') {
    return null;
  }
  return session;
}

// ---------------------------------------------------------------------------
// GET  /api/admin/users
// Fetch all team members.
// ---------------------------------------------------------------------------
export async function GET() {
  const session = await assertSuperUser();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = getServiceDbForFirm(session.firmId);
  const { data, error } = await supabase
    .from('team')
    .select('*')
    .order('name', { ascending: true });

  if (error) {
    console.error('[admin-users]', error.message); return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }

  return NextResponse.json({ data });
}

// ---------------------------------------------------------------------------
// PATCH  /api/admin/users
// Update a team member's fields.
// Body: { personId: string, field: string, value: string | boolean }
// ---------------------------------------------------------------------------
const EDITABLE_FIELDS = ['name', 'email', 'position', 'role', 'active', 'initials', 'mobile_number', 'start_date', 'monthly_salary'] as const;

export async function PATCH(req: NextRequest) {
  const session = await assertSuperUser();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const demoRefusal = await refuseInDemo(session.firmId, 'Managing user accounts');
  if (demoRefusal) return demoRefusal;

  const { personId, field, value, role } = await req.json();

  if (!personId) {
    return NextResponse.json({ error: 'personId is required' }, { status: 400 });
  }

  // Support legacy format: { personId, role }
  const updateField = field ?? (role ? 'role' : null);
  const updateValue = field ? value : role;

  if (!updateField) {
    return NextResponse.json({ error: 'field and value are required' }, { status: 400 });
  }

  if (!EDITABLE_FIELDS.includes(updateField as any)) {
    return NextResponse.json(
      { error: `Invalid field. Must be one of: ${EDITABLE_FIELDS.join(', ')}` },
      { status: 400 },
    );
  }

  if (updateField === 'role' && !isUserRole(updateValue)) {
    return NextResponse.json(
      { error: `Invalid role. Must be one of: ${USER_ROLES.join(', ')}` },
      { status: 400 },
    );
  }

  let normalisedValue: unknown = updateValue;
  if (updateField === 'monthly_salary') {
    if (updateValue === null || updateValue === '' || updateValue === undefined) {
      normalisedValue = null;
    } else {
      const n = Number(updateValue);
      if (!Number.isFinite(n) || n < 0) {
        return NextResponse.json(
          { error: 'monthly_salary must be a non-negative number or null' },
          { status: 400 },
        );
      }
      normalisedValue = Math.round(n * 100) / 100;
    }
  }

  const supabase = getServiceDbForFirm(session.firmId);

  // Sign-in resolves a team row by auth_user_id, not by team.email, so changing
  // only the column left the login on the old address: the person could still
  // sign in with the mailbox the firm believed it had changed or retired. The
  // login moves first, and moves back if the row update then fails. The row is
  // read through the firm-scoped client, so a personId from another firm finds
  // nothing and no login is touched.
  let oldEmail: string | undefined;
  let movedLogin: { authUserId: string; from: string } | null = null;
  if (updateField === 'email') {
    const email = String(updateValue ?? '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: 'Enter a valid email address' }, { status: 400 });
    }
    normalisedValue = email;
    const { data: member } = await supabase
      .from('team')
      .select('auth_user_id, email')
      .eq('person_id', personId)
      .maybeSingle();
    if (!member) return NextResponse.json({ error: 'Team member not found' }, { status: 404 });
    oldEmail = member.email ?? undefined;
    if (member.auth_user_id && member.email?.toLowerCase() !== email) {
      // Raw client: auth admin is not firm-scoped.
      const { error: authError } = await getSupabase().auth.admin.updateUserById(member.auth_user_id, {
        email,
        email_confirm: true,
      });
      if (authError) {
        // Auth addresses are unique across the whole instance, so this is
        // usually "already taken".
        return NextResponse.json({ error: `Could not move the login: ${authError.message}` }, { status: 400 });
      }
      movedLogin = { authUserId: member.auth_user_id, from: member.email ?? '' };
    }
  }

  // A rename needs the old name: it is what the audit log records and what the
  // cascade below matches the denormalized copies on.
  let previousName: string | undefined;
  if (updateField === 'name') {
    normalisedValue = String(updateValue ?? '').trim();
    if (!normalisedValue) {
      return NextResponse.json({ error: 'Name cannot be empty' }, { status: 400 });
    }
    const { data: member } = await supabase
      .from('team')
      .select('name')
      .eq('person_id', personId)
      .maybeSingle();
    if (!member) return NextResponse.json({ error: 'Team member not found' }, { status: 404 });
    previousName = member.name ?? undefined;
  }

  const { error } = await supabase
    .from('team')
    .update({ [updateField]: normalisedValue })
    .eq('person_id', personId);

  if (error) {
    if (movedLogin?.from) {
      await getSupabase().auth.admin.updateUserById(movedLogin.authUserId, { email: movedLogin.from, email_confirm: true });
    }
    console.error('[admin-users]', error.message); return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }

  // A name lives on as a copy in the DTR and finance tables, and billing prices
  // an attendee by that copy. Awaited, not fire-and-forget: a stale copy blocks
  // that person's hours from being invoiced until it is fixed.
  let rename: Awaited<ReturnType<typeof cascadeTeamRename>> | null = null;
  if (updateField === 'name' && previousName) {
    rename = await cascadeTeamRename(supabase, session.firmId, {
      personId,
      oldName: previousName,
      newName: String(normalisedValue),
    });
  }

  // Fire-and-forget audit log
  logAudit({
    firmId: session.firmId,
    entityType: 'user',
    entityId: personId,
    action: 'update',
    fieldChanged: updateField,
    oldValue: updateField === 'name' ? previousName : oldEmail,
    newValue: String(normalisedValue ?? ''),
    performedBy: session.user.notionUserId,
    ipAddress: getClientIP(req),
  });

  return NextResponse.json({ success: true, ...(rename ? { rename } : {}) });
}

// ---------------------------------------------------------------------------
// POST  /api/admin/users
// Create a new team member with a password.
// Body: { name, email, position, role, password }
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  const session = await assertSuperUser();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const demoRefusal = await refuseInDemo(session.firmId, 'Managing user accounts');
  if (demoRefusal) return demoRefusal;

  const { name, email, position, role, password } = await req.json();

  if (!name || !email || !role || !password) {
    return NextResponse.json(
      { error: 'name, email, role, and password are required' },
      { status: 400 },
    );
  }

  if (!isUserRole(role)) {
    return NextResponse.json(
      { error: `Invalid role. Must be one of: ${USER_ROLES.join(', ')}` },
      { status: 400 },
    );
  }

  if (password.length < 6) {
    return NextResponse.json(
      { error: 'Password must be at least 6 characters' },
      { status: 400 },
    );
  }

  const normalizedEmail = email.toLowerCase().trim();
  const db = getServiceDbForFirm(session.firmId);

  // Check if email already exists
  const { data: existing } = await db
    .from('team')
    .select('person_id')
    .eq('email', normalizedEmail)
    .single();

  if (existing) {
    return NextResponse.json(
      { error: 'A team member with this email already exists' },
      { status: 409 },
    );
  }

  // One minted id serves as both notion_id and person_id for app-created users.
  const newPersonId = mintId('user');

  // Build initials from name
  const initials = name
    .split(' ')
    .map((w: string) => w.charAt(0).toUpperCase())
    .join('')
    .slice(0, 2);

  // Create the confirmed auth user first — if this fails there is nothing to
  // roll back. Raw client: auth admin is not firm-scoped.
  const { data: created, error: authError } = await getSupabase().auth.admin.createUser({
    email: normalizedEmail,
    password,
    email_confirm: true,
  });

  if (authError) {
    return NextResponse.json({ error: authError.message }, { status: 500 });
  }

  // Insert team member bound to the auth user
  const { error: teamError } = await db.from('team').insert({
    firm_id: session.firmId,
    notion_id: newPersonId,
    person_id: newPersonId,
    name,
    initials,
    email: normalizedEmail,
    position: position || '',
    role,
    active: true,
    auth_user_id: created.user.id,
    created_time: new Date().toISOString(),
  });

  if (teamError) {
    // Don't leave an orphaned auth user that would 409 a retry.
    await getSupabase().auth.admin.deleteUser(created.user.id);
    return NextResponse.json({ error: teamError.message }, { status: 500 });
  }

  // Fire-and-forget audit log
  logAudit({
    firmId: session.firmId,
    entityType: 'user',
    entityId: newPersonId,
    action: 'create',
    entityName: name,
    performedBy: session.user.notionUserId,
    ipAddress: getClientIP(req),
  });

  return NextResponse.json({ success: true });
}
