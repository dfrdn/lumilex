import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { fetchAllRowsIn, idBatches } from '@/lib/supabase-paginate';
import { CLOSED_STATUSES } from '@/lib/deliverable-status';
import { pgInList } from '@/lib/postgrest';
import { LAWYER_ROLES } from '@/lib/queries/people';
import { manilaDayStart, manilaToday, toManilaDay } from '@/lib/dates';

/* ── Sub-item types for entity columns ───────────────────────── */

export interface EntityItem {
  id: string;
  name: string;
  date: string | null;
  currentlyWith: string[];  // initials of people currently holding it
  overdue?: boolean;
}

export interface TeamAvatar {
  personId: string;
  initials: string;
  name: string;
  avatarUrl: string | null;
  /** Active team member in a LAWYER_ROLES role — the people worth filtering by. */
  isActiveLawyer: boolean;
}

export interface PartnerMatterView {
  id: string;
  name: string;
  matterCode: string;
  clientId: string;
  clientName: string;
  status: string;
  type: string;
  /** Last real work on the matter (touch_matter_activity). */
  lastActivityAt: string | null;
  teamInitials: string[];
  teamMembers: TeamAvatar[];
  teamPersonIds: string[];
  /** The viewer is on the matter team. */
  onTeam: boolean;
  /** The viewer is relationship partner of the matter's client. */
  isRelationshipPartner: boolean;
  /* Last incident — stacked: last hearing, filing, received file */
  lastHearing: { id: string; date: string; name: string } | null;
  lastMeeting: { id: string; date: string; name: string } | null;
  lastFiling: { id: string; date: string; name: string } | null;
  lastReceivedFile: { id: string; date: string; name: string } | null;
  /* Active entity columns */
  pendingDeliverables: EntityItem[];
  upcomingMeetings: EntityItem[];
  upcomingHearings: EntityItem[];
  pendingTasks: EntityItem[];
  /* AI-computed health snapshot (nightly cron). Null until cron generates. */
  health: { tier: 'green' | 'yellow' | 'red'; score: number; topSignal: string | null } | null;
  /* Partner-specific annotations */
  urgency: 'High' | 'Medium' | 'Low' | 'None';
  notes: string;
}

/**
 * Each matter's latest deliverable sent out, dated by `date_done` (older
 * filings predate that column, so their due date stands in). The function
 * keeps one row per matter, so a long filed history never leaves the database.
 */
async function lastFilings(firmId: string, matterIds: string[]): Promise<{ matter_id: string; notion_id: string; name: string; filed_on: string }[]> {
  const supabase = getServiceDbForFirm(firmId);
  const batches = await Promise.all(
    idBatches(matterIds, 500).map(async (batch) => {
      // .rpc() is not firm-scoped by the client: p_firm_id is the filter.
      const { data, error } = await supabase.rpc('last_filings', { p_firm_id: firmId, p_matter_ids: batch });
      if (error) throw error;
      return (data ?? []) as { matter_id: string; notion_id: string; name: string; filed_on: string }[];
    }),
  );
  return batches.flat();
}

