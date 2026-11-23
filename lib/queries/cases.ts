import { cache } from 'react';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { fetchAllRows } from '@/lib/supabase-paginate';
import { teamOnMatters, type SubjectTeamMember } from '@/lib/queries/subject-team';
import {
  forumShort,
  hearingOutcome,
  nextHearing,
  titleProceeding,
  HEARING_HORIZON_DAYS,
  UNRECORDED_DAYS,
  type CaseStatus,
  type Hearing,
  type Proceeding,
} from '@/lib/cases/view';
import { stageLabel } from '@/lib/cases/stages';
import { CLOSED_STATUSES, DELIVERABLE_STATUS } from '@/lib/deliverable-status';
import { pgInList } from '@/lib/postgrest';
import { manilaDate } from '@/lib/dates';

/**
 * Cases read under the viewer's JWT: RLS lets the team read them (lawyers,
 * partners and admins write). The list filters and pages in the database and
 * loads proceedings, clients and hearings only for the page it shows.
 */

export const CASES_PAGE_SIZE = 50;
export const CASE_VIEWS = ['active', 'evaluation', 'closed', 'all'] as const;
export type CaseView = (typeof CASE_VIEWS)[number];
/** `mine`: cases on a matter whose team includes this person. */
export type CaseScope = { mine: string } | 'all';

const BATCH = 100;
const chunks = <T,>(xs: T[]) => Array.from({ length: Math.ceil(xs.length / BATCH) }, (_, i) => xs.slice(i * BATCH, i * BATCH + BATCH));

function likeTerm(q: string): string {
  return `%${q.replace(/[%_,()*\\]/g, ' ').trim()}%`;
}

const HEARING_COLUMNS = 'notion_id, name, type, attendee_ids, matter_id, matter_name, date, status, is_attended, proceeding_id';
const PROCEEDING_COLUMNS = 'id, case_id, parent_id, relation, forum_type, court_level, office, docket_no, caption, status, track, stage, resolution, mr_due_on, filed_on, resolved_on, created_at';

type Row = Record<string, unknown>;

function toProceeding(r: Row): Proceeding & { caseId: string } {
  return {
    id: r.id as string,
    track: (r.track as Proceeding['track']) ?? null,
    caseId: r.case_id as string,
    parentId: (r.parent_id as string | null) ?? null,
    relation: r.relation as Proceeding['relation'],
    forumType: r.forum_type as Proceeding['forumType'],
    courtLevel: (r.court_level as Proceeding['courtLevel']) ?? null,
    office: (r.office as string) ?? '',
    docketNo: (r.docket_no as string | null) ?? null,
    caption: (r.caption as string) ?? '',
    status: r.status as Proceeding['status'],
    stage: (r.stage as string | null) ?? null,
    resolution: (r.resolution as string | null) ?? null,
    mrDueOn: (r.mr_due_on as string | null) ?? null,
    filedOn: (r.filed_on as string | null) ?? null,
    resolvedOn: (r.resolved_on as string | null) ?? null,
    createdAt: r.created_at as string,
  };
}

function toHearing(r: Row): Hearing {
  return {
    id: r.notion_id as string,
    name: (r.name as string) ?? '',
    type: (r.type as string) ?? '',
    attendeeIds: (r.attendee_ids as string[] | null) ?? [],
    matterId: (r.matter_id as string | null) ?? null,
    matterName: (r.matter_name as string) ?? '',
    date: (r.date as string | null) ?? null,
    proceedingId: (r.proceeding_id as string | null) ?? null,
    status: (r.status as string) ?? '',
    isAttended: !!r.is_attended,
  };
}

/** The cases a person is on: through the matters whose team includes them. Once per request. */
const myCaseIds = cache(async (personId: string): Promise<string[]> => {
  const supabase = await getSupabaseServerAuthClient();
  const matters = await fetchAllRows<{ notion_id: string }>((from, to) =>
    supabase.from('matters').select('notion_id').contains('team_person_ids', [personId]).order('notion_id').range(from, to),
  );
  const batches = await Promise.all(
    chunks(matters.map((m) => m.notion_id)).map((batch) =>
      supabase.from('matter_subjects').select('subject_id').eq('scope', 'case').in('matter_id', batch),
    ),
  );
  const ids = new Set<string>();
  for (const { data } of batches) for (const r of data ?? []) ids.add(r.subject_id as string);
  return [...ids];
});

