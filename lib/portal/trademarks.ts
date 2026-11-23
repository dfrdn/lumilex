import type { SupabaseClient } from '@supabase/supabase-js';
import { signStoragePaths } from '@/lib/storage-sign';
import type { ItemState, TrackKey } from '@/lib/corporations/status';
import { aheadOrder, chunks, clientMatterLinks, forClient, portalScope, type ClientMatterLinks, type PortalCompanyRequest } from './companies';
import { markDeadlineCopy } from './company-wording';
import { countryName } from '@/lib/trademarks/countries';

/**
 * The client's marks, on the same terms as their companies: shown when a
 * matter of theirs covers the mark and the team has switched it on, read from
 * the stored status, and never telling the client a deadline has passed.
 *
 * `trademarks` holds notes, billing instructions and the incident log; only
 * the few display columns below are read, and only for marks `portalScope`
 * has already admitted.
 */

export interface PortalMark {
  id: string;
  mark: string;
  type: string | null;
  status: string;
  classes: number[];
  regNo: string | null;
  filingDate: string | null;
  regDate: string | null;
  /** The end of the current ten-year term — for a Madrid designation, the international registration's. */
  registeredUntil: string | null;
  /**
   * A designation under the Madrid Protocol: where (the Philippines, or the
   * country designated abroad), and when it was registered internationally
   * or designated. Null for an application filed with IPOPHL.
   */
  madrid: { country: string; irDate: string | null; designatedOn: string | null } | null;
  imageUrl: string | null;
  waitingOnClient: boolean;
  next: { label: string; dueDate: string | null; state: ItemState } | null;
  team: { name: string; initials: string; avatarUrl: string | null }[];
  updatedAt: string | null;
}

export interface PortalMarkItem {
  key: string;
  track: TrackKey;
  label: string;
  state: ItemState;
  dueDate: string | null;
}

export interface PortalMarkDetail {
  mark: PortalMark;
  items: PortalMarkItem[];
  requests: PortalCompanyRequest[];
}

interface MarkDisplay {
  classes: number[];
  filingDate: string | null;
  regDate: string | null;
  imageUrl: string | null;
  madrid: PortalMark['madrid'];
}

const plusYears = (iso: string, n: number) => `${Number(iso.slice(0, 4)) + n}${iso.slice(4, 10)}`;

async function display(service: SupabaseClient, ids: string[]): Promise<Map<string, MarkDisplay>> {
  const rows: Record<string, unknown>[] = [];
  for (const batch of chunks(ids)) {
    const { data } = await service
      .from('trademarks')
      .select('id, classes, filing_date, reg_date, mark_image_path, origin, country, ir_date, designation_date')
      .in('id', batch);
    rows.push(...(data ?? []));
  }
  const paths = rows.map((r) => r.mark_image_path as string | null).filter((p): p is string => !!p);
  const signed = await signStoragePaths(service, 'files', paths, 60 * 60, { download: false });
  return new Map(
    rows.map((r) => [
      r.id as string,
      {
        classes: ((r.classes as number[] | null) ?? []).slice().sort((a, b) => a - b),
        filingDate: (r.filing_date as string | null) ?? null,
        regDate: (r.reg_date as string | null) ?? null,
        imageUrl: r.mark_image_path ? signed.get(r.mark_image_path as string) ?? null : null,
        madrid: r.origin === 'madrid_in' || r.origin === 'madrid_out'
          ? {
            country: r.origin === 'madrid_in' ? 'the Philippines' : countryName(r.country as string),
            irDate: (r.ir_date as string | null) ?? null,
            designatedOn: (r.designation_date as string | null) ?? null,
          }
          : null,
      },
    ]),
  );
}

const STATUS_COLUMNS = 'subject_id, name, company_type, identifier, lifecycle_status, waiting_on_client, team, computed_at';

type ItemRow = { subject_id: string; item_key: string; track: string; label: string; state: string; due_date: string | null; meta: { kind?: string } | null };

function clientItem(i: ItemRow, designation: boolean): PortalMarkItem & { pastDue: boolean } {
  return forClient({
    key: i.item_key,
    track: i.track as TrackKey,
    label: markDeadlineCopy(i.meta?.kind ?? '', designation) ?? i.label,
    state: i.state as ItemState,
    dueDate: i.due_date,
  });
}

/** Still ahead for the client: not done, not filed, not the firm's to do. */
function isAhead(i: { state: ItemState }): boolean {
  return i.state !== 'done' && i.state !== 'filed' && i.state !== 'not_ours';
}

