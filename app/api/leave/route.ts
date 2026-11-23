import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { mintId } from '@/lib/ids';
import { notifyPartnersOfLeaveRequest } from '@/lib/notifications';

export async function GET() {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const personId = session.user.notionUserId;

  try {
    const supabase = await getSupabaseServerAuthClient();

    // Scope to the caller's own leaves explicitly. RLS alone is not enough here:
    // leaves_own_select also grants partner/admin/super_user every row, which is
    // right for the review queue (/api/partner/leaves) but wrong for this
    // personal endpoint — it made "My Requests" list the whole firm's leaves.
    // Both identifiers are needed because older rows key on team.notion_id while
    // rows filed in-app key on team.person_id (same pair current_person_identifiers() returns).
    const { data: teamRow } = await supabase
      .from('team')
      .select('notion_id')
      .eq('person_id', personId)
      .maybeSingle();

    const identifiers = [personId, teamRow?.notion_id].filter(
      (id): id is string => typeof id === 'string' && id.length > 0,
    );

    const { data, error } = await supabase
      .from('leaves')
      .select('notion_id, reason, name, leave_type, period_start, period_end, status, approved, synced_at')
      .in('person_id', identifiers)
      .order('period_start', { ascending: false });

    if (error) {
      console.error('[leave]', error.message); return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }

    return NextResponse.json({ leaves: data ?? [] });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { reason, leaveType, periodStart, periodEnd } = await req.json();

  if (!reason || !leaveType || !periodStart) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  const personId = session.user.notionUserId;

  try {
    const supabase = await getSupabaseServerAuthClient();

    // Resolve team row for the applicant — own row visible via team_self_select.
    const { data: teamRow } = await supabase
      .from('team')
      .select('name')
      .eq('person_id', personId)
      .eq('active', true)
      .limit(1)
      .single();

    // Prefer team name; fall back to session name so we never insert ''.
    const applicantName = teamRow?.name || session.user.name || '';

    const newId = mintId('leave');

    const { data: created, error: dbErr } = await supabase
      .from('leaves')
      .insert({
        firm_id: session.firmId,
        notion_id: newId,
        notion_url: '',
        reason,
        person_id: personId,
        name: applicantName,
        leave_type: leaveType,
        period_start: periodStart,
        period_end: periodEnd || null,
        status: 'Pending',
        approved: false,
        acting_partner_ids: [],
        created_by_name: applicantName,
        synced_at: new Date().toISOString(),
      })
      .select('notion_id, reason, name, leave_type, period_start, period_end, status, approved, synced_at')
      .single();

    if (dbErr) {
      console.error('[leave] Supabase insert error:', dbErr.message);
      return NextResponse.json({ error: 'Failed to file leave' }, { status: 500 });
    }

    notifyPartnersOfLeaveRequest({
      firmId: session.firmId,
      notionId: newId,
      applicantId: personId,
      applicantName,
      leaveType,
      periodStart,
      periodEnd: periodEnd || null,
      reason,
    }).catch((err) => console.error('[leave] notifyPartners failed:', err.message));

    return NextResponse.json({ ok: true, leave: created });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[leave] Error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