export async function getPartnerMattersView(
  firmId: string,
  partnerId: string,
  /**
   * Whether the viewer's role already reads every matter of the firm (RLS's
   * has_matter_access). Only then are their relationship clients' other
   * matters added: this list reads with the service client, so it must never
   * show a matter the viewer couldn't open.
   */
  { relationshipClients = false }: { relationshipClients?: boolean } = {},
): Promise<PartnerMatterView[]> {
  const supabase = getServiceDbForFirm(firmId);

  // 1. Matters this person is on the team of, or whose client they are
  //    relationship partner for (they answer for every matter of that client,
  //    staffed or not) + team initials lookup
  const MATTER_COLS =
    'notion_id, name, matter_code, client_id, client_name, type, status, team_person_ids, last_activity_at';
  const [teamMattersRes, rpClientsRes, teamRes] = await Promise.all([
    supabase
      .from('matters')
      .select(MATTER_COLS)
      .contains('team_person_ids', [partnerId]),
    relationshipClients
      ? supabase.from('clients').select('notion_id').eq('relationship_partner_id', partnerId)
      : Promise.resolve({ data: [] as { notion_id: string }[], error: null }),
    supabase.from('team').select('person_id, initials, name, avatar_url, role, active'),
  ]);

  if (teamMattersRes.error) throw teamMattersRes.error;
  if (rpClientsRes.error) throw rpClientsRes.error;
  if (teamRes.error) throw teamRes.error;

  const rpClientIds = new Set((rpClientsRes.data ?? []).map((c) => c.notion_id as string));
  const rpMatters = rpClientIds.size
    ? await fetchAllRowsIn([...rpClientIds], (batch, from, to) =>
        supabase
          .from('matters')
          .select(MATTER_COLS)
          .in('client_id', batch)
          .order('notion_id')
          .range(from, to),
      )
    : [];

  const byId = new Map<string, (typeof rpMatters)[number]>();
  for (const m of [...(teamMattersRes.data ?? []), ...rpMatters]) byId.set(m.notion_id, m);
  const matters = [...byId.values()].sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
  if (matters.length === 0) return [];

  const matterIds = matters.map((m) => m.notion_id);

  // Build person_id → initials lookup
  const initialsMap = new Map<string, string>();
  const teamMap = new Map<string, TeamAvatar>();
  for (const t of teamRes.data ?? []) {
    if (t.person_id) {
      initialsMap.set(t.person_id, t.initials || '??');
      teamMap.set(t.person_id, {
        personId: t.person_id,
        initials: t.initials || '??',
        name: t.name || '',
        avatarUrl: t.avatar_url ?? null,
        isActiveLawyer:
          !!t.active && (LAWYER_ROLES as readonly string[]).includes(t.role ?? ''),
      });
    }
  }

  const today = manilaToday();

  // 2. Parallel fetches: annotations, last incidents, active entities.
  //    Batched and paged: a relationship partner's book runs past one `in()`
  //    filter and past PostgREST's 1,000-row cap. Each matter's rows land in
  //    one batch, so the per-matter date order survives the concatenation.
  const [
    annotationsRes,
    hearingsRes,
    meetingsRes,
    deliverablesRes,
    filesRes,
    tasksRes,
    filedRes,
    healthRows,
  ] = await Promise.all([
    // Partner annotations
    fetchAllRowsIn(matterIds, (batch, from, to) =>
      supabase
        .from('partner_matter_annotations')
        .select('matter_id, urgency, notes')
        .eq('partner_id', partnerId)
        .in('matter_id', batch)
        .order('matter_id')
        .range(from, to),
    ),
    // All hearings for these matters (we'll split last vs upcoming in JS)
    fetchAllRowsIn(matterIds, (batch, from, to) =>
      supabase
        .from('hearings')
        .select('notion_id, matter_id, name, date, status, attendee_ids')
        .in('matter_id', batch)
        .not('date', 'is', null)
        .order('date', { ascending: false })
        .order('notion_id')
        .range(from, to),
    ),
    // All meetings
    fetchAllRowsIn(matterIds, (batch, from, to) =>
      supabase
        .from('meetings')
        .select('notion_id, matter_id, name, date_start, attendee_ids')
        .in('matter_id', batch)
        .not('date_start', 'is', null)
        .order('date_start', { ascending: false })
        .order('notion_id')
        .range(from, to),
    ),
    // Deliverables (pending = not finalized/done)
    fetchAllRowsIn(matterIds, (batch, from, to) =>
      supabase
        .from('deliverables')
        .select('notion_id, matter_id, name, external_due_date, status, currently_with_ids')
        .in('matter_id', batch)
        .not('status', 'in', pgInList(CLOSED_STATUSES))
        .order('notion_id')
        .range(from, to),
    ),
    // Files (last received)
    fetchAllRowsIn(matterIds, (batch, from, to) =>
      supabase
        .from('files')
        .select('notion_id, matter_id, name, date_received')
        .in('matter_id', batch)
        .not('date_received', 'is', null)
        .order('date_received', { ascending: false })
        .order('notion_id')
        .range(from, to),
    ),
    // Tasks (pending = not done)
    fetchAllRowsIn(matterIds, (batch, from, to) =>
      supabase
        .from('tasks')
        .select('notion_id, matter_id, name, due_date, done, assignee_ids')
        .in('matter_id', batch)
        .eq('done', false)
        .order('notion_id')
        .range(from, to),
    ),
    // The last filing per matter for the last-incident column. One row per
    // matter comes back, not the whole filed history.
    lastFilings(firmId, matterIds),
    // Matter health (nightly artifact) — absent when the cron hasn't scored it yet
    fetchAllRowsIn(matterIds, (batch, from, to) =>
      supabase
        .from('matter_health')
        .select('matter_id, tier, score, signals')
        .in('matter_id', batch)
        .not('tier', 'is', null)
        .order('matter_id')
        .range(from, to),
    ),
  ]);

  /* ── Build lookup maps ─────────────────────────────────────── */

  // Annotations
  const annotationMap = new Map<string, { urgency: string; notes: string }>();
  for (const a of annotationsRes) {
    annotationMap.set(a.matter_id, { urgency: a.urgency, notes: a.notes });
  }

  // Hearings: split into "last" (past) and "upcoming" (future/today)
  const lastHearingMap = new Map<string, { id: string; date: string; name: string }>();
  const upcomingHearingsMap = new Map<string, EntityItem[]>();
  for (const h of hearingsRes) {
    const dateStr = h.date ? toManilaDay(h.date) : '';
    if (dateStr >= today) {
      // upcoming
      if (!upcomingHearingsMap.has(h.matter_id)) upcomingHearingsMap.set(h.matter_id, []);
      upcomingHearingsMap.get(h.matter_id)!.push({
        id: h.notion_id,
        name: h.name,
        date: dateStr,
        currentlyWith: (h.attendee_ids ?? [])
          .map((pid: string) => initialsMap.get(pid))
          .filter((v: string | undefined): v is string => !!v),
      });
    } else {
      // past — take only the most recent (already ordered desc)
      if (!lastHearingMap.has(h.matter_id)) {
        lastHearingMap.set(h.matter_id, { id: h.notion_id, date: dateStr, name: h.name });
      }
    }
  }

  // Meetings: split into "last" and "upcoming"
  const lastMeetingMap = new Map<string, { id: string; date: string; name: string }>();
  const upcomingMeetingsMap = new Map<string, EntityItem[]>();
  for (const m of meetingsRes) {
    const dateStr = m.date_start ? toManilaDay(m.date_start) : '';
    if (dateStr >= today) {
      if (!upcomingMeetingsMap.has(m.matter_id)) upcomingMeetingsMap.set(m.matter_id, []);
      upcomingMeetingsMap.get(m.matter_id)!.push({
        id: m.notion_id,
        name: m.name,
        date: dateStr,
        currentlyWith: (m.attendee_ids ?? [])
          .map((pid: string) => initialsMap.get(pid))
          .filter((v: string | undefined): v is string => !!v),
      });
    } else {
      if (!lastMeetingMap.has(m.matter_id)) {
        lastMeetingMap.set(m.matter_id, { id: m.notion_id, date: dateStr, name: m.name });
      }
    }
  }

  // Deliverables: pending (active, not done)
  const pendingDeliverablesMap = new Map<string, EntityItem[]>();
  for (const d of deliverablesRes) {
    const dateStr = d.external_due_date ?? null;
    const isOverdue = dateStr ? dateStr < today : false;
    if (!pendingDeliverablesMap.has(d.matter_id)) pendingDeliverablesMap.set(d.matter_id, []);
    pendingDeliverablesMap.get(d.matter_id)!.push({
      id: d.notion_id,
      name: d.name,
      date: dateStr,
      currentlyWith: (d.currently_with_ids ?? [])
        .map((pid: string) => initialsMap.get(pid))
        .filter((v: string | undefined): v is string => !!v),
      overdue: isOverdue,
    });
  }
  // Last received file per matter
  const lastFileMap = new Map<string, { id: string; date: string; name: string }>();
  for (const f of filesRes) {
    if (!lastFileMap.has(f.matter_id)) {
      lastFileMap.set(f.matter_id, { id: f.notion_id, date: f.date_received, name: f.name });
    }
  }

  // Pending tasks per matter
  const pendingTasksMap = new Map<string, EntityItem[]>();
  for (const t of tasksRes) {
    const dateStr = t.due_date ?? null;
    const isOverdue = dateStr ? dateStr < today : false;
    if (!pendingTasksMap.has(t.matter_id)) pendingTasksMap.set(t.matter_id, []);
    pendingTasksMap.get(t.matter_id)!.push({
      id: t.notion_id,
      name: t.name,
      date: dateStr,
      currentlyWith: (t.assignee_ids ?? [])
        .map((pid: string) => initialsMap.get(pid))
        .filter((v: string | undefined): v is string => !!v),
      overdue: isOverdue,
    });
  }

  // Last filing: the latest deliverable sent out, picked in SQL (last_filings)
  const lastFilingMap = new Map<string, { id: string; date: string; name: string }>();
  for (const f of filedRes) {
    lastFilingMap.set(f.matter_id, { id: f.notion_id, date: f.filed_on, name: f.name });
  }

  const healthMap = new Map<string, { tier: 'green' | 'yellow' | 'red'; score: number; topSignal: string | null }>();
  for (const h of healthRows as { matter_id: string; tier: 'green' | 'yellow' | 'red'; score: number; signals: { overdueDeliverableCount?: number; daysSinceActivity?: number | null; missedHearingCount?: number } | null }[]) {
    const sig = h.signals ?? {};
    let topSignal: string | null = null;
    if ((sig.overdueDeliverableCount ?? 0) > 0) {
      topSignal = `${sig.overdueDeliverableCount} overdue`;
    } else if ((sig.daysSinceActivity ?? 0) > 14) {
      topSignal = `idle ${sig.daysSinceActivity}d`;
    } else if ((sig.missedHearingCount ?? 0) > 0) {
      topSignal = `${sig.missedHearingCount} missed hearing(s)`;
    }
    healthMap.set(h.matter_id, { tier: h.tier, score: h.score, topSignal });
  }

  /* ── Assemble results ──────────────────────────────────────── */

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return matters.map((row: any) => {
    const mid = row.notion_id;
    const personIds: string[] = row.team_person_ids ?? [];
    const annotation = annotationMap.get(mid);

    return {
      id: mid,
      name: row.name ?? '',
      matterCode: row.matter_code ?? '',
      clientId: row.client_id ?? '',
      clientName: row.client_name ?? '',
      status: row.status ?? '',
      type: row.type ?? '',
      lastActivityAt: row.last_activity_at ?? null,
      teamPersonIds: personIds,
      onTeam: personIds.includes(partnerId),
      isRelationshipPartner: rpClientIds.has(row.client_id),
      teamInitials: personIds
        .map((pid) => initialsMap.get(pid))
        .filter((v): v is string => !!v),
      teamMembers: personIds
        .map((pid) => teamMap.get(pid))
        .filter((v): v is TeamAvatar => !!v),
      lastHearing: lastHearingMap.get(mid) ?? null,
      lastMeeting: lastMeetingMap.get(mid) ?? null,
      lastFiling: lastFilingMap.get(mid) ?? null,
      lastReceivedFile: lastFileMap.get(mid) ?? null,
      pendingDeliverables: pendingDeliverablesMap.get(mid) ?? [],
      upcomingMeetings: (upcomingMeetingsMap.get(mid) ?? []).sort(
        (a, b) => (a.date ?? '').localeCompare(b.date ?? ''),
      ),
      upcomingHearings: (upcomingHearingsMap.get(mid) ?? []).sort(
        (a, b) => (a.date ?? '').localeCompare(b.date ?? ''),
      ),
      pendingTasks: pendingTasksMap.get(mid) ?? [],
      health: healthMap.get(mid) ?? null,
      urgency: (annotation?.urgency as PartnerMatterView['urgency']) ?? 'None',
      notes: annotation?.notes ?? '',
    };
  });
}