export async function countMyCases(personId: string): Promise<number> {
  return (await myCaseIds(personId)).length;
}

async function scopeIds(scope: CaseScope): Promise<string[] | null> {
  return scope === 'all' ? null : myCaseIds(scope.mine);
}

export interface CaseSummary {
  active: number;
  evaluation: number;
  closed: number;
  /** Hearings in the next seven days, and on how many cases. */
  hearingsThisWeek: number;
  casesWithHearings: number;
  /** Recent hearings with no outcome recorded. */
  unrecorded: number;
  /** Filings and MRs due in the next HEARING_HORIZON_DAYS, and those already past due. */
  filingsDue: number;
  filingsOverdue: number;
}

export async function getCaseSummary(scope: CaseScope, needsAction?: CaseNeedsAction): Promise<CaseSummary> {
  const supabase = await getSupabaseServerAuthClient();
  const [ids, cases] = await Promise.all([
    scopeIds(scope),
    fetchAllRows<{ id: string; status: CaseStatus }>((from, to) =>
      supabase.from('cases').select('id, status').order('id').range(from, to),
    ),
  ]);
  const inScope = (id: string) => !ids || ids.includes(id);
  const mine = cases.filter((c) => inScope(c.id));
  const now = new Date();
  const [hearings, needs] = await Promise.all([hearingsAround(now, 7), needsAction ?? getCaseNeedsAction(scope)]);
  const week = hearings.filter((h) => inScope(h.caseId) && h.outcome === 'upcoming' && new Date(h.date) <= addDays(now, 7));
  return {
    active: mine.filter((c) => c.status === 'active').length,
    evaluation: mine.filter((c) => c.status === 'evaluation').length,
    closed: mine.filter((c) => c.status === 'closed').length,
    hearingsThisWeek: week.length,
    casesWithHearings: new Set(week.map((h) => h.caseId)).size,
    unrecorded: hearings.filter((h) => inScope(h.caseId) && h.outcome === 'unrecorded').length,
    filingsDue: needs.filings.length - needs.filingsOverdue,
    filingsOverdue: needs.filingsOverdue,
  };
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86_400_000);
}

export interface CaseHearingEntry {
  /** A hearing; a deliverable due to be filed; or an MR due date a lawyer entered with the decision. */
  kind: 'hearing' | 'filing' | 'mr';
  id: string;
  name: string;
  date: string;
  outcome: ReturnType<typeof hearingOutcome> | 'mr_due' | 'due';
  /** A filing's draft status: "Drafting", "Under Review". */
  status?: string;
  caseId: string;
  caseTitle: string;
  forum: string;
}

/** Hearings from UNRECORDED_DAYS back to `aheadDays` ahead, on any case, with the case they belong to. */
async function hearingsAround(now: Date, aheadDays: number): Promise<CaseHearingEntry[]> {
  const supabase = await getSupabaseServerAuthClient();
  const rows = await fetchAllRows<Row>((from, to) =>
    supabase
      .from('hearings')
      .select(`${HEARING_COLUMNS}, proceeding:case_proceedings!inner(case_id, forum_type, court_level, case:cases!inner(title))`)
      .gte('date', addDays(now, -UNRECORDED_DAYS).toISOString())
      .lte('date', addDays(now, aheadDays).toISOString())
      .order('notion_id')
      .range(from, to),
  );
  return rows.map((r) => {
    const p = r.proceeding as { case_id: string; forum_type: Proceeding['forumType']; court_level: Proceeding['courtLevel']; case: { title: string } };
    const h = toHearing(r);
    return {
      kind: 'hearing' as const,
      id: h.id,
      name: h.name,
      date: h.date!,
      outcome: hearingOutcome(h, now),
      caseId: p.case_id,
      caseTitle: p.case.title,
      forum: forumShort({ forumType: p.forum_type, courtLevel: p.court_level }),
    };
  });
}

/** What needs a lawyer now: hearings in the next fortnight, and recent ones with no outcome recorded. */
export interface CaseNeedsAction {
  /** Due to be filed or submitted: overdue first, then by date. */
  filings: CaseHearingEntry[];
  /** Recent hearings with no outcome first, then what's coming. */
  hearings: CaseHearingEntry[];
  filingsOverdue: number;
  unrecorded: number;
}

