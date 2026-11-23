import type { SupabaseClient } from '@supabase/supabase-js';
import type { CorporationMeeting } from '@/types/corporations';
import { rowToCorporation, rowToCorporationFile, rowToCorporationPerson } from '@/lib/corporation-row';
import { CORPORATION_SELECT } from '@/lib/corporations/matter-links';
import { loadFilingCalendar } from '@/lib/corporations/filing-calendar';
import { buildCorporationStatus, manilaToday } from '@/lib/corporations/status';
import { fetchAllRows } from '@/lib/supabase-paginate';
import { refreshTrademarkBatch } from '@/lib/trademarks/status-refresh';

/**
 * Keep subject_status / subject_status_items current — the stored reading of
 * each company's status that the Corporations list and the Upcoming view read
 * (supabase/migrations/20261121_subject_status.sql). Runs once per firm,
 * on that firm's scoped service client.
 *
 * A company is due for a refresh when a trigger has marked it stale, or when
 * its reading was taken on an earlier day (overdue depends on the date). Work
 * goes in batches small enough for one round of `in (...)` filters, and every
 * read pages past PostgREST's 1,000-row cap.
 */

export const BATCH_SIZE = 100;

const COMPLIANCE_TYPES = ['SEC GIS', 'SEC AFS', 'BIR Filing', 'Other Compliance'];

type Row = Record<string, unknown>;

const quoted = (xs: string[]) => xs.map((x) => `"${x}"`).join(',');

function groupBy(rows: Row[], key: string): Map<string, Row[]> {
  const m = new Map<string, Row[]>();
  for (const r of rows) {
    const k = r[key] as string;
    m.set(k, [...(m.get(k) ?? []), r]);
  }
  return m;
}