/* ────────────────────────────────────────────────────────────────
 * Firm-wide matter management view (partners)
 * Lighter-weight than getPartnerMattersView — returns all matters
 * with team, status, outcome, related ids, and rolled-up counts.
 * ──────────────────────────────────────────────────────────────── */

export interface PartnerMatterManagementRow {
  id: string;
  name: string;
  matterCode: string;
  clientName: string;
  type: string;
  status: string;
  outcome: string;
  caseTitle: string;
  caseNumber: string;
  teamPersonIds: string[];
  teamInitials: { personId: string; initials: string; name: string; avatarUrl: string | null }[];
  relatedMatterIds: string[];
  pendingDeliverables: number;
  overdueDeliverables: number;
  upcomingHearings: number;
  nextHearing: { date: string; name: string } | null;
  nextDeliverable: { date: string; name: string } | null;
  lastStatusReport: { id: string; date: string; status: string; name: string } | null;
  engagementFilePath: string | null;
  engagementFileName: string | null;
  lastActivityAt: string | null;
}

export interface PartnerMatterLite {
  id: string;
  name: string;
  matterCode: string;
  clientName: string;
  status: string;
}

export async function getPartnerMattersManagementView(firmId: string): Promise<{
  matters: PartnerMatterManagementRow[];
  allMattersLite: PartnerMatterLite[];
}> {
  const supabase = getServiceDbForFirm(firmId);

  const [mattersRes, teamRes] = await Promise.all([
    supabase
      .from('matters')
      .select(
        'notion_id, name, matter_code, client_name, type, status, outcome, case_title, case_number, team_person_ids, related_matter_ids, last_activity_at',
      )
      .order('name', { ascending: true }),
    supabase.from('team').select('person_id, initials, name, avatar_url'),
  ]);

  if (mattersRes.error) throw mattersRes.error;
  if (teamRes.error) throw teamRes.error;

  const matterRows = mattersRes.data ?? [];
  const matterIds = matterRows.map((m) => m.notion_id);

  const teamLookup = new Map<string, { initials: string; name: string; avatarUrl: string | null }>();
  for (const t of teamRes.data ?? []) {
    if (t.person_id) teamLookup.set(t.person_id, { initials: t.initials || '??', name: t.name || '', avatarUrl: t.avatar_url ?? null });
  }

  const today = manilaToday();

  // Fetch pending deliverables + upcoming hearings + last status reports + billing configs in parallel
  const [deliverablesRes, hearingsRes, statusReportsRes, billingConfigsRes] = matterIds.length
    ? await Promise.all([
        supabase
          .from('deliverables')
          .select('matter_id, name, external_due_date, status')
          .in('matter_id', matterIds)
          .not('status', 'in', pgInList(CLOSED_STATUSES)),
        supabase
          .from('hearings')
          .select('matter_id, name, date')
          .in('matter_id', matterIds)
          .gte('date', manilaDayStart(today))
          .order('date', { ascending: true }),
        supabase
          .from('deliverables')
          .select('notion_id, matter_id, name, status, external_due_date, created_time')
          .in('matter_id', matterIds)
          .eq('type', 'Status Report')
          .order('created_time', { ascending: false }),
        supabase
          .from('matter_billing_configs')
          .select('matter_id, engagement_file_path, engagement_file_name')
          .in('matter_id', matterIds)
          .not('engagement_file_path', 'is', null),
      ])
    : [
        { data: [], error: null },
        { data: [], error: null },
        { data: [], error: null },
        { data: [], error: null },
      ];

  const delivCount = new Map<string, number>();
  const overdueCount = new Map<string, number>();
  const nextDelivMap = new Map<string, { date: string; name: string }>();
  for (const d of deliverablesRes.data ?? []) {
    delivCount.set(d.matter_id, (delivCount.get(d.matter_id) ?? 0) + 1);
    const due = d.external_due_date;
    if (due && due < today) {
      overdueCount.set(d.matter_id, (overdueCount.get(d.matter_id) ?? 0) + 1);
    }
    if (due && due >= today) {
      const current = nextDelivMap.get(d.matter_id);
      if (!current || due < current.date) {
        nextDelivMap.set(d.matter_id, { date: due, name: d.name ?? '' });
      }
    }
  }

  const hearingsCount = new Map<string, number>();
  const nextHearingMap = new Map<string, { date: string; name: string }>();
  for (const h of hearingsRes.data ?? []) {
    hearingsCount.set(h.matter_id, (hearingsCount.get(h.matter_id) ?? 0) + 1);
    if (!nextHearingMap.has(h.matter_id)) {
      nextHearingMap.set(h.matter_id, { date: h.date ? toManilaDay(h.date) : '', name: h.name ?? '' });
    }
  }

  const engagementMap = new Map<string, { path: string; name: string }>();
  for (const b of billingConfigsRes.data ?? []) {
    if (b.matter_id && b.engagement_file_path) {
      engagementMap.set(b.matter_id, {
        path: b.engagement_file_path,
        name: b.engagement_file_name ?? 'Engagement Agreement',
      });
    }
  }

  // Last status report per matter (most recent first — already ordered by created_time desc)
  const lastStatusReportMap = new Map<
    string,
    { id: string; date: string; status: string; name: string }
  >();
  for (const r of statusReportsRes.data ?? []) {
    if (lastStatusReportMap.has(r.matter_id)) continue; // keep first (most recent)
    const raw = r.created_time ?? r.external_due_date;
    const date = raw ? toManilaDay(raw) : '';
    lastStatusReportMap.set(r.matter_id, {
      id: r.notion_id,
      date,
      status: r.status ?? '',
      name: r.name ?? '',
    });
  }

  const matters: PartnerMatterManagementRow[] = matterRows.map((m) => {
    const personIds: string[] = m.team_person_ids ?? [];
    return {
      id: m.notion_id,
      name: m.name ?? '',
      matterCode: m.matter_code ?? '',
      clientName: m.client_name ?? '',
      type: m.type ?? '',
      status: m.status ?? '',
      outcome: m.outcome ?? '',
      caseTitle: m.case_title ?? '',
      caseNumber: m.case_number ?? '',
      teamPersonIds: personIds,
      teamInitials: personIds
        .map((pid) => {
          const t = teamLookup.get(pid);
          return t ? { personId: pid, initials: t.initials, name: t.name, avatarUrl: t.avatarUrl } : null;
        })
        .filter((v): v is { personId: string; initials: string; name: string; avatarUrl: string | null } => !!v),
      relatedMatterIds: m.related_matter_ids ?? [],
      pendingDeliverables: delivCount.get(m.notion_id) ?? 0,
      overdueDeliverables: overdueCount.get(m.notion_id) ?? 0,
      upcomingHearings: hearingsCount.get(m.notion_id) ?? 0,
      nextHearing: nextHearingMap.get(m.notion_id) ?? null,
      nextDeliverable: nextDelivMap.get(m.notion_id) ?? null,
      lastStatusReport: lastStatusReportMap.get(m.notion_id) ?? null,
      engagementFilePath: engagementMap.get(m.notion_id)?.path ?? null,
      engagementFileName: engagementMap.get(m.notion_id)?.name ?? null,
      lastActivityAt: m.last_activity_at ?? null,
    };
  });

  const allMattersLite: PartnerMatterLite[] = matterRows.map((m) => ({
    id: m.notion_id,
    name: m.name ?? '',
    matterCode: m.matter_code ?? '',
    clientName: m.client_name ?? '',
    status: m.status ?? '',
  }));

  return { matters, allMattersLite };
}