/** What needs a lawyer now, split by the work it asks for: something to file, or a hearing to attend or record. */
export async function getCaseNeedsAction(scope: CaseScope): Promise<CaseNeedsAction> {
  const ids = await scopeIds(scope);
  const now = new Date();
  const [hearings, mrs, filings] = await Promise.all([hearingsAround(now, HEARING_HORIZON_DAYS), mrsDue(now), filingsDue(now)]);
  const inScope = (e: CaseHearingEntry) => !ids || ids.includes(e.caseId);
  const today = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
  const toFile = [...filings, ...mrs].filter(inScope).sort((a, b) => a.date.localeCompare(b.date));
  const heard = hearings.filter(inScope);
  const unrecorded = heard.filter((h) => h.outcome === 'unrecorded').sort((a, b) => b.date.localeCompare(a.date));
  const upcoming = heard.filter((h) => h.outcome === 'upcoming').sort((a, b) => a.date.localeCompare(b.date));
  return {
    filings: toFile,
    hearings: [...unrecorded, ...upcoming],
    filingsOverdue: toFile.filter((f) => f.date < today).length,
    unrecorded: unrecorded.length,
  };
}

/**
 * Deliverables due to be filed on a case's matters — the pleadings,
 * counter-affidavits, position papers and memoranda — from UNRECORDED_DAYS
 * back to the horizon, with the case and forum each belongs to.
 */
async function filingsDue(now: Date): Promise<CaseHearingEntry[]> {
  const supabase = await getSupabaseServerAuthClient();
  const links = await fetchAllRows<{ subject_id: string; matter_id: string }>((from, to) =>
    supabase.from('matter_subjects').select('subject_id, matter_id').eq('scope', 'case').order('subject_id').order('matter_id').range(from, to),
  );
  if (!links.length) return [];
  const caseOf = new Map<string, string>();
  for (const l of links) if (!caseOf.has(l.matter_id)) caseOf.set(l.matter_id, l.subject_id);
  const matterIds = [...caseOf.keys()];

  const [rows, cases, handled] = await Promise.all([
    (async () => {
      const out: Row[] = [];
      for (const batch of chunks(matterIds)) {
        const { data } = await supabase
          .from('deliverables')
          .select('notion_id, name, status, external_due_date, matter_id')
          .in('matter_id', batch)
          .not('status', 'in', pgInList(CLOSED_STATUSES))
          .gte('external_due_date', manilaDate(-UNRECORDED_DAYS, now))
          .lte('external_due_date', manilaDate(HEARING_HORIZON_DAYS, now));
        out.push(...((data ?? []) as Row[]));
      }
      return out;
    })(),
    fetchAllRows<{ id: string; title: string }>((from, to) => supabase.from('cases').select('id, title').order('id').range(from, to)),
    (async () => {
      const out: Row[] = [];
      for (const batch of chunks(matterIds)) {
        const { data } = await supabase
          .from('case_proceeding_matters')
          .select('matter_id, proceeding:case_proceedings!inner(status, forum_type, court_level)')
          .in('matter_id', batch);
        out.push(...((data ?? []) as Row[]));
      }
      return out;
    })(),
  ]);
  const titleOf = new Map(cases.map((c) => [c.id, c.title]));
  const forumOf = new Map<string, string>();
  for (const h of handled) {
    const p = h.proceeding as { status: string; forum_type: Proceeding['forumType']; court_level: Proceeding['courtLevel'] };
    if (!forumOf.has(h.matter_id as string) || p.status === 'active') forumOf.set(h.matter_id as string, forumShort({ forumType: p.forum_type, courtLevel: p.court_level }));
  }
  return rows.map((d) => {
    const caseId = caseOf.get(d.matter_id as string)!;
    return {
      kind: 'filing' as const,
      id: d.notion_id as string,
      name: (d.name as string) || 'Filing',
      date: d.external_due_date as string,
      outcome: 'due' as const,
      status: (d.status as string) || DELIVERABLE_STATUS.NOT_STARTED,
      caseId,
      caseTitle: titleOf.get(caseId) ?? '',
      forum: forumOf.get(d.matter_id as string) ?? '',
    };
  });
}

