import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { manilaToday, type Health, type ItemState, type Phase, type TrackKey } from '@/lib/corporations/status';
import { addDays } from '@/lib/dates';

/**
 * The Corporations page reads the stored status (subject_status,
 * subject_status_items — kept current by /api/cron/subject-status), never the
 * raw records, so its cost doesn't grow with the size of the book. Filtering,
 * sorting and paging all happen in the database.
 */

export const REGISTRY_PAGE_SIZE = 50;
export const UPCOMING_DAYS = 90;

export type RegistryFilter = 'overdue' | 'soon' | 'waiting' | 'setup' | 'all';

/**
 * Whose companies: `mine` keeps those where the viewer is on the team of a
 * matter that covers them; `all` is the whole book.
 */
export type RegistryScope = { mine: string } | 'all';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function scoped<Q extends { contains: (col: string, v: string[]) => any }>(q: Q, scope: RegistryScope): Q {
  return scope === 'all' ? q : q.contains('team_person_ids', [scope.mine]);
}

export interface RegistryTrack {
  key: TrackKey;
  label: string;
  health: Health;
  summary: string;
  done: number;
  total: number;
}

export interface RegistryRow {
  id: string;
  name: string;
  lifecycleStatus: string | null;
  companyType: string | null;
  identifier: string | null;
  clientId: string | null;
  clientName: string | null;
  team: { name: string; initials: string; avatarUrl: string | null }[];
  phase: Phase | null;
  health: Health | null;
  overdue: number;
  dueSoon: number;
  waitingOnClient: boolean;
  focus: RegistryTrack[];
  next: { label: string; dueDate: string | null; track: TrackKey | null; state: ItemState | null } | null;
  computedAt: string | null;
}

export interface RegistrySummary {
  companies: number;
  overdueCompanies: number;
  overdueItems: number;
  dueSoonItems: number;
  waiting: number;
  inSetup: number;
  /** Companies whose stored reading is waiting for the next refresh. */
  pending: number;
}

export async function getRegistrySummary(scope: RegistryScope = 'all'): Promise<RegistrySummary> {
  const supabase = await getSupabaseServerAuthClient();
  const today = manilaToday();
  const base = () => scoped(supabase.from('subject_status').select('subject_id', { count: 'exact', head: true }).eq('type', 'corporation'), scope);
  // Marks share subject_status_items; count only the companies' items.
  const items = () =>
    scoped(
      supabase
        .from('subject_status_items')
        .select('subject_id, subject:subjects!inner(type)', { count: 'exact', head: true })
        .eq('subject.type', 'corporation'),
      scope,
    );
  const [all, overdueCo, overdueItems, soonItems, waiting, setup, pending] = await Promise.all([
    base(),
    base().gt('overdue', 0),
    items().eq('state', 'overdue'),
    items().neq('state', 'overdue').gte('due_date', today).lte('due_date', addDays(today, 30)),
    base().eq('waiting_on_client', true),
    base().in('phase', ['application', 'post_registration']),
    base().or(`stale.eq.true,computed_for.is.null,computed_for.lt.${today}`),
  ]);
  return {
    companies: all.count ?? 0,
    overdueCompanies: overdueCo.count ?? 0,
    overdueItems: overdueItems.count ?? 0,
    dueSoonItems: soonItems.count ?? 0,
    waiting: waiting.count ?? 0,
    inSetup: setup.count ?? 0,
    pending: pending.count ?? 0,
  };
}

/** Escape a search term for a PostgREST ilike inside an or() list. */
function likeTerm(q: string): string {
  return `%${q.replace(/[%_,()*\\"']/g, ' ').trim()}%`;
}

export async function getRegistryCompanies({
  filter = 'all',
  q = '',
  page = 1,
  scope = 'all',
}: {
  filter?: RegistryFilter;
  q?: string;
  page?: number;
  scope?: RegistryScope;
}): Promise<{ rows: RegistryRow[]; total: number }> {
  const supabase = await getSupabaseServerAuthClient();
  let query = scoped(
    supabase
      .from('subject_status')
      .select('*', { count: 'exact' })
      .eq('type', 'corporation'),
    scope,
  );
  if (filter === 'overdue') query = query.gt('overdue', 0);
  if (filter === 'soon') query = query.gt('due_soon', 0);
  if (filter === 'waiting') query = query.eq('waiting_on_client', true);
  if (filter === 'setup') query = query.in('phase', ['application', 'post_registration']);
  if (q.trim()) {
    const term = likeTerm(q);
    query = query.or(`name.ilike.${term},client_name.ilike.${term},identifier.ilike.${term}`);
  }
  // Worst first: most overdue, then most due soon, then soonest next date.
  const from = (Math.max(1, page) - 1) * REGISTRY_PAGE_SIZE;
  const { data, count } = await query
    .order('overdue', { ascending: false })
    .order('due_soon', { ascending: false })
    .order('next_due', { ascending: true, nullsFirst: false })
    .order('name', { ascending: true })
    .range(from, from + REGISTRY_PAGE_SIZE - 1);

  const rows: RegistryRow[] = (data ?? []).map((r) => ({
    id: r.subject_id as string,
    name: (r.name as string) || '(unnamed)',
    lifecycleStatus: (r.lifecycle_status as string | null) ?? null,
    companyType: (r.company_type as string | null) ?? null,
    identifier: (r.identifier as string | null) ?? null,
    clientId: (r.client_id as string | null) ?? null,
    clientName: (r.client_name as string | null) ?? null,
    team: (r.team as RegistryRow['team']) ?? [],
    phase: (r.phase as Phase | null) ?? null,
    health: (r.health as Health | null) ?? null,
    overdue: (r.overdue as number) ?? 0,
    dueSoon: (r.due_soon as number) ?? 0,
    waitingOnClient: !!r.waiting_on_client,
    focus: (r.focus as RegistryTrack[]) ?? [],
    next: r.next_label
      ? {
          label: r.next_label as string,
          dueDate: (r.next_due as string | null) ?? null,
          track: (r.next_track as TrackKey | null) ?? null,
          state: (r.next_state as ItemState | null) ?? null,
        }
      : null,
    computedAt: (r.computed_at as string | null) ?? null,
  }));
  return { rows, total: count ?? 0 };
}

