import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { LAWYER_ROLES, PARTNER_ROLES } from '@/lib/queries/people';

/** GET all active team members (for @mention dropdowns, etc.)
 *
 * Optional `?role=lawyers` narrows results to roles that can be assigned to
 * matters (lawyer + partner + super_user), excluding admin/finance staff.
 * `?role=partners` narrows further to partners only.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const roleFilter = req.nextUrl.searchParams.get('role');

  const supabase = await getSupabaseServerAuthClient();
  // RLS (team_authenticated_select) scopes to team-wide read for authenticated users.
  let query = supabase
    .from('team')
    .select('person_id, name, initials, position, active, role, avatar_url, start_date')
    .eq('active', true);
  if (roleFilter === 'lawyers') {
    query = query.in('role', [...LAWYER_ROLES]);
  } else if (roleFilter === 'partners') {
    query = query.in('role', [...PARTNER_ROLES]);
  }
  const { data, error } = await query.order('name', { ascending: true });

  if (error) {
    console.error('[people]', error.message); return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }

  return NextResponse.json({
    people: (data ?? []).map((row: any) => ({
      person_id: row.person_id,
      name: row.name ?? '',
      initials: row.initials ?? '??',
      position: row.position ?? '',
      active: row.active ?? false,
      role: row.role ?? '',
      avatar_url: row.avatar_url ?? null,
      start_date: row.start_date ?? null,
    })),
  });
}

/** Resolve person IDs to initials and names for client-side display */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { personIds } = await req.json();
  if (!Array.isArray(personIds) || personIds.length === 0) {
    return NextResponse.json({ people: [] });
  }

  const supabase = await getSupabaseServerAuthClient();
  const { data, error } = await supabase
    .from('team')
    .select('person_id, name, initials, position, avatar_url')
    .in('person_id', personIds);

  if (error) {
    console.error('[people]', error.message); return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }

  const people = (data ?? []).map((row: any) => ({
    id: row.person_id,
    name: row.name ?? '',
    initials: row.initials ?? '??',
    position: row.position ?? '',
    avatar_url: row.avatar_url ?? null,
  }));

  return NextResponse.json({ people });
}