/** MR due dates lawyers entered, from UNRECORDED_DAYS back to the horizon, on decisions not yet reconsidered. */
async function mrsDue(now: Date): Promise<CaseHearingEntry[]> {
  const supabase = await getSupabaseServerAuthClient();
  const { data } = await supabase
    .from('case_proceedings')
    .select('id, case_id, forum_type, court_level, mr_due_on, case:cases!inner(title)')
    .eq('status', 'resolved')
    .not('mr_due_on', 'is', null)
    .gte('mr_due_on', manilaDate(-UNRECORDED_DAYS, now))
    .lte('mr_due_on', manilaDate(HEARING_HORIZON_DAYS, now));
  return ((data ?? []) as Row[]).map((r) => ({
    kind: 'mr' as const,
    id: r.id as string,
    name: 'MR due',
    date: r.mr_due_on as string,
    outcome: 'mr_due' as const,
    caseId: r.case_id as string,
    caseTitle: (r.case as { title: string }).title,
    forum: forumShort({ forumType: r.forum_type as Proceeding['forumType'], courtLevel: r.court_level as Proceeding['courtLevel'] }),
  }));
}

export interface CaseListRow {
  id: string;
  title: string;
  nature: string | null;
  status: CaseStatus;
  docket: string | null;
  forum: string | null;
  office: string | null;
  /** Where the proceeding it is titled after stands: "Prosecution evidence". */
  stage: string | null;
  clients: string[];
  next: { date: string; name: string; forum: string } | null;
  /** A Rule 65 petition is pending against the case. */
  branchPending: boolean;
  proceedings: number;
}

export async function getCaseViewCounts(scope: CaseScope): Promise<Record<CaseView, number>> {
  const s = await getCaseSummary(scope);
  return { active: s.active, evaluation: s.evaluation, closed: s.closed, all: s.active + s.evaluation + s.closed };
}

export async function getCaseRows({
  view,
  q,
  page,
  scope,
}: {
  view: CaseView;
  q: string;
  page: number;
  scope: CaseScope;
}): Promise<{ rows: CaseListRow[]; total: number }> {
  const supabase = await getSupabaseServerAuthClient();
  const ids = await scopeIds(scope);
  if (ids && !ids.length) return { rows: [], total: 0 };

  let query = supabase.from('cases').select('id, title, nature, status, subject:subjects!inner(identifier)', { count: 'exact' });
  if (view !== 'all') query = query.eq('status', view);
  if (ids) query = query.in('id', ids);
  if (q.trim()) {
    // A case is found by any caption or docket it ever had, not only today's.
    const term = likeTerm(q);
    const { data: hits } = await supabase
      .from('case_proceedings')
      .select('case_id')
      .or(`caption.ilike.${term},docket_no.ilike.${term},office.ilike.${term}`)
      .limit(500);
    const fromProceedings = [...new Set((hits ?? []).map((h) => h.case_id as string))];
    query = query.or(
      [`title.ilike.${term}`, `nature.ilike.${term}`, fromProceedings.length ? `id.in.(${fromProceedings.join(',')})` : null].filter(Boolean).join(','),
    );
  }
  const from = (page - 1) * CASES_PAGE_SIZE;
  const { data, count, error } = await query.order('title').range(from, from + CASES_PAGE_SIZE - 1);
  if (error) throw new Error(`Loading cases failed: ${error.message}`);
  const cases = (data ?? []) as Row[];
  const pageIds = cases.map((c) => c.id as string);
  if (!pageIds.length) return { rows: [], total: count ?? 0 };

  const [procs, clients] = await Promise.all([proceedingsOf(pageIds), clientsOf(pageIds)]);
  const hearings = await hearingsOn(procs.map((p) => p.id));
  const now = new Date();

  const rows = cases.map((c): CaseListRow => {
    const mine = procs.filter((p) => p.caseId === c.id);
    const titled = titleProceeding(mine);
    const byProc = new Map(mine.map((p) => [p.id, p]));
    const next = nextHearing(hearings.filter((h) => h.proceedingId && byProc.has(h.proceedingId)), now);
    const nextProc = next?.proceedingId ? byProc.get(next.proceedingId) : null;
    return {
      id: c.id as string,
      title: c.title as string,
      nature: (c.nature as string | null) ?? null,
      status: c.status as CaseStatus,
      docket: ((c.subject as { identifier?: string | null } | null)?.identifier as string | null) ?? null,
      forum: titled ? forumShort(titled) : null,
      office: titled?.office || null,
      stage: titled ? (titled.status === 'resolved' ? 'Resolved' : stageLabel(titled.track, titled.stage)) : null,
      clients: clients.get(c.id as string) ?? [],
      next: next && next.date ? { date: next.date, name: next.name, forum: nextProc ? forumShort(nextProc) : '' } : null,
      branchPending: mine.some((p) => p.relation === 'rule_65' && p.status === 'active'),
      proceedings: mine.length,
    };
  });
  return { rows, total: count ?? 0 };
}

