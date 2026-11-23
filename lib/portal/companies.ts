import type { SupabaseClient } from '@supabase/supabase-js';
import type { Health, ItemState, Phase, TrackKey } from '@/lib/corporations/status';

/**
 * The client's companies, read from the stored status (subject_status and
 * its items) — never the raw records, so no TIN, ID or address can reach the
 * portal. A company appears when one of the client's matters covers it and
 * the team has switched it on for the portal (corporations.portal_visible).
 *
 * The client is never told something is past due. A past-due item is shown
 * as in progress, without its (past) date, and comes first among what is
 * ahead; a red track reads as one in progress. `forClient` is the one place
 * that happens, so the overdue state never leaves the server.
 *
 * A client's JWT reads none of these tables. Every loader takes the
 * firm-scoped service client (`getServiceDbForFirm(session.firmId)`) and
 * filters by client and by the portal switch itself, so the portal and the
 * staff preview call the same code and see exactly the same thing.
 */

export interface PortalCompanyTrack {
  key: TrackKey;
  health: Health;
  done: number;
  total: number;
}

export interface PortalCompany {
  id: string;
  name: string;
  companyType: string | null;
  identifier: string | null;
  phase: Phase | null;
  health: Health | null;
  dueSoon: number;
  waitingOnClient: boolean;
  tracks: PortalCompanyTrack[];
  next: { label: string; dueDate: string | null; state: ItemState | null } | null;
  team: { name: string; initials: string; avatarUrl: string | null }[];
  updatedAt: string | null;
}

export interface PortalCompanyItem {
  key: string;
  track: TrackKey;
  label: string;
  detail: string | null;
  state: ItemState;
  dueDate: string | null;
  provisional: boolean;
}

export interface PortalCompanyRequest {
  id: string;
  description: string;
  dueAt: string | null;
  matterId: string;
  matterName: string;
}

export interface PortalCompanyDocument {
  id: number;
  name: string;
  category: string;
  storagePath: string;
  filingYear: number | null;
  uploadedAt: string;
}

export interface PortalCompanyDetail {
  company: PortalCompany;
  items: PortalCompanyItem[];
  requests: PortalCompanyRequest[];
  documents: PortalCompanyDocument[];
}

const BATCH = 100;

export function chunks<T>(list: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += BATCH) out.push(list.slice(i, i + BATCH));
  return out;
}

export type PortalSubjectType = 'corporation' | 'trademark';

/** The client's matters and every subject they cover, whether or not it is switched on. */
export async function clientMatterLinks(db: SupabaseClient, clientId: string) {
  const { data: matters } = await db.from('matters').select('notion_id, name').eq('client_id', clientId);
  const matterName = new Map((matters ?? []).map((m) => [m.notion_id as string, (m.name as string | null) ?? 'Matter']));
  const links: { subject_id: string; matter_id: string }[] = [];
  for (const ids of chunks([...matterName.keys()])) {
    const { data } = await db.from('matter_subjects').select('subject_id, matter_id').in('matter_id', ids);
    links.push(...((data ?? []) as typeof links));
  }
  return { links, matterName };
}

export type ClientMatterLinks = Awaited<ReturnType<typeof clientMatterLinks>>;

/**
 * The client's matters, and the subjects (companies, marks) those matters
 * cover that are shown in the portal.
 */
export async function portalScope(db: SupabaseClient, clientId: string) {
  const { links, matterName } = await clientMatterLinks(db, clientId);
  const candidates = [...new Set(links.map((l) => l.subject_id))];
  const typeOf = new Map<string, PortalSubjectType>();
  for (const ids of chunks(candidates)) {
    const [{ data: corps }, { data: marks }] = await Promise.all([
      db.from('corporations').select('id').in('id', ids).eq('portal_visible', true),
      db.from('trademarks').select('id').in('id', ids).eq('portal_visible', true),
    ]);
    for (const r of corps ?? []) typeOf.set(r.id as string, 'corporation');
    for (const r of marks ?? []) typeOf.set(r.id as string, 'trademark');
  }
  const idsOf = (t: PortalSubjectType) => [...typeOf].filter(([, v]) => v === t).map(([k]) => k);
  return { companyIds: idsOf('corporation'), markIds: idsOf('trademark'), links, matterName };
}