export interface UpcomingItem {
  subjectId: string;
  company: string;
  track: TrackKey;
  label: string;
  detail: string | null;
  state: ItemState;
  dueDate: string;
  provisional: boolean;
  deliverableId: string | null;
}

/**
 * Every dated, open item across the book: all that is overdue, then what falls
 * due in the next UPCOMING_DAYS days — each capped, newest-relevant first.
 */
export async function getRegistryUpcoming({ q = '', limit = 300, scope = 'all' }: { q?: string; limit?: number; scope?: RegistryScope }): Promise<{
  overdue: UpcomingItem[];
  upcoming: UpcomingItem[];
  overdueTotal: number;
  upcomingTotal: number;
}> {
  const supabase = await getSupabaseServerAuthClient();
  const today = manilaToday();
  const select = 'subject_id, track, label, detail, state, due_date, provisional, deliverable_id, subject:subjects!inner(name, type)';
  const withSearch = <T,>(qb: T): T => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sc = scoped(qb as any, scope).eq('subject.type', 'corporation');
    return q.trim() ? sc.ilike('subjects.name', likeTerm(q)) : sc;
  };
  const [over, soon] = await Promise.all([
    withSearch(
      supabase.from('subject_status_items').select(select, { count: 'exact' }).eq('state', 'overdue'),
    )
      .order('due_date', { ascending: true })
      .limit(limit),
    withSearch(
      supabase
        .from('subject_status_items')
        .select(select, { count: 'exact' })
        .neq('state', 'overdue')
        .gte('due_date', today)
        .lte('due_date', addDays(today, UPCOMING_DAYS)),
    )
      .order('due_date', { ascending: true })
      .limit(limit),
  ]);
  const map = (r: Record<string, unknown>): UpcomingItem => ({
    subjectId: r.subject_id as string,
    company: ((r.subject as { name?: string } | null)?.name as string) || '(unnamed)',
    track: r.track as TrackKey,
    label: r.label as string,
    detail: (r.detail as string | null) ?? null,
    state: r.state as ItemState,
    dueDate: r.due_date as string,
    provisional: !!r.provisional,
    deliverableId: (r.deliverable_id as string | null) ?? null,
  });
  return {
    overdue: (over.data ?? []).map(map),
    upcoming: (soon.data ?? []).map(map),
    overdueTotal: over.count ?? 0,
    upcomingTotal: soon.count ?? 0,
  };
}

/**
 * What needs doing now across the book: everything overdue, then what falls
 * due within NEEDS_ACTION_DAYS — the company list's Needs action panel.
 */
export const NEEDS_ACTION_DAYS = 30;

export async function getRegistryNeedsAction(scope: RegistryScope = 'all', limit = 60): Promise<{ items: UpcomingItem[]; total: number }> {
  const supabase = await getSupabaseServerAuthClient();
  const today = manilaToday();
  const { data, count } = await scoped(
    supabase
      .from('subject_status_items')
      .select('subject_id, track, label, detail, state, due_date, provisional, deliverable_id, subject:subjects!inner(name, type)', { count: 'exact' })
      .eq('subject.type', 'corporation')
      .not('due_date', 'is', null)
      .lte('due_date', addDays(today, NEEDS_ACTION_DAYS)),
    scope,
  )
    .order('due_date', { ascending: true })
    .limit(limit);
  return {
    total: count ?? 0,
    items: (data ?? []).map((r) => ({
      subjectId: r.subject_id as string,
      company: ((r.subject as unknown as { name?: string } | null)?.name as string) || '(unnamed)',
      track: r.track as TrackKey,
      label: r.label as string,
      detail: (r.detail as string | null) ?? null,
      state: r.state as ItemState,
      dueDate: r.due_date as string,
      provisional: !!r.provisional,
      deliverableId: (r.deliverable_id as string | null) ?? null,
    })),
  };
}

/** How many companies the viewer is on the team for — decides the default scope. */
export async function countMine(personId: string): Promise<number> {
  const supabase = await getSupabaseServerAuthClient();
  const { count } = await supabase
    .from('subject_status')
    .select('subject_id', { count: 'exact', head: true })
    .eq('type', 'corporation')
    .contains('team_person_ids', [personId]);
  return count ?? 0;
}