async function proceedingsOf(caseIds: string[]): Promise<(Proceeding & { caseId: string })[]> {
  const supabase = await getSupabaseServerAuthClient();
  const out: (Proceeding & { caseId: string })[] = [];
  for (const batch of chunks(caseIds)) {
    const { data } = await supabase.from('case_proceedings').select(PROCEEDING_COLUMNS).in('case_id', batch);
    out.push(...((data ?? []) as Row[]).map(toProceeding));
  }
  return out;
}

async function hearingsOn(proceedingIds: string[]): Promise<Hearing[]> {
  const supabase = await getSupabaseServerAuthClient();
  const out: Hearing[] = [];
  for (const batch of chunks(proceedingIds)) {
    const { data } = await supabase.from('hearings').select(HEARING_COLUMNS).in('proceeding_id', batch);
    out.push(...((data ?? []) as Row[]).map(toHearing));
  }
  return out;
}

/** Each case's clients, through the matters that cover it. */
async function clientsOf(caseIds: string[]): Promise<Map<string, string[]>> {
  const supabase = await getSupabaseServerAuthClient();
  const out = new Map<string, string[]>();
  for (const batch of chunks(caseIds)) {
    const { data } = await supabase
      .from('matter_subjects')
      .select('subject_id, matter:matters!inner(client_name)')
      .eq('scope', 'case')
      .in('subject_id', batch);
    for (const r of (data ?? []) as Row[]) {
      const name = ((r.matter as { client_name?: string } | null)?.client_name ?? '').trim();
      if (!name) continue;
      const list = out.get(r.subject_id as string) ?? [];
      if (!list.includes(name)) list.push(name);
      out.set(r.subject_id as string, list);
    }
  }
  return out;
}

export interface CaseMatter {
  id: string;
  code: string;
  name: string;
  status: string;
  clientId: string | null;
  clientName: string;
  /** The proceedings this matter handles; none means it covers the evaluation. */
  proceedingIds: string[];
}

export interface CaseDetail {
  id: string;
  title: string;
  titlePinned: boolean;
  workingTitle: string;
  nature: string | null;
  clientRole: string | null;
  status: CaseStatus;
  outcome: string | null;
  closedOn: string | null;
  demandSentOn: string | null;
  demandDueOn: string | null;
  docket: string | null;
  proceedings: Proceeding[];
  hearings: Hearing[];
  matters: CaseMatter[];
  related: { id: string; title: string; status: CaseStatus; kind: string }[];
  team: SubjectTeamMember[];
  /** Deliverables still to be filed on the case's matters, soonest first. */
  toFile: { id: string; name: string; status: string; due: string | null; matterId: string }[];
}