/** Which kinds of subject the client has in the portal — decides the nav links. */
export async function portalSubjects(db: SupabaseClient, clientId: string): Promise<{ companies: boolean; trademarks: boolean }> {
  const s = await portalScope(db, clientId);
  return { companies: s.companyIds.length > 0, trademarks: s.markIds.length > 0 };
}

/** Red means something is past due — which the client is not shown. */
const clientHealth = (h: Health | null): Health | null => (h === 'red' ? 'grey' : h);

type NextItem = PortalCompany['next'];

/** An item as the client sees it: past due becomes in progress, and its past date is dropped. */
export function forClient<T extends { state: ItemState; dueDate: string | null }>(item: T): T & { pastDue: boolean } {
  return item.state === 'overdue'
    ? { ...item, state: 'in_progress', dueDate: null, pastDue: true }
    : { ...item, pastDue: false };
}

/** What is ahead, in the order the client should read it: what is under way now, then by date. */
export function aheadOrder(a: { pastDue: boolean; dueDate: string | null }, b: { pastDue: boolean; dueDate: string | null }): number {
  return Number(b.pastDue) - Number(a.pastDue) || (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999');
}

function toCompany(r: Record<string, unknown>, next: NextItem): PortalCompany {
  return {
    id: r.subject_id as string,
    name: (r.name as string) || 'Your company',
    companyType: (r.company_type as string | null) ?? null,
    identifier: (r.identifier as string | null) ?? null,
    phase: (r.phase as Phase | null) ?? null,
    health: clientHealth((r.health as Health | null) ?? null),
    dueSoon: (r.due_soon as number) ?? 0,
    waitingOnClient: !!r.waiting_on_client,
    // The team's per-track summary stays behind: it speaks in firm shorthand.
    tracks: ((r.focus as PortalCompanyTrack[] | null) ?? []).map((t) => ({
      key: t.key, health: clientHealth(t.health) ?? 'grey', done: t.done, total: t.total,
    })),
    next,
    team: ((r.team as PortalCompany['team'] | null) ?? []).map((m) => ({ name: m.name, initials: m.initials, avatarUrl: m.avatarUrl })),
    updatedAt: (r.computed_at as string | null) ?? null,
  };
}

const STATUS_COLUMNS =
  'subject_id, name, company_type, identifier, phase, health, due_soon, waiting_on_client, focus, team, computed_at';

/** Each company's next item, as the client sees it. */
async function nextItems(db: SupabaseClient, ids: string[]): Promise<Map<string, NextItem>> {
  const { data } = await db
    .from('subject_status_items')
    .select('subject_id, label, due_date, state')
    .in('subject_id', ids)
    .not('state', 'in', '(done,filed,not_ours)');
  const bySubject = new Map<string, (NextItem & { pastDue: boolean })[]>();
  for (const i of data ?? []) {
    const item = forClient({ label: i.label as string, dueDate: (i.due_date as string | null) ?? null, state: i.state as ItemState });
    if (!i.due_date && !item.pastDue) continue;
    const list = bySubject.get(i.subject_id as string) ?? [];
    list.push(item);
    bySubject.set(i.subject_id as string, list);
  }
  const out = new Map<string, NextItem>();
  for (const [id, list] of bySubject) {
    const [first] = list.sort(aheadOrder);
    out.set(id, { label: first.label, dueDate: first.dueDate, state: first.state });
  }
  return out;
}

export async function loadPortalCompanies(db: SupabaseClient, clientId: string): Promise<PortalCompany[]> {
  const { companyIds } = await portalScope(db, clientId);
  const out: PortalCompany[] = [];
  for (const ids of chunks(companyIds)) {
    const [{ data }, next] = await Promise.all([
      db.from('subject_status').select(STATUS_COLUMNS).eq('type', 'corporation').in('subject_id', ids),
      nextItems(db, ids),
    ]);
    out.push(...(data ?? []).map((r) => toCompany(r as Record<string, unknown>, next.get(r.subject_id as string) ?? null)));
  }
  // What needs the client first, then by name.
  return out.sort((a, b) => Number(b.waitingOnClient) - Number(a.waitingOnClient) || a.name.localeCompare(b.name));
}


export async function loadPortalCompany(
  db: SupabaseClient,
  clientId: string,
  companyId: string,
): Promise<PortalCompanyDetail | null> {
  const { companyIds, links, matterName } = await portalScope(db, clientId);
  if (!companyIds.includes(companyId)) return null;
  return buildPortalCompany(db, companyId, { links, matterName });
}

/**
 * What the client would see of this company if it were switched on: the same
 * build as `loadPortalCompany`, for the person deciding whether to switch it.
 * Staff only; the portal itself goes through `loadPortalCompany`.
 */
export async function previewPortalCompany(
  db: SupabaseClient,
  clientId: string,
  companyId: string,
): Promise<PortalCompanyDetail | null> {
  const scope = await clientMatterLinks(db, clientId);
  if (!scope.links.some((l) => l.subject_id === companyId)) return null;
  return buildPortalCompany(db, companyId, scope);
}

async function buildPortalCompany(
  db: SupabaseClient,
  companyId: string,
  { links, matterName }: ClientMatterLinks,
): Promise<PortalCompanyDetail | null> {
  const matterIds = [...new Set(links.filter((l) => l.subject_id === companyId).map((l) => l.matter_id))];
  const [{ data: status }, { data: items }, { data: files }, { data: requests }] = await Promise.all([
    db.from('subject_status').select(STATUS_COLUMNS).eq('subject_id', companyId).maybeSingle(),
    db
      .from('subject_status_items')
      .select('item_key, track, label, detail, state, due_date, provisional')
      .eq('subject_id', companyId)
      .neq('state', 'not_ours')
      .order('due_date', { ascending: true, nullsFirst: false }),
    db
      .from('corporation_files')
      .select('id, name, category, storage_path, filing_year, uploaded_at')
      .eq('corporation_id', companyId)
      .eq('client_visible', true)
      .is('person_id', null)
      .order('uploaded_at', { ascending: false }),
    matterIds.length
      ? db
          .from('file_requests')
          .select('id, description, due_at, matter_id')
          .in('matter_id', matterIds)
          .is('fulfilled_at', null)
          .is('canceled_at', null)
          .order('created_at', { ascending: true })
      : Promise.resolve({ data: [] }),
  ]);
  if (!status) return null;
  const shown = (items ?? [])
    .map((i) =>
      forClient({
        key: i.item_key as string,
        track: i.track as TrackKey,
        label: i.label as string,
        detail: (i.detail as string | null) ?? null,
        state: i.state as ItemState,
        dueDate: (i.due_date as string | null) ?? null,
        provisional: !!i.provisional,
      }),
    )
    .sort(aheadOrder);
  const open = shown.find((i) => (i.dueDate || i.pastDue) && i.state !== 'done' && i.state !== 'filed');

  return {
    company: toCompany(
      status as Record<string, unknown>,
      open ? { label: open.label, dueDate: open.dueDate, state: open.state } : null,
    ),
    // Already in reading order; the past-due flag stays on the server.
    items: shown.map((i) => ({
      key: i.key, track: i.track, label: i.label, detail: i.detail, state: i.state, dueDate: i.dueDate, provisional: i.provisional,
    })),
    requests: (requests ?? []).map((r) => ({
      id: r.id as string,
      description: (r.description as string) || 'Documents requested',
      dueAt: (r.due_at as string | null) ?? null,
      matterId: r.matter_id as string,
      matterName: matterName.get(r.matter_id as string) ?? 'Matter',
    })),
    documents: (files ?? []).map((f) => ({
      id: f.id as number,
      name: f.name as string,
      category: f.category as string,
      storagePath: f.storage_path as string,
      filingYear: (f.filing_year as number | null) ?? null,
      uploadedAt: f.uploaded_at as string,
    })),
  };
}
