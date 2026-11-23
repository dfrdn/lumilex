import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { notifyApplicantOfLeaveAction } from '@/lib/notifications';

/**
 * GET — list all leave requests (partner/super_user only)
 * PATCH — approve or reject a leave
 */
export async function GET() {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const role = session.user.role ?? 'lawyer';
  if (role !== 'partner' && role !== 'super_user') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const supabase = await getSupabaseServerAuthClient();
  // Cross-team name enrichment needs service-role until PR 2 opens team-wide
  // reads. RLS (leaves_own_select) already authorizes the partner read.
  const service = getServiceDbForFirm(session.firmId);
  const { data, error } = await supabase
    .from('leaves')
    .select('*')
    .order('period_start', { ascending: false });

  if (error) {
    console.error('[partner-leaves]', error.message); return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }

  // Resolve applicant names. Leaves can come from anyone on the team
  // (lawyers, admins, finance). Try each source in order: live team join →
  // denormalized name → created_by_name (when it's a real person, not the
  // workspace bot) → reason prefix `[Lastname]` matched against team names.
  const leaves = data ?? [];
  // `created_by_name` is a legacy Notion-era field. The two workspace-bot names
  // it used to carry belonged to the pre-fork installation and match no row in
  // this database; a blank name is the only non-person value left.
  const BOT_CREATORS = new Set(['']);

  const personIds = Array.from(
    new Set(
      leaves
        .flatMap((l) => [l.person_id, l.decided_by])
        .filter((id): id is string => !!id),
    ),
  );
  const nameById = new Map<string, string>();
  const avatarById = new Map<string, string | null>();
  if (personIds.length > 0) {
    const { data: members } = await service
      .from('team')
      .select('person_id, notion_id, name, avatar_url')
      .or(`person_id.in.(${personIds.join(',')}),notion_id.in.(${personIds.join(',')})`);
    for (const m of members ?? []) {
      if (m.name) {
        if (m.person_id) nameById.set(m.person_id, m.name);
        if (m.notion_id) nameById.set(m.notion_id, m.name);
      }
      if (m.person_id) avatarById.set(m.person_id, m.avatar_url ?? null);
      if (m.notion_id) avatarById.set(m.notion_id, m.avatar_url ?? null);
    }
  }

  // Build a lastName → fullName map only if we'll need it.
  const bracketRe = /^\s*\[([^\]]+)\]/;
  const neededLastNames = new Set<string>();
  for (const l of leaves) {
    const live = l.person_id ? nameById.get(l.person_id) : undefined;
    if (live || l.name || (l.created_by_name && !BOT_CREATORS.has(l.created_by_name))) continue;
    const m = bracketRe.exec(l.reason ?? '');
    if (m) neededLastNames.add(m[1].trim().toLowerCase());
  }
  const nameByLastName = new Map<string, string>();
  if (neededLastNames.size > 0) {
    const { data: allTeam } = await service
      .from('team')
      .select('name')
      .eq('active', true);
    for (const t of allTeam ?? []) {
      if (!t.name) continue;
      const last = t.name.split(' ').pop()?.toLowerCase();
      if (last && neededLastNames.has(last) && !nameByLastName.has(last)) {
        nameByLastName.set(last, t.name);
      }
    }
  }

  const enriched = leaves.map((l) => {
    const fromTeam = l.person_id ? nameById.get(l.person_id) : undefined;
    const fromCreator = l.created_by_name && !BOT_CREATORS.has(l.created_by_name)
      ? l.created_by_name
      : undefined;
    const bracketMatch = bracketRe.exec(l.reason ?? '');
    const fromBracket = bracketMatch
      ? nameByLastName.get(bracketMatch[1].trim().toLowerCase())
      : undefined;
    return {
      ...l,
      name: fromTeam || l.name || fromCreator || fromBracket || '',
      decided_by_name: l.decided_by ? (nameById.get(l.decided_by) ?? '') : '',
      avatar_url: l.person_id ? (avatarById.get(l.person_id) ?? null) : null,
      decided_by_avatar_url: l.decided_by ? (avatarById.get(l.decided_by) ?? null) : null,
    };
  });

  return NextResponse.json({ leaves: enriched });
}

export async function PATCH(req: Request) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const role = session.user.role ?? 'lawyer';
  if (role !== 'partner' && role !== 'super_user') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { notionId, action } = await req.json();

  if (!notionId || !action || !['approve', 'reject'].includes(action)) {
    return NextResponse.json({ error: 'Missing or invalid fields' }, { status: 400 });
  }

  const newStatus = action === 'approve' ? 'Approved' : 'Rejected';
  const approved = action === 'approve';

  const supabase = await getSupabaseServerAuthClient();

  try {
    // Snapshot the leave so we can notify the applicant after the update
    const { data: leaveRow } = await supabase
      .from('leaves')
      .select('person_id, leave_type, period_start, period_end')
      .eq('notion_id', notionId)
      .limit(1)
      .single();

    const { error } = await supabase
      .from('leaves')
      .update({
        status: newStatus,
        approved,
        decided_by: session.user.notionUserId,
        decided_at: new Date().toISOString(),
      })
      .eq('notion_id', notionId);

    if (error) throw error;

    if (leaveRow?.person_id) {
      notifyApplicantOfLeaveAction({
        firmId: session.firmId,
        notionId,
        applicantId: leaveRow.person_id,
        reviewerId: session.user.notionUserId,
        leaveType: leaveRow.leave_type ?? 'Leave',
        periodStart: leaveRow.period_start ?? null,
        periodEnd: leaveRow.period_end ?? null,
        status: newStatus as 'Approved' | 'Rejected',
      }).catch((err) => console.error('[partner/leaves] notifyApplicant failed:', err.message));
    }

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[partner/leaves] Error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
