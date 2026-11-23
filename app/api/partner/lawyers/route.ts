import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { toDecimal } from '@/lib/dtr-utils';
import { CLOSED_STATUSES } from '@/lib/deliverable-status';
import { pgInList } from '@/lib/postgrest';
import { addDays, manilaToday, monthRange } from '@/lib/dates';

const PARTNER_ROLES = ['partner', 'super_user'];

export async function GET() {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const role = session.user.role ?? 'lawyer';
  if (!PARTNER_ROLES.includes(role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const supabase = await getSupabaseServerAuthClient();

  // Fetch lawyers (active + inactive; the client toggles inactive visibility)
  const { data: lawyers } = await supabase
    .from('team')
    .select('notion_id, person_id, name, initials, position, active')
    .in('role', ['lawyer', 'partner', 'super_user'])
    .order('name');

  const lawyerRows = lawyers ?? [];

  // Fetch all ongoing matters with team + type info
  const { data: matters } = await supabase
    .from('matters')
    .select('notion_id, name, client_name, type, status, team_person_ids')
    .eq('status', 'Ongoing');

  const matterRows = matters ?? [];

  // Build person_id → notion_id lookup (team_person_ids stores person_id values)
  const personToNotionId = new Map<string, string>();
  for (const l of lawyerRows) {
    if (l.person_id) personToNotionId.set(l.person_id, l.notion_id);
  }

  // Build per-lawyer matter breakdown (keyed by notion_id for consistency)
  const lawyerMatters = new Map<string, typeof matterRows>();
  const matterTypeCounts = new Map<string, Record<string, number>>();

  for (const m of matterRows) {
    for (const pid of m.team_person_ids ?? []) {
      const nid = personToNotionId.get(pid) ?? pid;
      if (!lawyerMatters.has(nid)) lawyerMatters.set(nid, []);
      lawyerMatters.get(nid)!.push(m);

      if (!matterTypeCounts.has(nid)) matterTypeCounts.set(nid, {});
      const types = matterTypeCounts.get(nid)!;
      const type = m.type || 'Other';
      types[type] = (types[type] ?? 0) + 1;
    }
  }

  // Fetch pending deliverables per lawyer (by person_id in currently_with_ids)
  const { data: delivRows } = await supabase
    .from('deliverables')
    .select('notion_id, name, matter_id, matter_name, external_due_date, status, currently_with_ids')
    .not('status', 'in', pgInList(CLOSED_STATUSES));

  const today = manilaToday();
  const pendingCounts = new Map<string, number>();
  const overdueItems: {
    id: string;
    name: string;
    matterId: string | null;
    matterName: string;
    dueDate: string;
    status: string;
    currentlyWithIds: string[];
  }[] = [];
  for (const d of delivRows ?? []) {
    for (const pid of d.currently_with_ids ?? []) {
      pendingCounts.set(pid, (pendingCounts.get(pid) ?? 0) + 1);
    }
    if (d.external_due_date && d.external_due_date < today) {
      overdueItems.push({
        id: d.notion_id,
        name: d.name ?? '',
        matterId: d.matter_id ?? null,
        matterName: d.matter_name ?? '',
        dueDate: d.external_due_date,
        status: d.status ?? '',
        currentlyWithIds: d.currently_with_ids ?? [],
      });
    }
  }

  // Fetch DTR for current month
  const { start: monthStart, end: monthEnd } = monthRange();

  // Deliverable actions submitted this month. Each deliverable_files row
  // represents a lawyer clicking an action button (For Review, For
  // Finalization, upload revision, etc.). We exclude the bulk migration
  // artifact and system-generated rows.
  const monthEndExclusive = addDays(monthEnd, 1);
  const [dtrRes, submittedRes] = await Promise.all([
    supabase
      .from('dtr')
      .select('lawyer_name, hours, minutes, with_ids')
      .gte('date', monthStart)
      .lte('date', monthEnd),
    supabase
      .from('deliverable_files')
      .select('uploaded_by, action')
      .gte('created_at', monthStart)
      .lt('created_at', monthEndExclusive)
      .not('uploaded_by', 'is', null)
      .neq('uploaded_by', 'system'),
  ]);
  const dtrRows = dtrRes.data;

  const EXCLUDED_ACTIONS = new Set<string>([
    'Filed version — migrated from linked file',
    'ai-generated',
    'Updated Status',
  ]);
  const submittedCounts = new Map<string, number>();
  for (const row of submittedRes.data ?? []) {
    if (!row.uploaded_by) continue;
    if (EXCLUDED_ACTIONS.has(row.action ?? '')) continue;
    submittedCounts.set(
      row.uploaded_by,
      (submittedCounts.get(row.uploaded_by) ?? 0) + 1,
    );
  }

  // person_id → lawyer name, to credit collaborators listed in with_ids
  const personIdToName = new Map<string, string>();
  for (const l of lawyerRows) {
    if (l.person_id && l.name) personIdToName.set(l.person_id, l.name);
  }

  const hoursByName = new Map<string, number>();
  for (const d of dtrRows ?? []) {
    const decimal = toDecimal(d.hours, d.minutes);
    const credited = new Set<string>();
    const authorName = d.lawyer_name || 'Unknown';
    hoursByName.set(authorName, (hoursByName.get(authorName) ?? 0) + decimal);
    credited.add(authorName);
    for (const pid of d.with_ids ?? []) {
      const name = personIdToName.get(pid);
      if (name && !credited.has(name)) {
        hoursByName.set(name, (hoursByName.get(name) ?? 0) + decimal);
        credited.add(name);
      }
    }
  }

  // Assemble per-lawyer data
  const workload = lawyerRows.map((l: any) => {
    const typeBreakdown = matterTypeCounts.get(l.notion_id) ?? {};
    const totalMatters = Object.values(typeBreakdown).reduce((a: number, b: number) => a + b, 0);
    const hours = hoursByName.get(l.name) ?? 0;

    return {
      id: l.notion_id,
      personId: l.person_id,
      name: l.name,
      initials: l.initials,
      position: l.position,
      active: l.active,
      totalMatters,
      typeBreakdown,
      pendingDeliverables: pendingCounts.get(l.person_id) ?? 0,
      submittedThisMonth: submittedCounts.get(l.person_id) ?? 0,
      hoursThisMonth: Math.round(hours * 10) / 10,
    };
  });

  // Sort by total matters descending
  workload.sort((a, b) => b.totalMatters - a.totalMatters);

  return NextResponse.json({ workload, allMatters: matterRows, overdueItems });
}

// PATCH — assign/unassign lawyers to a matter
export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const role = session.user.role ?? 'lawyer';
  if (!PARTNER_ROLES.includes(role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { matterId, teamPersonIds } = await req.json();
  if (!matterId || !Array.isArray(teamPersonIds)) {
    return NextResponse.json({ error: 'Missing matterId or teamPersonIds' }, { status: 400 });
  }

  const supabase = await getSupabaseServerAuthClient();
  const { error } = await supabase
    .from('matters')
    .update({ team_person_ids: teamPersonIds })
    .eq('notion_id', matterId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