function toMark(s: Record<string, unknown>, d: MarkDisplay | undefined, next: PortalMark['next']): PortalMark {
  const regDate = d?.regDate ?? null;
  return {
    id: s.subject_id as string,
    mark: (s.name as string) || 'Your mark',
    type: (s.company_type as string | null) ?? null,
    status: (s.lifecycle_status as string) ?? 'Prelim',
    classes: d?.classes ?? [],
    regNo: (s.identifier as string | null) ?? null,
    filingDate: d?.filingDate ?? null,
    regDate,
    // A designation lasts as long as its international registration: ten years from its date (Protocol art. 6(1)).
    registeredUntil: d?.madrid ? (d.madrid.irDate && regDate ? plusYears(d.madrid.irDate, 10) : null) : regDate ? plusYears(regDate, 10) : null,
    imageUrl: d?.imageUrl ?? null,
    madrid: d?.madrid ?? null,
    waitingOnClient: !!s.waiting_on_client,
    next,
    team: ((s.team as PortalMark['team'] | null) ?? []).map((m) => ({ name: m.name, initials: m.initials, avatarUrl: m.avatarUrl })),
    updatedAt: (s.computed_at as string | null) ?? null,
  };
}

export async function loadPortalTrademarks(db: SupabaseClient, clientId: string): Promise<PortalMark[]> {
  const { markIds } = await portalScope(db, clientId);
  if (!markIds.length) return [];
  const status: Record<string, unknown>[] = [];
  const items: ItemRow[] = [];
  for (const ids of chunks(markIds)) {
    const [{ data: s }, { data: i }] = await Promise.all([
      db.from('subject_status').select(STATUS_COLUMNS).in('subject_id', ids),
      db.from('subject_status_items').select('subject_id, item_key, track, label, state, due_date, meta').in('subject_id', ids),
    ]);
    status.push(...(s ?? []));
    items.push(...((i ?? []) as ItemRow[]));
  }
  const shown = await display(db, markIds);
  const nextOf = new Map<string, PortalMark['next']>();
  for (const id of markIds) {
    const designation = !!shown.get(id)?.madrid;
    const [first] = items.filter((i) => i.subject_id === id).map((i) => clientItem(i, designation)).filter(isAhead).sort(aheadOrder);
    nextOf.set(id, first ? { label: first.label, dueDate: first.dueDate, state: first.state } : null);
  }
  return status
    .map((s) => toMark(s, shown.get(s.subject_id as string), nextOf.get(s.subject_id as string) ?? null))
    .sort((a, b) => Number(b.waitingOnClient) - Number(a.waitingOnClient) || a.mark.localeCompare(b.mark));
}

export async function loadPortalTrademark(
  db: SupabaseClient,
  clientId: string,
  markId: string,
): Promise<PortalMarkDetail | null> {
  const { markIds, links, matterName } = await portalScope(db, clientId);
  if (!markIds.includes(markId)) return null;
  return buildPortalTrademark(db, markId, { links, matterName });
}

/**
 * What the client would see of this mark if it were switched on: the same
 * build as `loadPortalTrademark`, for the person deciding whether to switch
 * it. Staff only; the portal itself goes through `loadPortalTrademark`.
 */
export async function previewPortalTrademark(
  db: SupabaseClient,
  clientId: string,
  markId: string,
): Promise<PortalMarkDetail | null> {
  const scope = await clientMatterLinks(db, clientId);
  if (!scope.links.some((l) => l.subject_id === markId)) return null;
  return buildPortalTrademark(db, markId, scope);
}

async function buildPortalTrademark(
  db: SupabaseClient,
  markId: string,
  { links, matterName }: ClientMatterLinks,
): Promise<PortalMarkDetail | null> {
  const matterIds = [...new Set(links.filter((l) => l.subject_id === markId).map((l) => l.matter_id))];
  const [{ data: status }, { data: rawItems }, { data: requests }, shown] = await Promise.all([
    db.from('subject_status').select(STATUS_COLUMNS).eq('subject_id', markId).maybeSingle(),
    db.from('subject_status_items').select('subject_id, item_key, track, label, state, due_date, meta').eq('subject_id', markId),
    matterIds.length
      ? db
          .from('file_requests')
          .select('id, description, due_at, matter_id')
          .in('matter_id', matterIds)
          .is('fulfilled_at', null)
          .is('canceled_at', null)
          .order('created_at', { ascending: true })
      : Promise.resolve({ data: [] }),
    display(db, [markId]),
  ]);
  if (!status) return null;
  const designation = !!shown.get(markId)?.madrid;
  const items = ((rawItems ?? []) as ItemRow[]).map((i) => clientItem(i, designation)).sort(aheadOrder);
  const first = items.find(isAhead);
  return {
    mark: toMark(status, shown.get(markId), first ? { label: first.label, dueDate: first.dueDate, state: first.state } : null),
    items: items.map(({ key, track, label, state, dueDate }) => ({ key, track, label, state, dueDate })),
    requests: (requests ?? []).map((r) => ({
      id: r.id as string,
      description: (r.description as string) || 'Documents requested',
      dueAt: (r.due_at as string | null) ?? null,
      matterId: r.matter_id as string,
      matterName: matterName.get(r.matter_id as string) ?? 'Matter',
    })),
  };
}