export async function getCaseById(firmId: string, id: string): Promise<CaseDetail | null> {
  const supabase = await getSupabaseServerAuthClient();
  const { data: c } = await supabase
    .from('cases')
    .select('id, title, title_pinned, working_title, nature, client_role, status, outcome, closed_on, demand_sent_on, demand_due_on, subject:subjects!inner(identifier)')
    .eq('id', id)
    .maybeSingle();
  if (!c) return null;

  const [procs, links, relatedA, relatedB] = await Promise.all([
    proceedingsOf([id]),
    supabase
      .from('matter_subjects')
      .select('matter:matters!inner(notion_id, matter_code, name, status, client_id, client_name)')
      .eq('scope', 'case')
      .eq('subject_id', id),
    supabase.from('case_links').select('kind, other:cases!case_links_other_case_id_fkey(id, title, status)').eq('case_id', id),
    supabase.from('case_links').select('kind, other:cases!case_links_case_id_fkey(id, title, status)').eq('other_case_id', id),
  ]);
  const procIds = procs.map((p) => p.id);
  const matterIds = ((links.data ?? []) as Row[]).map((l) => (l.matter as Row).notion_id as string);
  const [placed, unplaced, pending, handled] = await Promise.all([
    hearingsOn(procIds),
    matterIds.length
      ? supabase.from('hearings').select(HEARING_COLUMNS).in('matter_id', matterIds).is('proceeding_id', null)
      : Promise.resolve({ data: [] as Row[] }),
    matterIds.length
      ? supabase
          .from('deliverables')
          .select('notion_id, name, status, external_due_date, matter_id')
          .in('matter_id', matterIds)
          .not('status', 'in', pgInList(CLOSED_STATUSES))
          .not('external_due_date', 'is', null)
      : Promise.resolve({ data: [] as Row[] }),
    procIds.length
      ? supabase.from('case_proceeding_matters').select('proceeding_id, matter_id').in('proceeding_id', procIds)
      : Promise.resolve({ data: [] as Row[] }),
  ]);
  const hearings = [...placed, ...((unplaced.data ?? []) as Row[]).map(toHearing)];
  const handledBy = new Map<string, string[]>();
  for (const r of (handled.data ?? []) as Row[]) {
    const list = handledBy.get(r.matter_id as string) ?? [];
    list.push(r.proceeding_id as string);
    handledBy.set(r.matter_id as string, list);
  }
  const matters: CaseMatter[] = ((links.data ?? []) as Row[])
    .map((l) => l.matter as Row)
    .map((m) => ({
      id: m.notion_id as string,
      code: (m.matter_code as string) ?? '',
      name: (m.name as string) ?? '',
      status: (m.status as string) ?? '',
      clientId: (m.client_id as string | null) ?? null,
      clientName: (m.client_name as string) ?? '',
      proceedingIds: handledBy.get(m.notion_id as string) ?? [],
    }))
    .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
  const related = [...((relatedA.data ?? []) as Row[]), ...((relatedB.data ?? []) as Row[])].map((r) => {
    const o = r.other as { id: string; title: string; status: CaseStatus };
    return { id: o.id, title: o.title, status: o.status, kind: r.kind as string };
  });

  return {
    id: c.id as string,
    title: c.title as string,
    titlePinned: !!c.title_pinned,
    workingTitle: (c.working_title as string) ?? '',
    nature: (c.nature as string | null) ?? null,
    clientRole: (c.client_role as string | null) ?? null,
    status: c.status as CaseStatus,
    outcome: (c.outcome as string | null) ?? null,
    closedOn: (c.closed_on as string | null) ?? null,
    demandSentOn: (c.demand_sent_on as string | null) ?? null,
    demandDueOn: (c.demand_due_on as string | null) ?? null,
    docket: ((c.subject as { identifier?: string | null } | null)?.identifier as string | null) ?? null,
    proceedings: procs,
    hearings: hearings.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '')),
    matters,
    related: related.sort((a, b) => a.title.localeCompare(b.title)),
    team: await teamOnMatters(firmId, matters.map((m) => m.id)),
    toFile: ((pending.data ?? []) as Row[])
      .map((d) => ({
        id: d.notion_id as string,
        name: (d.name as string) || 'Filing',
        status: (d.status as string) || DELIVERABLE_STATUS.NOT_STARTED,
        due: (d.external_due_date as string | null) ?? null,
        matterId: d.matter_id as string,
      }))
      .sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999')),
  };
}

export interface MatterCase {
  id: string;
  title: string;
  status: CaseStatus;
  docket: string | null;
  /** Where the proceeding it is titled after stands: "RTC Branch 164 · Defense evidence". */
  where: string | null;
}

/** The cases a matter covers, for the matter page. */
export async function getCasesForMatter(matterId: string): Promise<MatterCase[]> {
  const supabase = await getSupabaseServerAuthClient();
  const { data: links } = await supabase.from('matter_subjects').select('subject_id').eq('scope', 'case').eq('matter_id', matterId);
  const ids = (links ?? []).map((l) => l.subject_id as string);
  if (!ids.length) return [];
  const [{ data: cases }, procs] = await Promise.all([
    supabase.from('cases').select('id, title, status, subject:subjects!inner(identifier)').in('id', ids),
    proceedingsOf(ids),
  ]);
  return ((cases ?? []) as Row[]).map((c) => {
    const titled = titleProceeding(procs.filter((p) => p.caseId === c.id));
    const stage = titled ? (titled.status === 'resolved' ? 'Resolved' : stageLabel(titled.track, titled.stage)) : null;
    return {
      id: c.id as string,
      title: c.title as string,
      status: c.status as CaseStatus,
      docket: ((c.subject as { identifier?: string | null } | null)?.identifier as string | null) ?? null,
      where: titled ? [titled.office || forumShort(titled), stage].filter(Boolean).join(' · ') : null,
    };
  });
}

