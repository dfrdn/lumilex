import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { signStoragePaths } from '@/lib/storage-sign';
import { manilaToday, type Health, type ItemState } from '@/lib/corporations/status';
import type { DeadlineEntry, ExtensionBasis, ExtensionState } from '@/lib/trademark-deadlines';
import { addDays } from '@/lib/dates';

/**
 * The Trademarks list reads the stored status (subject_status, type
 * 'trademark'; kept by /api/cron/subject-status) — filtering, sorting and
 * paging in the database — and loads display details (image, classes, dates)
 * only for the page it shows. Its cost doesn't grow with the size of the book.
 */

export const TRADEMARK_PAGE_SIZE = 50;
export const NEEDS_ACTION_DAYS = 30;

export const TRADEMARK_VIEWS = ['active', 'Prelim', 'For Filing', 'Pending', 'Pending - OA', 'Registered', 'Abandoned', 'all'] as const;
export type TrademarkView = (typeof TRADEMARK_VIEWS)[number];
const ACTIVE = ['Prelim', 'For Filing', 'Pending', 'Pending - OA'];

export type TrademarkFilter = 'overdue' | 'soon' | 'waiting' | 'all';

/** `mine`: marks on a matter whose team includes this person. */
export type TrademarkScope = { mine: string } | 'all';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function scoped<Q extends { contains: (col: string, v: string[]) => any }>(q: Q, scope: TrademarkScope): Q {
  return scope === 'all' ? q : q.contains('team_person_ids', [scope.mine]);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function inView<Q extends { in: (c: string, v: string[]) => any; eq: (c: string, v: string) => any }>(q: Q, view: TrademarkView): Q {
  if (view === 'all') return q;
  if (view === 'active') return q.in('lifecycle_status', ACTIVE);
  return q.eq('lifecycle_status', view);
}

function likeTerm(q: string): string {
  return `%${q.replace(/[%_,()*\\"']/g, ' ').trim()}%`;
}

export interface TrademarkSummary {
  marks: number;
  overdueMarks: number;
  dueSoonItems: number;
  officeActions: number;
  waiting: number;
  /** Marks whose stored reading waits for the next refresh. */
  pending: number;
}

export async function getTrademarkSummary(scope: TrademarkScope): Promise<TrademarkSummary> {
  const supabase = await getSupabaseServerAuthClient();
  const today = manilaToday();
  const base = () => scoped(supabase.from('subject_status').select('subject_id', { count: 'exact', head: true }).eq('type', 'trademark'), scope);
  const [all, overdue, soon, oa, waiting, pending] = await Promise.all([
    base().neq('lifecycle_status', 'Abandoned'),
    base().gt('overdue', 0),
    scoped(
      supabase
        .from('subject_status_items')
        .select('subject_id, subject:subjects!inner(type)', { count: 'exact', head: true })
        .eq('subject.type', 'trademark')
        .neq('state', 'overdue')
        .lte('due_date', addDays(today, NEEDS_ACTION_DAYS)),
      scope,
    ),
    base().eq('lifecycle_status', 'Pending - OA'),
    base().eq('waiting_on_client', true),
    base().or(`stale.eq.true,computed_for.is.null,computed_for.lt.${today}`),
  ]);
  return {
    marks: all.count ?? 0,
    overdueMarks: overdue.count ?? 0,
    dueSoonItems: soon.count ?? 0,
    officeActions: oa.count ?? 0,
    waiting: waiting.count ?? 0,
    pending: pending.count ?? 0,
  };
}

export async function getTrademarkViewCounts(scope: TrademarkScope): Promise<Record<TrademarkView, number>> {
  const supabase = await getSupabaseServerAuthClient();
  const counts = await Promise.all(
    TRADEMARK_VIEWS.map((v) =>
      inView(scoped(supabase.from('subject_status').select('subject_id', { count: 'exact', head: true }).eq('type', 'trademark'), scope), v),
    ),
  );
  return Object.fromEntries(TRADEMARK_VIEWS.map((v, i) => [v, counts[i].count ?? 0])) as Record<TrademarkView, number>;
}

export interface TrademarkRow {
  id: string;
  mark: string;
  status: string;
  type: string | null;
  classes: number[];
  clientName: string | null;
  regIrNo: string | null;
  filingDate: string | null;
  /** A Madrid designation's date: the subsequent designation, or the international registration. Null for a national application. */
  designatedOn: string | null;
  /** A country designated abroad under one of our international registrations; null for a Philippine mark. */
  abroadIn: string | null;
  imageUrl: string | null;
  health: Health | null;
  overdue: number;
  next: { label: string; due: string; state: ItemState | null } | null;
}

export async function getTrademarkRows(firmId: string, {
  view = 'active',
  filter = 'all',
  q = '',
  page = 1,
  scope = 'all',
}: {
  view?: TrademarkView;
  filter?: TrademarkFilter;
  q?: string;
  page?: number;
  scope?: TrademarkScope;
}): Promise<{ rows: TrademarkRow[]; total: number }> {
  const supabase = await getSupabaseServerAuthClient();
  let query = inView(
    scoped(
      supabase
        .from('subject_status')
        .select('subject_id, name, lifecycle_status, company_type, client_name, identifier, health, overdue, next_label, next_due, next_state', { count: 'exact' })
        .eq('type', 'trademark'),
      scope,
    ),
    view,
  );
  if (filter === 'overdue') query = query.gt('overdue', 0);
  if (filter === 'soon') query = query.gt('due_soon', 0);
  if (filter === 'waiting') query = query.eq('waiting_on_client', true);
  if (q.trim()) {
    const term = likeTerm(q);
    query = query.or(`name.ilike.${term},client_name.ilike.${term},identifier.ilike.${term}`);
  }
  const from = (Math.max(1, page) - 1) * TRADEMARK_PAGE_SIZE;
  const { data, count } = await query
    .order('overdue', { ascending: false })
    .order('next_due', { ascending: true, nullsFirst: false })
    .order('name', { ascending: true })
    .range(from, from + TRADEMARK_PAGE_SIZE - 1);
  const status = data ?? [];
  if (!status.length) return { rows: [], total: count ?? 0 };

  const ids = status.map((s) => s.subject_id as string);
  const { data: marks } = await supabase.from('trademarks').select('id, classes, filing_date, mark_image_path, origin, ir_date, designation_date, country').in('id', ids);
  const markById = new Map((marks ?? []).map((m) => [m.id as string, m]));
  const paths = (marks ?? []).map((m) => m.mark_image_path as string | null).filter((p): p is string => !!p);
  const signed = await signStoragePaths(getServiceDbForFirm(firmId), 'files', paths, 60 * 60, { download: false });

  return {
    total: count ?? 0,
    rows: status.map((s) => {
      const m = markById.get(s.subject_id as string);
      const path = (m?.mark_image_path as string | null) ?? null;
      return {
        id: s.subject_id as string,
        mark: (s.name as string) || '(Untitled)',
        status: (s.lifecycle_status as string) ?? 'Prelim',
        type: (s.company_type as string | null) ?? null,
        classes: ((m?.classes as number[] | null) ?? []).slice().sort((a, b) => a - b),
        clientName: (s.client_name as string | null) || null,
        regIrNo: (s.identifier as string | null) ?? null,
        filingDate: (m?.filing_date as string | null) ?? null,
        designatedOn: m && m.origin !== 'national' ? ((m.designation_date ?? m.ir_date) as string | null) ?? null : null,
        abroadIn: m?.origin === 'madrid_out' ? (m.country as string) : null,
        imageUrl: path ? signed.get(path) ?? null : null,
        health: (s.health as Health | null) ?? null,
        overdue: (s.overdue as number) ?? 0,
        next: s.next_label && s.next_due
          ? { label: s.next_label as string, due: s.next_due as string, state: (s.next_state as ItemState | null) ?? null }
          : null,
      };
    }),
  };
}

export interface TrademarkNeedsAction {
  trademark: { id: string; mark: string; clientName: string };
  deadline: DeadlineEntry & { kind: string };
}

/**
 * What is overdue or falls due within NEEDS_ACTION_DAYS, across the scope — earliest first —
 * and any deadline whose extension still awaits IPOPHL's decision, however far off.
 */
export async function getTrademarkNeedsAction(scope: TrademarkScope, limit = 60): Promise<{ entries: TrademarkNeedsAction[]; total: number }> {
  const supabase = await getSupabaseServerAuthClient();
  const today = manilaToday();
  const { data, count } = await scoped(
    supabase
      .from('subject_status_items')
      .select('subject_id, label, due_date, meta, subject:subjects!inner(type, name)', { count: 'exact' })
      .eq('subject.type', 'trademark')
      .or(`due_date.lte.${addDays(today, NEEDS_ACTION_DAYS)},meta->>extension.eq.pending`),
    scope,
  )
    .order('due_date', { ascending: true })
    .limit(limit);
  const ids = [...new Set((data ?? []).map((i) => i.subject_id as string))];
  const { data: names } = ids.length
    ? await supabase.from('subject_status').select('subject_id, client_name').in('subject_id', ids)
    : { data: [] };
  const clientOf = new Map((names ?? []).map((n) => [n.subject_id as string, (n.client_name as string | null) ?? '']));

  return {
    total: count ?? 0,
    entries: (data ?? []).map((i) => {
      const meta = (i.meta ?? {}) as {
        kind?: string; opens?: string | null; extendedDue?: string | null; extensionBasis?: ExtensionBasis | null;
        officeAction?: { id: string; final: boolean } | null;
        extension?: ExtensionState | null;
      };
      const kind = meta.kind ?? (i.label as string);
      return {
        trademark: {
          id: i.subject_id as string,
          mark: ((i.subject as unknown as { name?: string } | null)?.name as string) || '(Untitled)',
          clientName: clientOf.get(i.subject_id as string) ?? '',
        },
        deadline: {
          kind,
          label: kind,
          due: i.due_date as string,
          opens: meta.opens ?? null,
          extendedDue: meta.extendedDue ?? null,
          extensionBasis: meta.extensionBasis ?? null,
          ...(meta.officeAction ? { officeAction: meta.officeAction } : {}),
          ...(meta.extension ? { extension: meta.extension } : {}),
        },
      };
    }),
  };
}

export async function countMyMarks(personId: string): Promise<number> {
  const supabase = await getSupabaseServerAuthClient();
  const { count } = await supabase
    .from('subject_status')
    .select('subject_id', { count: 'exact', head: true })
    .eq('type', 'trademark')
    .contains('team_person_ids', [personId]);
  return count ?? 0;
}