/** Compute and store the status of these companies (at most BATCH_SIZE). */
export async function refreshBatch(supabase: SupabaseClient, firmId: string, ids: string[], today = manilaToday()): Promise<number> {
  if (!ids.length) return 0;

  const corpRows = await fetchAllRows<Row>((from, to) =>
    supabase.from('corporations').select(CORPORATION_SELECT).in('id', ids).order('id').range(from, to),
  );
  const corps = corpRows.map((r) => rowToCorporation(r));
  const present = new Set(corps.map((c) => c.id));

  const mattersOf = (c: (typeof corps)[number]) =>
    [c.retainerMatterId, c.housekeepingMatterId, c.postIncorporationMatterId, c.incorporationMatterId].filter((m): m is string => !!m);
  const allMatters = [...new Set(corps.flatMap(mattersOf))];
  const clientIds = [...new Set(corps.map((c) => c.engagingClientId ?? c.clientId).filter((x): x is string => !!x))];

  const [files, people, meetings, deliverables, clients, matters, calendar, requests] = await Promise.all([
    fetchAllRows<Row>((f, t) => supabase.from('corporation_files').select('*').in('corporation_id', ids).order('id').range(f, t)),
    fetchAllRows<Row>((f, t) => supabase.from('corporation_persons').select('*').in('corporation_id', ids).order('id').range(f, t)),
    fetchAllRows<Row>((f, t) =>
      supabase
        .from('corporation_meetings')
        .select('id, corporation_id, meeting_type, meeting_date, minutes_status')
        .in('corporation_id', ids)
        .order('id')
        .range(f, t),
    ),
    fetchAllRows<Row>((f, t) =>
      supabase
        .from('deliverables')
        .select('notion_id, subject_id, matter_id, type, name, external_due_date, status')
        .in('type', COMPLIANCE_TYPES)
        .or(
          allMatters.length
            ? `subject_id.in.(${quoted(ids)}),and(subject_id.is.null,matter_id.in.(${quoted(allMatters)}))`
            : `subject_id.in.(${quoted(ids)})`,
        )
        .order('notion_id')
        .range(f, t),
    ),
    clientIds.length
      ? supabase.from('clients').select('notion_id, name').in('notion_id', clientIds).then((r) => r.data ?? [])
      : Promise.resolve([] as Row[]),
    allMatters.length
      ? supabase.from('matters').select('notion_id, team_person_ids').in('notion_id', allMatters).then((r) => r.data ?? [])
      : Promise.resolve([] as Row[]),
    loadFilingCalendar(supabase),
    allMatters.length
      ? supabase
          .from('file_requests')
          .select('matter_id')
          .in('matter_id', allMatters)
          .is('fulfilled_at', null)
          .is('canceled_at', null)
          .then((r) => r.data ?? [])
      : Promise.resolve([] as Row[]),
  ]);

  const teamIds = [...new Set(matters.flatMap((m) => (m.team_person_ids as string[] | null) ?? []))];
  const teamRows = teamIds.length
    ? (await supabase.from('team').select('person_id, name, initials, avatar_url').in('person_id', teamIds).eq('active', true)).data ?? []
    : [];
  const personById = new Map(teamRows.map((p) => [p.person_id as string, p]));
  const teamByMatter = new Map(matters.map((m) => [m.notion_id as string, (m.team_person_ids as string[] | null) ?? []]));
  const clientName = new Map(clients.map((c) => [c.notion_id as string, (c.name as string) ?? '']));
  const openMatters = [...new Set(requests.map((r) => r.matter_id as string))];

  const filesBy = groupBy(files, 'corporation_id');
  const peopleBy = groupBy(people, 'corporation_id');
  const meetingsBy = groupBy(meetings, 'corporation_id');

  const statusRows: Row[] = [];
  const itemRows: Row[] = [];
  const computedAt = new Date().toISOString();

  for (const c of corps) {
    const own = new Set(mattersOf(c));
    const status = buildCorporationStatus({
      corporation: c,
      files: (filesBy.get(c.id) ?? []).map(rowToCorporationFile),
      people: (peopleBy.get(c.id) ?? []).map(rowToCorporationPerson),
      meetings: (meetingsBy.get(c.id) ?? []).map((m) => ({
        meetingType: m.meeting_type as CorporationMeeting['meetingType'],
        meetingDate: m.meeting_date as string,
        minutesStatus: m.minutes_status as CorporationMeeting['minutesStatus'],
      })),
      deliverables: deliverables
        .filter((d) => (d.subject_id ? d.subject_id === c.id : own.has(d.matter_id as string)))
        .map((d) => ({
          notionId: d.notion_id as string,
          type: d.type as string,
          name: (d.name as string) ?? '',
          externalDueDate: (d.external_due_date as string | null) ?? null,
          status: (d.status as string) ?? '',
        })),
      calendar,
      openRequestMatterIds: openMatters,
      today,
    });

    const open = status.tracks.flatMap((t) =>
      t.items.filter((i) => !['done', 'filed', 'not_ours'].includes(i.state)).map((item) => ({ track: t.key, item })),
    );
    const next = [...open].sort(
      (a, b) =>
        (a.item.state === 'overdue' ? 0 : 1) - (b.item.state === 'overdue' ? 0 : 1) ||
        (a.item.dueDate ?? '9999').localeCompare(b.item.dueDate ?? '9999'),
    )[0];
    const clientId = c.engagingClientId ?? c.clientId;
    const teamIds = [...new Set([...own].flatMap((m) => teamByMatter.get(m) ?? []))];
    const team = teamIds
      .map((id) => personById.get(id))
      .filter((p) => !!p)
      .map((p) => ({ name: (p!.name as string) ?? '', initials: (p!.initials as string) || '??', avatarUrl: (p!.avatar_url as string | null) ?? null }));

    statusRows.push({
      firm_id: firmId,
      subject_id: c.id,
      type: 'corporation',
      name: c.approvedName ?? c.proposedNames[0] ?? '',
      lifecycle_status: c.status,
      company_type: c.companyType,
      identifier: c.secRegistrationNo,
      client_id: clientId,
      client_name: clientId ? clientName.get(clientId) ?? null : null,
      team,
      team_person_ids: teamIds,
      phase: status.phase,
      health: status.health,
      overdue: status.overdue,
      due_soon: status.dueSoon,
      waiting_on_client: status.waitingOnClient,
      focus: status.tracks
        .filter((t) => status.focus.includes(t.key))
        .map((t) => ({ key: t.key, label: t.label, health: t.health, summary: t.summary, done: t.done, total: t.total })),
      next_label: next?.item.label ?? null,
      next_due: next?.item.dueDate ?? null,
      next_track: next?.track ?? null,
      next_state: next?.item.state ?? null,
      computed_for: today,
      computed_at: computedAt,
    });
    for (const { track, item } of open) {
      if (!item.dueDate) continue;
      itemRows.push({
        firm_id: firmId,
        subject_id: c.id,
        item_key: item.key,
        track,
        label: item.label,
        detail: item.detail ?? null,
        state: item.state,
        due_date: item.dueDate,
        provisional: !!item.provisional,
        deliverable_id: item.deliverableId ?? null,
        team_person_ids: teamIds,
      });
    }
  }

  // `stale` is left alone: the caller cleared it before computing, so a change
  // that landed meanwhile has already set it again and will be picked up next.
  if (statusRows.length) {
    const { error } = await supabase.from('subject_status').upsert(statusRows, { onConflict: 'subject_id' });
    if (error) throw new Error(`subject_status upsert: ${error.message}`);
  }
  const done = [...present];
  const { error: delError } = await supabase.from('subject_status_items').delete().in('subject_id', done);
  if (delError) throw new Error(`subject_status_items clear: ${delError.message}`);
  for (let i = 0; i < itemRows.length; i += 500) {
    const { error } = await supabase.from('subject_status_items').insert(itemRows.slice(i, i + 500).map((r) => ({ ...r, firm_id: firmId })));
    if (error) throw new Error(`subject_status_items insert: ${error.message}`);
  }
  return statusRows.length;
}

/** The subject types with a stored status, and what computes each. */
const REFRESHERS: Record<string, (s: SupabaseClient, firmId: string, ids: string[], today: string) => Promise<number>> = {
  corporation: refreshBatch,
  trademark: refreshTrademarkBatch,
};

/**
 * Refresh subjects (companies and marks) that are stale or were read on an
 * earlier day, batch by batch, until none are left or the deadline nears.
 */
export async function refreshSubjectStatus(
  supabase: SupabaseClient,
  firmId: string,
  { deadline }: { deadline: number },
): Promise<{ refreshed: number; remaining: boolean }> {
  let refreshed = 0;
  while (Date.now() < deadline) {
    const today = manilaToday();
    const { data: due, error } = await supabase
      .from('subject_status')
      .select('subject_id, type')
      .in('type', Object.keys(REFRESHERS))
      .or(`stale.eq.true,computed_for.is.null,computed_for.lt.${today}`)
      .order('stale', { ascending: false })
      .limit(BATCH_SIZE);
    if (error) throw new Error(`load due subjects: ${error.message}`);
    const ids = (due ?? []).map((d) => d.subject_id as string);
    if (!ids.length) return { refreshed, remaining: false };

    // Claim the batch before computing (see refreshBatch).
    await supabase.from('subject_status').update({ stale: false }).in('subject_id', ids);
    for (const [type, refresh] of Object.entries(REFRESHERS)) {
      const ofType = (due ?? []).filter((d) => d.type === type).map((d) => d.subject_id as string);
      if (ofType.length) refreshed += await refresh(supabase, firmId, ofType, today);
    }
  }
  return { refreshed, remaining: true };
}
