import type Anthropic from '@anthropic-ai/sdk';
import { getSupabase } from '@/lib/supabase';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { searchEmbeddings } from '@/lib/ai/embeddings';
import { getMatterDeliverables } from '@/lib/ai/matter-deliverables';
import {
  notifyAttendeesAddedToMeeting,
  notifyAttendeesAddedToHearing,
} from '@/lib/notifications';
import {
  searchJurisprudence,
  searchRepublicActs,
  getJurisCase,
  getRepublicAct,
} from '@/lib/juris';
import { logAgentAudit } from '@/lib/audit';
import { AGENT_IDS } from '@/lib/agents/registry';
import { appBaseUrl } from '@/lib/app-url';
import { mintId } from '@/lib/ids';
import { resolveRange } from '@/lib/assistant/dates';
import { CLOSED_STATUSES, DELIVERABLE_STATUS } from '@/lib/deliverable-status';
import { pgInList } from '@/lib/postgrest';
import { TASK_STATUS } from '@/lib/task-status';
import { toManilaInstant } from '@/lib/dates';

export { manilaToday } from '@/lib/assistant/dates';

/** The team member the assistant is acting for. Their firm scopes every read
 *  and write made on their behalf. */
export interface AssistantMember {
  personId: string;
  authUserId: string | null;
  name: string;
  role: string;
  firmId: string;
}

/**
 * A surface's identity + delivery hooks. Only file delivery and the "working…"
 * ping differ between surfaces, so they're injected here rather than imported.
 */
export interface ToolContext {
  member: AssistantMember;
  /** The in-app conversation id. */
  chatId: string;
  /** Optional "working…" hint (no-op on web). */
  notifyWorking?: () => Promise<void>;
  /** Deliver a file to the surface. Web signs a URL. */
  deliverFile?: (file: {
    storageRef: string;
    name: string;
    caption: string;
  }) => Promise<{ ok: boolean; url?: string; error?: string }>;
}

/** Strip characters that would break a PostgREST `.or()` filter string. */
function sanitize(q: string): string {
  return String(q ?? '').replace(/[,()%*]/g, ' ').trim();
}

function involves(personId: string, ...arrays: unknown[]): boolean {
  return arrays.some((a) => Array.isArray(a) && a.includes(personId));
}

/* eslint-disable @typescript-eslint/no-explicit-any */

// ── Read handlers (service-role, firm-scoped — same model as matter-chat) ──
//
// Every handler that touches the database takes the operator's firm id
// (ctx.member.firmId, resolved from their team row) and reads/writes through
// the firm-scoped service client. Storage handles (downloadAttachment,
// signedUrlFor) stay on the raw client per the storage-handle rule.

const MATTER_SELECT =
  'notion_id, name, matter_code, client_name, status, is_case, case_title, case_number';
const MATTER_COLS = ['name', 'matter_code', 'client_name', 'case_title', 'case_number'];
// Words that add no signal and cause punctuation mismatches (e.g. "v" vs "v.").
const MATTER_STOPWORDS = new Set(['v', 'vs', 'versus', 'the', 'of', 'and', 'in', 're', 'a', 'an']);

export function searchTokens(raw: string): string[] {
  return raw
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((t) => t.length >= 2 && !MATTER_STOPWORDS.has(t));
}

function mapMatter(m: any) {
  return {
    matterId: m.notion_id,
    name: m.name,
    matterCode: m.matter_code,
    clientName: m.client_name,
    caseTitle: m.case_title,
    caseNumber: m.case_number,
    status: m.status,
    isCase: m.is_case,
  };
}

// ── Read access ──────────────────────────────────────────────────────
//
// Reads run on the firm-scoped service client, which bypasses RLS, so the
// matter gate RLS applies to the signed-in UI has to be applied here too or
// the assistant becomes a way around it. Mirrors has_matter_access(): a
// privileged role reads every matter; anyone else reads the matters whose team
// lists them, and nothing without a matter. Matters, deliverables and their
// files, hearings, meetings and tasks are gated this way in RLS; files,
// clients and executive summaries are readable by every staff member there,
// and are left alone here to match.

/** The matter ids this member may read, or null for a role that reads every matter. */
async function readableMatterIds(member: AssistantMember): Promise<Set<string> | null> {
  if (PRIVILEGED_ROLES.has(member.role)) return null;
  const { data } = await getServiceDbForFirm(member.firmId)
    .from('matters')
    .select('notion_id')
    .contains('team_person_ids', [member.personId]);
  return new Set((data ?? []).map((r: { notion_id: string }) => r.notion_id));
}

function canReadMatter(readable: Set<string> | null, matterId: string | null | undefined): boolean {
  if (readable === null) return true;
  return !!matterId && readable.has(matterId);
}

async function findMatter(input: any, member: AssistantMember): Promise<any> {
  const raw = sanitize(input.query);
  if (!raw) return { matches: [] };
  const svc = getServiceDbForFirm(member.firmId);
  const teamOnly = !PRIVILEGED_ROLES.has(member.role);
  const tokens = searchTokens(raw);
  const terms = tokens.length ? tokens : [raw.toLowerCase()];

  // Pass 1: every significant token must appear in some column (chained .or()
  // blocks are ANDed). Tolerant of word order and punctuation — "People v
  // Cruz" matches name "People v. Dela Cruz", and case titles/numbers are searched.
  let query = svc.from('matters').select(MATTER_SELECT);
  for (const t of terms) {
    query = query.or(MATTER_COLS.map((c) => `${c}.ilike.%${t}%`).join(','));
  }
  if (teamOnly) query = query.contains('team_person_ids', [member.personId]);
  let { data } = await query.limit(8);

  // Pass 2 (fallback): any token in any column, if the strict pass found nothing.
  if (!data || data.length === 0) {
    const ors = terms.flatMap((t) => MATTER_COLS.map((c) => `${c}.ilike.%${t}%`)).join(',');
    let fallback = svc.from('matters').select(MATTER_SELECT).or(ors);
    if (teamOnly) fallback = fallback.contains('team_person_ids', [member.personId]);
    ({ data } = await fallback.limit(8));
  }

  return { matches: (data ?? []).map(mapMatter) };
}

const PERSON_SELECT = 'person_id, name, nickname, initials, role, position';
const PERSON_COLS = ['name', 'nickname', 'initials'];

function mapPerson(p: any) {
  return {
    personId: p.person_id,
    name: p.name,
    nickname: p.nickname,
    initials: p.initials,
    role: p.role,
    position: p.position,
  };
}

async function findPerson(input: any, firmId: string): Promise<any> {
  const raw = sanitize(input.query);
  if (!raw) return { matches: [] };
  const svc = getServiceDbForFirm(firmId);
  const tokens = searchTokens(raw);
  const terms = tokens.length ? tokens : [raw.toLowerCase()];

  // Pass 1: every significant token must appear in some column (chained .or()
  // blocks are ANDed). Tolerant of word order, initials, and extra middle names
  // the user supplies but we don't store — "Maria Clara Santos" or "MCS" both
  // resolve to "Maria Santos".
  let query = svc.from('team').select(PERSON_SELECT).eq('active', true);
  for (const t of terms) {
    query = query.or(PERSON_COLS.map((c) => `${c}.ilike.%${t}%`).join(','));
  }
  let { data } = await query.limit(8);

  // Pass 2 (fallback): any token in any column, if the strict pass found nothing
  // (e.g. an unstored middle name made every-token-must-match fail).
  if (!data || data.length === 0) {
    const ors = terms.flatMap((t) => PERSON_COLS.map((c) => `${c}.ilike.%${t}%`)).join(',');
    ({ data } = await svc.from('team').select(PERSON_SELECT).eq('active', true).or(ors).limit(8));
  }

  return { matches: (data ?? []).map(mapPerson) };
}

async function getSchedule(input: any, ctx: ToolContext): Promise<any> {
  const { start, end } = resolveRange(input.preset, input.start, input.end);
  const scope = input.scope === 'firm' ? 'firm' : 'mine';
  const pid = ctx.member.personId;
  const svc = getServiceDbForFirm(ctx.member.firmId);
  const startTs = `${start}T00:00:00+08:00`;
  const endTs = `${end}T23:59:59+08:00`;

  const [hearingsRes, meetingsRes, deliverablesRes, tasksRes] = await Promise.all([
    svc
      .from('hearings')
      .select('name, date, type, status, matter_id, matter_name, attendee_ids')
      .gte('date', startTs)
      .lte('date', endTs)
      .order('date')
      .limit(200),
    svc
      .from('meetings')
      .select('name, date_start, type, matter_id, matter_name, attendee_ids')
      .gte('date_start', startTs)
      .lte('date_start', endTs)
      .order('date_start')
      .limit(200),
    svc
      .from('deliverables')
      .select('name, external_due_date, status, matter_id, matter_name, drafter_ids, reviewer_ids, currently_with_ids')
      .gte('external_due_date', start)
      .lte('external_due_date', end)
      .not('status', 'in', pgInList(CLOSED_STATUSES))
      .order('external_due_date')
      .limit(200),
    svc
      .from('tasks')
      .select('name, due_date, status, matter_id, matter_name, assignee_ids')
      .gte('due_date', start)
      .lte('due_date', end)
      .eq('done', false)
      .order('due_date')
      .limit(200),
  ]);

  const mine = scope === 'mine';
  // Firm scope shows what the member is on, plus anything on a matter they can read.
  const readable = mine ? null : await readableMatterIds(ctx.member);
  const visible = (r: { matter_id: string | null }, involved: boolean) =>
    mine ? involved : involved || canReadMatter(readable, r.matter_id);
  const hearings = (hearingsRes.data ?? [])
    .filter((r) => visible(r, involves(pid, r.attendee_ids)))
    .map((r) => ({ name: r.name, date: r.date, type: r.type, status: r.status, matter: r.matter_name }));
  const meetings = (meetingsRes.data ?? [])
    .filter((r) => visible(r, involves(pid, r.attendee_ids)))
    .map((r) => ({ name: r.name, date: r.date_start, type: r.type, matter: r.matter_name }));
  const deliverableDeadlines = (deliverablesRes.data ?? [])
    .filter((r) => visible(r, involves(pid, r.drafter_ids, r.reviewer_ids, r.currently_with_ids)))
    .map((r) => ({ name: r.name, dueDate: r.external_due_date, status: r.status, matter: r.matter_name }));
  const tasks = (tasksRes.data ?? [])
    .filter((r) => visible(r, involves(pid, r.assignee_ids)))
    .map((r) => ({ name: r.name, dueDate: r.due_date, status: r.status, matter: r.matter_name }));

  return {
    range: { start, end },
    scope,
    counts: {
      hearings: hearings.length,
      meetings: meetings.length,
      deliverableDeadlines: deliverableDeadlines.length,
      tasks: tasks.length,
    },
    hearings,
    meetings,
    deliverableDeadlines,
    tasks,
  };
}

async function getMatter(input: any, member: AssistantMember): Promise<any> {
  const firmId = member.firmId;
  if (!canReadMatter(await readableMatterIds(member), input.matterId)) {
    return { error: 'Matter not found. Use find_matter to get a valid matterId first.' };
  }
  const svc = getServiceDbForFirm(firmId);
  const { data: matter } = await svc
    .from('matters')
    .select('notion_id, name, matter_code, client_name, type, status, case_title, case_number, court, is_case')
    .eq('notion_id', input.matterId)
    .maybeSingle();
  if (!matter) return { error: 'Matter not found. Use find_matter to get a valid matterId first.' };

  const { data: brief } = await svc
    .from('matter_summaries')
    .select(
      'summary, latest_incident, latest_incident_date, key_dates, open_issues, posture, parties, claims_and_defenses, court_and_venue, key_rulings, generated_at, needs_refresh',
    )
    .eq('matter_id', input.matterId)
    .maybeSingle();

  const { data: exec } = await svc
    .from('matter_exec_summaries')
    .select('overview, current_posture, open_items, reading_list, generated_at')
    .eq('matter_id', input.matterId)
    .maybeSingle();

  // Live structured deliverables — the source of truth for status/deadlines,
  // which the (possibly stale) brief above must not be trusted for.
  const deliverables = (await getMatterDeliverables(input.matterId, firmId)).filter(
    (d) => d.status !== DELIVERABLE_STATUS.ARCHIVED,
  );

  return { matter, brief: brief ?? null, exec: exec ?? null, liveDeliverables: deliverables };
}

async function getDeliverables(input: any, member: AssistantMember): Promise<any> {
  if (!input.matterId) {
    return { error: 'Provide a matterId — use find_matter first.' };
  }
  if (!canReadMatter(await readableMatterIds(member), input.matterId)) {
    return { error: 'Matter not found. Use find_matter to get a valid matterId first.' };
  }
  const all = await getMatterDeliverables(input.matterId, member.firmId);
  const q = sanitize(input.query || '').toLowerCase();
  let rows = q ? all.filter((d) => d.name.toLowerCase().includes(q)) : all;
  if (!input.includeArchived) rows = rows.filter((d) => d.status !== DELIVERABLE_STATUS.ARCHIVED);
  return { count: rows.length, deliverables: rows };
}

async function searchMatterContext(input: any, member: AssistantMember): Promise<any> {
  const readable = await readableMatterIds(member);
  if (input.matterId && !canReadMatter(readable, input.matterId)) {
    return { error: 'Matter not found. Use find_matter to get a valid matterId first.' };
  }
  const matches = (
    await searchEmbeddings(input.query, {
      matterId: input.matterId ?? null,
      limit: 12,
      threshold: 0.25,
      firmId: member.firmId,
    })
  ).filter((m) => !m.matter_id || canReadMatter(readable, m.matter_id));
  if (matches.length === 0) {
    return { results: [], note: 'No semantically relevant documents found.' };
  }
  return {
    results: matches.map((m, i) => ({
      n: i + 1,
      sourceType: m.source_type,
      matterId: m.matter_id,
      text: m.chunk_text.slice(0, 1200),
      similarity: Math.round(m.similarity * 100) / 100,
    })),
  };
}

const FILE_SELECT =
  'notion_id, name, matter_id, matter_name, origin, file_urls, date_sent_filed, date_received, document_date';

/* eslint-disable @typescript-eslint/no-explicit-any */
interface FileCandidate {
  ref: string; // opaque token to re-fetch this exact attachment on a follow-up call
  name: string;
  storageRef: string; // bare path, legacy storage URL, or http URL
  matter: string;
  origin: string;
  date: string | null;
}

function filesRowCandidates(row: any): FileCandidate[] {
  return (Array.isArray(row.file_urls) ? row.file_urls : [])
    .map((u: any, idx: number) => ({ u, idx }))
    .filter(({ u }: any) => u && typeof u.path === 'string' && u.path)
    .map(({ u, idx }: any) => ({
      ref: `f|${row.notion_id}|${idx}`,
      name: u.name || row.name || 'file',
      storageRef: u.path,
      matter: row.matter_name || '',
      origin: row.origin || 'File',
      date: row.date_sent_filed || row.date_received || row.document_date || null,
    }));
}

/**
 * Download an attachment to a Blob. Handles every shape we store:
 *   - bare storage path → 'files' bucket
 *   - /storage/v1/object/(public|sign)/<bucket>/<path> → that bucket (legacy
 *     deliverable_files rows live in 'deliverable-files')
 *   - any other http(s) URL → fetched directly
 */
export async function downloadAttachment(ref: string): Promise<Blob | null> {
  const svc = getSupabase(); // storage-only: raw client for the handle
  const m = ref.match(/\/storage\/v1\/object\/(?:public|sign)\/([^/]+)\/([^?]+)/);
  if (m) {
    const { data } = await svc.storage
      .from(decodeURIComponent(m[1]))
      .download(decodeURIComponent(m[2]));
    return data ?? null;
  }
  if (!ref.startsWith('http')) {
    const { data } = await svc.storage.from('files').download(ref);
    return data ?? null;
  }
  const res = await fetch(ref);
  return res.ok ? await res.blob() : null;
}

/** Resolve a stored attachment ref to a temporary signed download URL (web delivery). */
export async function signedUrlFor(ref: string): Promise<string | null> {
  const svc = getSupabase(); // storage-only: raw client for the handle
  const m = ref.match(/\/storage\/v1\/object\/(?:public|sign)\/([^/]+)\/([^?]+)/);
  if (m) {
    const { data } = await svc.storage
      .from(decodeURIComponent(m[1]))
      .createSignedUrl(decodeURIComponent(m[2]), 60 * 60);
    return data?.signedUrl ?? null;
  }
  if (!ref.startsWith('http')) {
    const { data } = await svc.storage.from('files').createSignedUrl(ref, 60 * 60);
    return data?.signedUrl ?? null;
  }
  return ref;
}

const DELIVERABLE_FILE_SELECT =
  'id, deliverable_id, file_name, version, action, file_url, created_at';

/** AND every significant token within one column — tolerant of word order and
 *  punctuation, like findMatter. Falls back to a raw substring for short queries
 *  that tokenize to nothing (e.g. a bare docket fragment). */
export function applyTokenMatch<T>(builder: T, column: string, raw: string): T {
  const tokens = searchTokens(raw);
  if (tokens.length === 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (builder as any).ilike(column, `%${raw}%`);
  }
  let q = builder;
  for (const t of tokens) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    q = (q as any).or(`${column}.ilike.%${t}%`);
  }
  return q;
}

async function gatherCandidates(input: any, member: AssistantMember): Promise<FileCandidate[]> {
  const svc = getServiceDbForFirm(member.firmId);
  const readable = await readableMatterIds(member);
  const query = sanitize(input.query || '');
  const matterId = input.matterId as string | undefined;
  const out: FileCandidate[] = [];

  // 1) files table — incoming, uploaded, and filed copies.
  let fq = svc.from('files').select(FILE_SELECT);
  if (matterId) fq = fq.eq('matter_id', matterId);
  if (query) fq = applyTokenMatch(fq, 'name', query);
  const { data: fileRows } = await fq
    .order('date_sent_filed', { ascending: false, nullsFirst: false })
    .limit(25);
  for (const row of fileRows ?? []) out.push(...filesRowCandidates(row));

  // 2) deliverable_files — drafts + filed versions. A file is reachable two ways:
  //    by the parent deliverable's name ("the MOA") OR by the file's own name
  //    (the displayed file_name, which is what a user echoes back to pick a
  //    version). Collect deliverable_files from both and dedupe by id.
  const dfById = new Map<number, any>();

  // 2a) via deliverables whose name matches the query.
  let dq = svc.from('deliverables').select('notion_id');
  if (matterId) dq = dq.eq('matter_id', matterId);
  if (query) dq = applyTokenMatch(dq, 'name', query);
  const { data: delRows } = await dq.limit(25);
  const delIds = (delRows ?? []).map((d: any) => d.notion_id);
  if (delIds.length > 0) {
    const { data } = await svc
      .from('deliverable_files')
      .select(DELIVERABLE_FILE_SELECT)
      .in('deliverable_id', delIds)
      .order('created_at', { ascending: false })
      .limit(40);
    for (const df of data ?? []) dfById.set(df.id, df);
  }

  // 2b) via the file's own name. Scope to the matter (when given) by restricting
  //     to that matter's deliverable_ids, since deliverable_files has no matter_id.
  if (query) {
    let scopeIds: string[] | null = null;
    if (matterId) {
      const { data: scoped } = await svc
        .from('deliverables')
        .select('notion_id')
        .eq('matter_id', matterId)
        .limit(500);
      scopeIds = (scoped ?? []).map((d: any) => d.notion_id);
    }
    if (!matterId || (scopeIds && scopeIds.length > 0)) {
      let dfq = applyTokenMatch(
        svc.from('deliverable_files').select(DELIVERABLE_FILE_SELECT),
        'file_name',
        query,
      );
      if (scopeIds) dfq = dfq.in('deliverable_id', scopeIds);
      const { data } = await dfq.order('created_at', { ascending: false }).limit(40);
      for (const df of data ?? []) dfById.set(df.id, df);
    }
  }

  const dfRows = [...dfById.values()].filter((df: any) => df.file_url);
  if (dfRows.length > 0) {
    const parentIds = [...new Set(dfRows.map((df: any) => df.deliverable_id))];
    const { data: parents } = await svc
      .from('deliverables')
      .select('notion_id, name, matter_id, matter_name')
      .in('notion_id', parentIds);
    // Deliverable copies are matter-gated in RLS; the files table is not.
    const parentById = new Map(
      (parents ?? [])
        .filter((p: any) => canReadMatter(readable, p.matter_id))
        .map((p: any) => [p.notion_id, p]),
    );
    for (const df of dfRows) {
      const del: any = parentById.get(df.deliverable_id);
      if (!del) continue;
      const label = del?.name || df.file_name || 'deliverable';
      const action = df.action ? ` ${df.action}` : '';
      out.push({
        ref: `d|${df.id}`,
        name: df.file_name || `${label}.docx`,
        storageRef: df.file_url,
        matter: del?.matter_name || '',
        origin: `${label} (v${df.version}${action})`,
        date: df.created_at || null,
      });
    }
  }
  return out;
}

async function resolveRef(ref: string, member: AssistantMember): Promise<FileCandidate | null> {
  const svc = getServiceDbForFirm(member.firmId);
  if (ref.startsWith('f|')) {
    const [, notionId, idxStr] = ref.split('|');
    const { data } = await svc.from('files').select(FILE_SELECT).eq('notion_id', notionId).limit(1);
    const row = (data ?? [])[0];
    if (!row) return null;
    const cands = filesRowCandidates(row);
    return cands[Number(idxStr)] ?? cands[0] ?? null;
  }
  if (ref.startsWith('d|')) {
    const { data } = await svc
      .from('deliverable_files')
      .select('id, deliverable_id, file_name, version, action, file_url, created_at')
      .eq('id', ref.slice(2))
      .limit(1);
    const df: any = (data ?? [])[0];
    if (!df?.file_url) return null;
    const { data: del } = await svc
      .from('deliverables')
      .select('name, matter_id, matter_name')
      .eq('notion_id', df.deliverable_id)
      .maybeSingle();
    if (!del || !canReadMatter(await readableMatterIds(member), del.matter_id)) return null;
    const label = del?.name || df.file_name || 'deliverable';
    return {
      ref,
      name: df.file_name || `${label}.docx`,
      storageRef: df.file_url,
      matter: del?.matter_name || '',
      origin: `${label} (v${df.version}${df.action ? ` ${df.action}` : ''})`,
      date: df.created_at || null,
    };
  }
  return null;
}

async function sendCandidate(cand: FileCandidate, ctx: ToolContext): Promise<any> {
  if (!ctx.deliverFile) return { error: 'No file-delivery channel is available here.' };
  if (ctx.notifyWorking) await ctx.notifyWorking();
  const caption = cand.matter ? `${cand.name} — ${cand.matter}` : cand.name;
  const res = await ctx.deliverFile({ storageRef: cand.storageRef, name: cand.name, caption });
  return res.ok
    ? { sent: cand.name, matter: cand.matter, url: res.url }
    : { error: res.error || `Could not deliver "${cand.name}".` };
}

async function fetchFile(input: any, ctx: ToolContext): Promise<any> {
  const refStr = input.ref ? String(input.ref) : '';
  if (refStr.startsWith('f|') || refStr.startsWith('d|')) {
    const cand = await resolveRef(refStr, ctx.member);
    if (!cand) return { error: 'That file reference is no longer valid — search again.' };
    return sendCandidate(cand, ctx);
  }

  // A non-opaque ref means a file name was passed where a ref was expected
  // (e.g. the user echoed back a displayed filename) — treat it as a query.
  const query = sanitize(input.query || '') || sanitize(refStr);
  if (!input.matterId && !query) {
    return { error: 'Give me a matter or a file name to look for.' };
  }

  const candidates = await gatherCandidates({ matterId: input.matterId, query }, ctx.member);
  if (candidates.length === 0) {
    return { error: 'No matching file with a downloadable copy was found.' };
  }
  if (candidates.length === 1) {
    return sendCandidate(candidates[0], ctx);
  }
  return {
    matches: candidates
      .slice(0, 12)
      .map((c) => ({ ref: c.ref, name: c.name, source: c.origin, matter: c.matter, date: c.date })),
    note: 'Multiple files matched. Ask the user which one, then call fetch_file again with that ref.',
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// ── Write handlers ───────────────────────────────────────────────────
//
// The assistant runs in-process on the server and the caller's identity is
// already established by their session. This project signs JWTs with
// an asymmetric key, so a hand-minted HS256 token cannot authenticate through
// the API routes' RLS gate — instead we write with the service-role client and
// enforce authorization here. authorizeMatter is a faithful port of the SQL
// has_matter_access(matter_id): privileged role, or the person is on the
// matter's team. The Notion side-effects the routes carry are vestigial
// (deprecated) and intentionally dropped.

const PRIVILEGED_ROLES = new Set([
  'partner',
  'admin',
  'super_user',
  'finance',
  'chief_liaison_officer',
  'liaison_officer',
]);

async function authorizeMatter(
  member: AssistantMember,
  matterId: string | null,
): Promise<{ ok: true; matterName: string; clientName: string } | { ok: false; error: string }> {
  if (!matterId) {
    // No matter to scope against — mirrors RLS, where only privileged roles pass.
    if (PRIVILEGED_ROLES.has(member.role)) return { ok: true, matterName: '', clientName: '' };
    return { ok: false, error: 'I need a matter to create this under — which matter is it for?' };
  }
  const { data: matter } = await getServiceDbForFirm(member.firmId)
    .from('matters')
    .select('name, client_name, team_person_ids')
    .eq('notion_id', matterId)
    .maybeSingle();
  if (!matter) return { ok: false, error: 'I could not find that matter — try naming it again.' };

  const onTeam =
    Array.isArray(matter.team_person_ids) && matter.team_person_ids.includes(member.personId);
  if (!PRIVILEGED_ROLES.has(member.role) && !onTeam) {
    return {
      ok: false,
      error: `You are not part of ${matter.name ?? 'that matter'}, so I cannot create this under it.`,
    };
  }
  return { ok: true, matterName: matter.name ?? '', clientName: matter.client_name ?? '' };
}

async function createDeliverable(input: any, ctx: ToolContext): Promise<any> {
  const matterId = input.matterId ?? null;
  const auth = await authorizeMatter(ctx.member, matterId);
  if (!auth.ok) return { error: auth.error };

  const drafterIds: string[] = input.drafterIds ?? [];
  const now = new Date().toISOString();
  const { data: created, error } = await getServiceDbForFirm(ctx.member.firmId)
    .from('deliverables')
    .insert({
      notion_id: mintId('deliverable'),
      notion_url: '',
      name: input.name,
      matter_id: matterId,
      matter_name: auth.matterName,
      client_name: auth.clientName,
      type: input.type,
      subtype: input.subtype ?? null,
      status: DELIVERABLE_STATUS.NOT_STARTED,
      drafter_ids: drafterIds,
      reviewer_ids: input.reviewerIds ?? [],
      review_dates: input.reviewDates ?? [],
      currently_with_ids: drafterIds,
      external_due_date: input.externalDueDate ?? null,
      priority: input.priority ?? '',
      date_done: null,
      revision_count: 0,
      parent_deliverable_id: null,
      related_hearing_id: null,
      created_time: now,
      notion_last_edited_at: now,
      synced_at: now,
    })
    .select('notion_id, name, matter_id, matter_name, status, drafter_ids, reviewer_ids')
    .single();
  if (error) return { error: error.message };

  return {
    ok: true,
    created: 'deliverable',
    deliverable: created,
    url: `${appBaseUrl()}/dashboard/deliverables/${created.notion_id}`,
  };
}

async function createTask(input: any, ctx: ToolContext): Promise<any> {
  const matterId = input.matterId ?? null;
  const auth = await authorizeMatter(ctx.member, matterId);
  if (!auth.ok) return { error: auth.error };

  const now = new Date().toISOString();
  const { data: created, error } = await getServiceDbForFirm(ctx.member.firmId)
    .from('tasks')
    .insert({
      notion_id: mintId('task'),
      notion_url: '',
      name: input.name,
      matter_id: matterId,
      matter_name: auth.matterName,
      due_date: input.dueDate ?? null,
      status: TASK_STATUS.NOT_STARTED,
      priority: input.priority ?? '',
      done: false,
      assignee_ids: input.assigneeIds ?? [],
      notes: '',
      created_time: now,
      notion_last_edited_at: now,
      synced_at: now,
    })
    .select('notion_id, name, matter_name, due_date, assignee_ids')
    .single();
  if (error) return { error: error.message };

  return {
    ok: true,
    created: 'task',
    task: created,
    url: `${appBaseUrl()}/dashboard/tasks/${created.notion_id}`,
  };
}

async function createMeeting(input: any, ctx: ToolContext): Promise<any> {
  const matterId = input.matterId ?? null;
  const auth = await authorizeMatter(ctx.member, matterId);
  if (!auth.ok) return { error: auth.error };

  const attendeeIds: string[] = input.attendeeIds ?? [];
  const now = new Date().toISOString();
  const tempId = mintId('meeting');
  const { data: created, error } = await getServiceDbForFirm(ctx.member.firmId)
    .from('meetings')
    .insert({
      notion_id: tempId,
      notion_url: '',
      name: input.name,
      date_start: toManilaInstant(input.date),
      date_end: null,
      matter_id: matterId,
      matter_name: auth.matterName,
      type: input.type,
      attendee_ids: attendeeIds,
      is_attended: false,
      location: '',
      duration: null,
      created_time: now,
      notion_last_edited_at: now,
      synced_at: now,
    })
    .select('notion_id, name, matter_name, date_start, type, attendee_ids')
    .single();
  if (error) return { error: error.message };

  if (attendeeIds.length > 0) {
    notifyAttendeesAddedToMeeting({
      meetingId: tempId,
      newAttendeeIds: attendeeIds,
      previousAttendeeIds: [],
      performedBy: ctx.member.personId,
      firmId: ctx.member.firmId,
    }).catch((err) => console.error('[bot] meeting notify failed:', (err as Error).message));
  }

  return {
    ok: true,
    created: 'meeting',
    meeting: created,
    url: `${appBaseUrl()}/dashboard/meetings/${created.notion_id}`,
  };
}

async function createHearing(input: any, ctx: ToolContext): Promise<any> {
  const matterId = input.matterId ?? null;
  const auth = await authorizeMatter(ctx.member, matterId);
  if (!auth.ok) return { error: auth.error };

  const attendeeIds: string[] = input.attendeeIds ?? [];
  const now = new Date().toISOString();
  const tempId = mintId('hearing');
  const { data: created, error } = await getServiceDbForFirm(ctx.member.firmId)
    .from('hearings')
    .insert({
      notion_id: tempId,
      notion_url: '',
      name: input.name,
      date: toManilaInstant(input.date),
      matter_id: matterId,
      matter_name: auth.matterName,
      type: input.type,
      status: 'Scheduled',
      attendee_ids: attendeeIds,
      is_attended: false,
      is_filed: false,
      created_time: now,
      notion_last_edited_at: now,
      synced_at: now,
    })
    .select('notion_id, name, matter_name, date, type, attendee_ids')
    .single();
  if (error) return { error: error.message };

  if (attendeeIds.length > 0) {
    notifyAttendeesAddedToHearing({
      hearingId: tempId,
      newAttendeeIds: attendeeIds,
      previousAttendeeIds: [],
      performedBy: ctx.member.personId,
      firmId: ctx.member.firmId,
    }).catch((err) => console.error('[bot] hearing notify failed:', (err as Error).message));
  }

  return {
    ok: true,
    created: 'hearing',
    hearing: created,
    url: `${appBaseUrl()}/dashboard/hearings/${created.notion_id}`,
  };
}

// ── Update handlers ──────────────────────────────────────────────────
//
// Amend an entity the operator can already reach. Same trust model as the
// create handlers: service-role write, gated by authorizeMatter. An update can
// move an entity to a different matter, so we authorize BOTH the entity's
// current matter (you must have access to what you're editing) and the target
// matter (you must have access to move it there), and re-denormalize the
// matter_name/client_name copies the app keeps on each row.

/** Resolve the matter portion of an update: authorize the current matter, and —
 *  if the caller is moving the entity — authorize the target and emit the
 *  denormalized matter columns. Returns {} when the matter is unchanged. */
async function matterUpdatePatch(
  member: AssistantMember,
  currentMatterId: string | null,
  input: any,
  includeClientName: boolean,
): Promise<{ ok: true; patch: Record<string, unknown> } | { ok: false; error: string }> {
  const currentAuth = await authorizeMatter(member, currentMatterId);
  if (!currentAuth.ok) return { ok: false, error: currentAuth.error };

  if (input.matterId === undefined) return { ok: true, patch: {} };
  const newMatterId: string | null = input.matterId ?? null;
  if (newMatterId === currentMatterId) return { ok: true, patch: {} };

  const newAuth = await authorizeMatter(member, newMatterId);
  if (!newAuth.ok) return { ok: false, error: newAuth.error };

  const patch: Record<string, unknown> = {
    matter_id: newMatterId,
    matter_name: newAuth.matterName,
  };
  if (includeClientName) patch.client_name = newAuth.clientName;
  return { ok: true, patch };
}

/** Non-matter field patch for a deliverable — provided fields only; an explicit
 *  empty array clears, undefined leaves the field untouched. Pure (testable). */
export function buildDeliverablePatch(input: any): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.type !== undefined) patch.type = input.type;
  if (input.subtype !== undefined) patch.subtype = input.subtype ?? null;
  if (input.status !== undefined) patch.status = input.status;
  if (input.priority !== undefined) patch.priority = input.priority ?? '';
  if (input.externalDueDate !== undefined) patch.external_due_date = input.externalDueDate ?? null;
  if (input.drafterIds !== undefined) patch.drafter_ids = input.drafterIds ?? [];
  if (input.reviewerIds !== undefined) patch.reviewer_ids = input.reviewerIds ?? [];
  if (input.reviewDates !== undefined) patch.review_dates = input.reviewDates ?? [];
  if (input.currentlyWithIds !== undefined) patch.currently_with_ids = input.currentlyWithIds ?? [];
  return patch;
}

/** Non-matter field patch for a task. `done` and `status` are coupled the same
 *  way the /api/task PATCH couples them: marking done sets status 'Done';
 *  an explicit status wins over the derived one. Pure (testable). */
export function buildTaskPatch(input: any): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.dueDate !== undefined) patch.due_date = input.dueDate ?? null;
  if (input.priority !== undefined) patch.priority = input.priority ?? '';
  if (input.assigneeIds !== undefined) patch.assignee_ids = input.assigneeIds ?? [];
  if (input.done !== undefined) {
    patch.done = input.done;
    patch.status = input.done ? 'Done' : 'In progress';
  }
  if (input.status !== undefined) patch.status = input.status;
  return patch;
}

/** Non-matter field patch for a meeting. Pure (testable). */
export function buildMeetingPatch(input: any): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.type !== undefined) patch.type = input.type;
  if (input.date !== undefined) patch.date_start = input.date ? toManilaInstant(input.date) : input.date;
  if (input.location !== undefined) patch.location = input.location ?? '';
  if (input.attendeeIds !== undefined) patch.attendee_ids = input.attendeeIds ?? [];
  return patch;
}

/** Non-matter field patch for a hearing. Pure (testable). */
export function buildHearingPatch(input: any): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.type !== undefined) patch.type = input.type;
  if (input.date !== undefined) patch.date = input.date ? toManilaInstant(input.date) : input.date;
  if (input.status !== undefined) patch.status = input.status;
  if (input.attendeeIds !== undefined) patch.attendee_ids = input.attendeeIds ?? [];
  return patch;
}

async function updateDeliverable(input: any, ctx: ToolContext): Promise<any> {
  const id = input.deliverableId;
  if (!id) return { error: 'Which deliverable? Give me the deliverableId (from find_entity or the one just created).' };
  const svc = getServiceDbForFirm(ctx.member.firmId);
  const { data: current, error: fetchErr } = await svc
    .from('deliverables')
    .select('notion_id, matter_id')
    .eq('notion_id', id)
    .maybeSingle();
  if (fetchErr) return { error: fetchErr.message };
  if (!current) return { error: 'I could not find that deliverable — search for it again.' };

  const mp = await matterUpdatePatch(ctx.member, current.matter_id ?? null, input, true);
  if (!mp.ok) return { error: mp.error };

  const patch = { ...mp.patch, ...buildDeliverablePatch(input) };
  if (Object.keys(patch).length === 0) {
    return { error: 'Nothing to change — tell me which field to update.' };
  }
  patch.notion_last_edited_at = new Date().toISOString();

  const { data: updated, error } = await svc
    .from('deliverables')
    .update(patch)
    .eq('notion_id', id)
    .select('notion_id, name, matter_name, status, type, external_due_date, drafter_ids, reviewer_ids')
    .single();
  if (error) return { error: error.message };

  return {
    ok: true,
    updated: 'deliverable',
    deliverable: updated,
    url: `${appBaseUrl()}/dashboard/deliverables/${id}`,
  };
}

async function updateTask(input: any, ctx: ToolContext): Promise<any> {
  const id = input.taskId;
  if (!id) return { error: 'Which task? Give me the taskId (from find_entity or the one just created).' };
  const svc = getServiceDbForFirm(ctx.member.firmId);
  const { data: current, error: fetchErr } = await svc
    .from('tasks')
    .select('notion_id, matter_id')
    .eq('notion_id', id)
    .maybeSingle();
  if (fetchErr) return { error: fetchErr.message };
  if (!current) return { error: 'I could not find that task — search for it again.' };

  const mp = await matterUpdatePatch(ctx.member, current.matter_id ?? null, input, false);
  if (!mp.ok) return { error: mp.error };

  const patch = { ...mp.patch, ...buildTaskPatch(input) };
  if (Object.keys(patch).length === 0) {
    return { error: 'Nothing to change — tell me which field to update.' };
  }
  patch.notion_last_edited_at = new Date().toISOString();

  const { data: updated, error } = await svc
    .from('tasks')
    .update(patch)
    .eq('notion_id', id)
    .select('notion_id, name, matter_name, due_date, status, done, assignee_ids')
    .single();
  if (error) return { error: error.message };

  return {
    ok: true,
    updated: 'task',
    task: updated,
    url: `${appBaseUrl()}/dashboard/tasks/${id}`,
  };
}

async function updateMeeting(input: any, ctx: ToolContext): Promise<any> {
  const id = input.meetingId;
  if (!id) return { error: 'Which meeting? Give me the meetingId (from find_entity or the one just created).' };
  const svc = getServiceDbForFirm(ctx.member.firmId);
  const { data: current, error: fetchErr } = await svc
    .from('meetings')
    .select('notion_id, matter_id, attendee_ids')
    .eq('notion_id', id)
    .maybeSingle();
  if (fetchErr) return { error: fetchErr.message };
  if (!current) return { error: 'I could not find that meeting — search for it again.' };

  const mp = await matterUpdatePatch(ctx.member, current.matter_id ?? null, input, false);
  if (!mp.ok) return { error: mp.error };

  const patch = { ...mp.patch, ...buildMeetingPatch(input) };
  if (Object.keys(patch).length === 0) {
    return { error: 'Nothing to change — tell me which field to update.' };
  }
  patch.notion_last_edited_at = new Date().toISOString();

  const { data: updated, error } = await svc
    .from('meetings')
    .update(patch)
    .eq('notion_id', id)
    .select('notion_id, name, matter_name, date_start, type, attendee_ids, location')
    .single();
  if (error) return { error: error.message };

  if (input.attendeeIds !== undefined) {
    notifyAttendeesAddedToMeeting({
      meetingId: id,
      newAttendeeIds: (updated.attendee_ids ?? []) as string[],
      previousAttendeeIds: (current.attendee_ids ?? []) as string[],
      performedBy: ctx.member.personId,
      firmId: ctx.member.firmId,
    }).catch((err) => console.error('[bot] meeting notify failed:', (err as Error).message));
  }

  return {
    ok: true,
    updated: 'meeting',
    meeting: updated,
    url: `${appBaseUrl()}/dashboard/meetings/${id}`,
  };
}

async function updateHearing(input: any, ctx: ToolContext): Promise<any> {
  const id = input.hearingId;
  if (!id) return { error: 'Which hearing? Give me the hearingId (from find_entity or the one just created).' };
  const svc = getServiceDbForFirm(ctx.member.firmId);
  const { data: current, error: fetchErr } = await svc
    .from('hearings')
    .select('notion_id, matter_id, attendee_ids')
    .eq('notion_id', id)
    .maybeSingle();
  if (fetchErr) return { error: fetchErr.message };
  if (!current) return { error: 'I could not find that hearing — search for it again.' };

  const mp = await matterUpdatePatch(ctx.member, current.matter_id ?? null, input, false);
  if (!mp.ok) return { error: mp.error };

  const patch = { ...mp.patch, ...buildHearingPatch(input) };
  if (Object.keys(patch).length === 0) {
    return { error: 'Nothing to change — tell me which field to update.' };
  }
  patch.notion_last_edited_at = new Date().toISOString();

  const { data: updated, error } = await svc
    .from('hearings')
    .update(patch)
    .eq('notion_id', id)
    .select('notion_id, name, matter_name, date, type, status, attendee_ids')
    .single();
  if (error) return { error: error.message };

  if (input.attendeeIds !== undefined) {
    notifyAttendeesAddedToHearing({
      hearingId: id,
      newAttendeeIds: (updated.attendee_ids ?? []) as string[],
      previousAttendeeIds: (current.attendee_ids ?? []) as string[],
      performedBy: ctx.member.personId,
      firmId: ctx.member.firmId,
    }).catch((err) => console.error('[bot] hearing notify failed:', (err as Error).message));
  }

  return {
    ok: true,
    updated: 'hearing',
    hearing: updated,
    url: `${appBaseUrl()}/dashboard/hearings/${id}`,
  };
}

// ── Entity lookup (resolve a name the user references into an id to amend) ──

const ENTITY_LOOKUP: Record<
  string,
  { table: string; select: string; dateCol: string; map: (r: any) => any }
> = {
  deliverable: {
    table: 'deliverables',
    select: 'notion_id, name, matter_name, status, type, external_due_date',
    dateCol: 'external_due_date',
    map: (r) => ({ id: r.notion_id, name: r.name, matter: r.matter_name, status: r.status, type: r.type, dueDate: r.external_due_date }),
  },
  task: {
    table: 'tasks',
    select: 'notion_id, name, matter_name, status, done, due_date',
    dateCol: 'due_date',
    map: (r) => ({ id: r.notion_id, name: r.name, matter: r.matter_name, status: r.status, done: r.done, dueDate: r.due_date }),
  },
  meeting: {
    table: 'meetings',
    select: 'notion_id, name, matter_name, type, date_start',
    dateCol: 'date_start',
    map: (r) => ({ id: r.notion_id, name: r.name, matter: r.matter_name, type: r.type, date: r.date_start }),
  },
  hearing: {
    table: 'hearings',
    select: 'notion_id, name, matter_name, type, status, date',
    dateCol: 'date',
    map: (r) => ({ id: r.notion_id, name: r.name, matter: r.matter_name, type: r.type, status: r.status, date: r.date }),
  },
};

async function findEntity(input: any, member: AssistantMember): Promise<any> {
  const cfg = ENTITY_LOOKUP[input.kind];
  if (!cfg) return { error: 'kind must be one of deliverable, task, meeting, hearing.' };
  const svc = getServiceDbForFirm(member.firmId);
  const readable = await readableMatterIds(member);
  const raw = sanitize(input.query || '');

  // All four kinds are gated by matter access in RLS.
  let q = svc.from(cfg.table).select(`${cfg.select}, matter_id`);
  if (input.matterId) q = q.eq('matter_id', input.matterId);
  if (raw) q = applyTokenMatch(q, 'name', raw);
  q = q.order(cfg.dateCol, { ascending: false, nullsFirst: false });
  const { data } = await q.limit(readable ? 60 : 8);

  // The select string is built per kind, so supabase-js cannot infer the row.
  const rows = ((data ?? []) as unknown as { matter_id: string | null }[])
    .filter((r) => canReadMatter(readable, r.matter_id))
    .slice(0, 8);
  return { kind: input.kind, matches: rows.map(cfg.map) };
}

// ── Legal research (juris.ph — public SC jurisprudence + RA index) ──────

const JURIS_DOWN = { error: 'juris.ph is unreachable right now — legal research is temporarily unavailable. Try again later.' };
const JURIS_CAVEAT =
  'Summaries are AI-generated from lawphil text. Verify against the linked full decision/act before citing in a filing.';

function clip(s: string | undefined | null, max: number): string | undefined {
  if (!s) return undefined;
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

async function searchJurisprudenceTool(input: any): Promise<any> {
  if (!input.query) return { error: 'Provide a query describing the facts, issue, or doctrine.' };
  const hits = await searchJurisprudence(input.query, {
    limit: Math.min(input.limit ?? 5, 8),
    year: input.year,
    caseType: input.caseType,
  });
  if (hits === null) return JURIS_DOWN;
  return {
    count: hits.length,
    results: hits.map((h) => ({
      id: h.id,
      case_number: h.case_number,
      case_title: clip(h.case_title, 200),
      decision_date: h.decision_date,
      division: h.division,
      facts: clip(h.facts, 500),
      disposition: clip(h.disposition, 300),
      tags: h.tags?.slice(0, 6),
      url: h.url,
    })),
    note: JURIS_CAVEAT,
  };
}

async function searchRepublicActsTool(input: any): Promise<any> {
  if (!input.query) return { error: 'Provide a query describing the subject matter or policy area.' };
  const hits = await searchRepublicActs(input.query, {
    limit: Math.min(input.limit ?? 5, 8),
    year: input.year,
  });
  if (hits === null) return JURIS_DOWN;
  return {
    count: hits.length,
    results: hits.map((h) => ({
      id: h.id,
      ra_number: h.ra_number,
      title: clip(h.title, 250),
      year: h.year,
      summary: clip(h.summary, 400),
      tags: h.tags?.slice(0, 6),
      url: h.url,
    })),
    note: JURIS_CAVEAT,
  };
}

async function getJurisCaseTool(input: any): Promise<any> {
  if (!input.id && !input.caseNumber) {
    return { error: 'Provide an id from search_jurisprudence or a caseNumber like "G.R. No. 254972".' };
  }
  const res = await getJurisCase({ id: input.id, caseNumber: input.caseNumber });
  if (res.status === 'unavailable') return JURIS_DOWN;
  if (res.status === 'not_found') {
    return { error: 'Case not found on juris.ph — the citation may be wrong, or the decision is not in its index.' };
  }
  const r = res.record;
  return {
    case_number: r.case_number,
    case_title: clip(r.case_title, 250),
    decision_date: r.decision_date_iso,
    division: r.division,
    ponente: r.ponente,
    en_banc: r.is_en_banc,
    facts: clip(r.factual_background, 1500),
    procedural_history: clip(r.procedural_history, 800),
    reasoning: clip(r.court_reasoning, 2000),
    disposition: clip(r.final_disposition, 600),
    legal_issues: r.legal_issues?.slice(0, 5),
    cited_gr_numbers: r.cited_gr_numbers?.slice(0, 10),
    cited_ra_numbers: r.cited_ra_numbers?.slice(0, 10),
    url: r.url,
    note: JURIS_CAVEAT,
  };
}

async function getRepublicActTool(input: any): Promise<any> {
  if (!input.id && !input.raNumber) {
    return { error: 'Provide an id from search_republic_acts or an raNumber like "RA 11313".' };
  }
  const res = await getRepublicAct({ id: input.id, raNumber: input.raNumber });
  if (res.status === 'unavailable') return JURIS_DOWN;
  if (res.status === 'not_found') {
    return { error: 'Republic Act not found on juris.ph — check the number.' };
  }
  const r = res.record;
  return {
    title: clip(r.title, 300),
    year: r.year,
    summary: clip(r.summary, 1000),
    key_provisions: Array.isArray(r.key_provisions)
      ? r.key_provisions.slice(0, 10).map((p) => clip(typeof p === 'string' ? p : JSON.stringify(p), 300))
      : undefined,
    tags: r.tags?.slice(0, 8),
    url: r.url,
    pdf_url: r.pdf_url,
    note: JURIS_CAVEAT,
  };
}

// ── Dispatch ─────────────────────────────────────────────────────────

/**
 * The tools that change firm data, and where their result carries the row.
 * Every entry gets an audit trail entry attributed to the agent — see
 * auditWrite below. Adding a write tool without adding it here means its
 * work lands in the firm's data with no record of who made it.
 */
const WRITE_TOOLS: Record<string, { entityType: string; action: string; resultKey: string }> = {
  create_deliverable: { entityType: 'Deliverable', action: 'created', resultKey: 'deliverable' },
  create_task: { entityType: 'Task', action: 'created', resultKey: 'task' },
  create_meeting: { entityType: 'Meeting', action: 'created', resultKey: 'meeting' },
  create_hearing: { entityType: 'Hearing', action: 'created', resultKey: 'hearing' },
  update_deliverable: { entityType: 'Deliverable', action: 'updated', resultKey: 'deliverable' },
  update_task: { entityType: 'Task', action: 'updated', resultKey: 'task' },
  update_meeting: { entityType: 'Meeting', action: 'updated', resultKey: 'meeting' },
  update_hearing: { entityType: 'Hearing', action: 'updated', resultKey: 'hearing' },
};

/**
 * Record an assistant write in the audit log as the agent's action, taken on
 * a person's instruction. The person approved it in the conversation, but the
 * agent is what touched the row — and a supervisor reviewing the trail needs
 * to be able to tell those apart.
 */
function auditWrite(name: string, ctx: ToolContext, result: unknown): void {
  const spec = WRITE_TOOLS[name];
  if (!spec) return;

  const res = result as Record<string, unknown> | null;
  if (!res || res.ok !== true) return;

  const row = res[spec.resultKey] as { notion_id?: string; name?: string } | undefined;
  logAgentAudit({
    firmId: ctx.member.firmId,
    entityType: spec.entityType,
    entityId: row?.notion_id,
    entityName: row?.name,
    action: spec.action,
    agentId: AGENT_IDS.assistant,
    onBehalfOf: ctx.member.personId,
  });
}

export async function executeTool(name: string, input: any, ctx: ToolContext): Promise<any> {
  try {
    const result = await dispatchTool(name, input, ctx);
    auditWrite(name, ctx, result);
    return result;
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Tool execution failed' };
  }
}

async function dispatchTool(name: string, input: unknown, ctx: ToolContext): Promise<unknown> {
  switch (name) {
    case 'find_matter':
      return await findMatter(input, ctx.member);
    case 'find_person':
      return await findPerson(input, ctx.member.firmId);
    case 'get_schedule':
      return await getSchedule(input, ctx);
    case 'get_matter':
      return await getMatter(input, ctx.member);
    case 'get_deliverables':
      return await getDeliverables(input, ctx.member);
    case 'search_matter_context':
      return await searchMatterContext(input, ctx.member);
    case 'fetch_file':
      return await fetchFile(input, ctx);
    case 'create_deliverable':
      return await createDeliverable(input, ctx);
    case 'create_task':
      return await createTask(input, ctx);
    case 'create_meeting':
      return await createMeeting(input, ctx);
    case 'create_hearing':
      return await createHearing(input, ctx);
    case 'find_entity':
      return await findEntity(input, ctx.member);
    case 'update_deliverable':
      return await updateDeliverable(input, ctx);
    case 'update_task':
      return await updateTask(input, ctx);
    case 'update_meeting':
      return await updateMeeting(input, ctx);
    case 'update_hearing':
      return await updateHearing(input, ctx);
    case 'search_jurisprudence':
      return await searchJurisprudenceTool(input);
    case 'search_republic_acts':
      return await searchRepublicActsTool(input);
    case 'get_case':
      return await getJurisCaseTool(input);
    case 'get_republic_act':
      return await getRepublicActTool(input);
    default:
      return { error: `Unknown tool: ${name}` };
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// ── Tool schemas (Anthropic) ─────────────────────────────────────────

export const TOOLS: Anthropic.Tool[] = [
  {
    name: 'find_matter',
    description:
      "Search the firm's matters by name, matter code, client name, case title, or case number. Matches on individual words, so partial or reordered queries work (e.g. 'People v Monge', 'Monge estafa', a docket number). ALWAYS call this to resolve a matter the user names in words into a matterId before creating an entity on it or fetching its details. Returns up to 8 candidates; if more than one is plausible, ask the user which.",
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Matter name, code, or client name fragment.' } },
      required: ['query'],
    },
  },
  {
    name: 'find_person',
    description:
      'Search active team members by name, nickname, or initials. Tolerant of extra middle names and word order. Use to resolve drafters, reviewers, assignees, or attendees named by the user into personIds before creating an entity.',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Person name, nickname, or initials.' } },
      required: ['query'],
    },
  },
  {
    name: 'get_schedule',
    description:
      "Get the firm's hearings, meetings, deliverable deadlines, and task due dates over a date range. Use for questions like \"what's due today\", \"how does my week look\", \"any hearings next week\". Default scope is 'mine' (items the user is involved in); use 'firm' for the whole firm. Provide either a preset or an explicit start/end (YYYY-MM-DD).",
    input_schema: {
      type: 'object',
      properties: {
        preset: {
          type: 'string',
          enum: ['today', 'tomorrow', 'this_week', 'next_week', 'this_month'],
          description: 'Convenience range. Ignored if start and end are given.',
        },
        start: { type: 'string', description: 'Range start, YYYY-MM-DD (Manila).' },
        end: { type: 'string', description: 'Range end, YYYY-MM-DD (Manila).' },
        scope: { type: 'string', enum: ['mine', 'firm'], description: "Default 'mine'." },
      },
    },
  },
  {
    name: 'get_matter',
    description:
      'Get the maintained intelligence brief for a matter: metadata, narrative summary, posture, parties, key dates, open issues, and the executive overview. Pass a matterId from find_matter. Mention the brief\'s generated_at date if asked for "current" status, since briefs can lag.',
    input_schema: {
      type: 'object',
      properties: { matterId: { type: 'string', description: 'Matter notion_id from find_matter.' } },
      required: ['matterId'],
    },
  },
  {
    name: 'get_deliverables',
    description:
      "Get the LIVE, current status of a matter's deliverables — the source of truth for status, progress, who holds it, internal review dates, external due dates, and when each went out. ALWAYS use this (not the brief) to answer status/deadline/progress questions. Pass a matterId from find_matter; optional query filters by deliverable name. Returns each deliverable's status and an isOut flag (true = already filed/sent, i.e. done, not pending).",
    input_schema: {
      type: 'object',
      properties: {
        matterId: { type: 'string', description: 'Matter notion_id from find_matter.' },
        query: { type: 'string', description: 'Optional filter on deliverable name.' },
        includeArchived: { type: 'boolean', description: 'Include archived deliverables (default false).' },
      },
      required: ['matterId'],
    },
  },
  {
    name: 'search_matter_context',
    description:
      "Semantic search across the firm's documents, filings, file analyses, and matter briefs to answer specific factual questions grounded in source material. Pass a matterId to scope to one matter, or omit it to search firm-wide. Use this for substantive questions about a matter's contents that get_matter doesn't directly answer.",
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The factual question or topic to retrieve context for.' },
        matterId: { type: 'string', description: 'Optional matter notion_id to scope the search.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'fetch_file',
    description:
      "Find a document and send it to the user directly in this chat. Searches both uploaded/received files and deliverable copies (drafts and filed versions). Provide a matterId (from find_matter) and/or a query matching the file or deliverable name. If several match, you'll get a list with a `ref` for each — ask the user which one, then call again with that exact `ref` (don't re-pass the file name as the query). On success the file is delivered into the chat; confirm briefly what you sent.",
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Text to match against the file or deliverable name.' },
        matterId: { type: 'string', description: 'Matter notion_id to scope the search.' },
        ref: { type: 'string', description: 'Exact file reference to send, from a prior fetch_file matches list.' },
      },
    },
  },
  {
    name: 'create_deliverable',
    description:
      'Create a deliverable. Requires name and type. Resolve matterId via find_matter and any drafter/reviewer personIds via find_person first. Ask the user for anything required that is missing before calling.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        type: { type: 'string', description: 'Deliverable type, e.g. "Pleading", "Letter", "Memo".' },
        subtype: {
          type: 'string',
          description:
            'Optional pleading subtype, e.g. Judicial Affidavit, Complaint, Answer, Motion, Position Paper, Memorandum, Petition, Demand Letter, Contract/Agreement, Notice, Compliance, Other.',
        },
        matterId: { type: 'string' },
        priority: { type: 'string', description: 'e.g. Low, Medium, High.' },
        externalDueDate: { type: 'string', description: 'YYYY-MM-DD.' },
        drafterIds: { type: 'array', items: { type: 'string' }, description: 'personIds.' },
        reviewerIds: { type: 'array', items: { type: 'string' }, description: 'personIds, in review order.' },
        reviewDates: { type: 'array', items: { type: 'string' }, description: 'YYYY-MM-DD per reviewer.' },
      },
      required: ['name', 'type'],
    },
  },
  {
    name: 'create_task',
    description:
      'Create a task. Requires name. Resolve matterId via find_matter and assignee personIds via find_person first if the user named them.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        matterId: { type: 'string' },
        dueDate: { type: 'string', description: 'YYYY-MM-DD.' },
        priority: { type: 'string', description: 'e.g. Low, Medium, High.' },
        assigneeIds: { type: 'array', items: { type: 'string' }, description: 'personIds.' },
      },
      required: ['name'],
    },
  },
  {
    name: 'create_meeting',
    description:
      'Create a meeting. Requires name, type, and date (an ISO timestamp, e.g. 2026-07-02T14:00:00+08:00, in Manila time). Resolve matterId and attendee personIds first if named.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        type: { type: 'string', description: 'e.g. Client Meeting, Internal, Call.' },
        date: { type: 'string', description: 'ISO timestamp with +08:00 offset.' },
        matterId: { type: 'string' },
        attendeeIds: { type: 'array', items: { type: 'string' }, description: 'personIds.' },
      },
      required: ['name', 'type', 'date'],
    },
  },
  {
    name: 'create_hearing',
    description:
      'Create a court hearing. Requires name, type, and date (an ISO timestamp with +08:00 offset, Manila time). Resolve matterId and attendee personIds first if named.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        type: { type: 'string', description: 'e.g. Pre-Trial, Trial, Motion Hearing, Arraignment.' },
        date: { type: 'string', description: 'ISO timestamp with +08:00 offset.' },
        matterId: { type: 'string' },
        attendeeIds: { type: 'array', items: { type: 'string' }, description: 'personIds.' },
      },
      required: ['name', 'type', 'date'],
    },
  },
  {
    name: 'find_entity',
    description:
      "Resolve an existing deliverable, task, meeting, or hearing the user names into an id so you can amend it. Use this before an update_* tool when you don't already have the id (e.g. the item wasn't created earlier in this same chat). Give the kind and a name fragment; optionally scope with a matterId from find_matter. Returns up to 8 matches, each with an `id` — if more than one is plausible, ask the user which. (When you just created the item in this conversation, reuse the id the create tool returned instead of searching.)",
    input_schema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['deliverable', 'task', 'meeting', 'hearing'], description: 'Which kind of entity to search.' },
        query: { type: 'string', description: 'Name fragment; matches on individual words.' },
        matterId: { type: 'string', description: 'Optional matter notion_id to scope the search.' },
      },
      required: ['kind'],
    },
  },
  {
    name: 'update_deliverable',
    description:
      "Amend an existing deliverable. Pass its deliverableId (the notion_id returned by create_deliverable or find_entity) plus ONLY the fields you are changing — omitted fields are left as they are. Resolve a new matterId via find_matter and any person changes via find_person first. As with creating, show the user a review of the change and get approval before calling.",
    input_schema: {
      type: 'object',
      properties: {
        deliverableId: { type: 'string', description: 'The deliverable notion_id to amend.' },
        name: { type: 'string' },
        type: { type: 'string' },
        subtype: { type: 'string' },
        status: { type: 'string', description: 'e.g. Not started, In progress, For review, Filed or Sent out.' },
        matterId: { type: 'string', description: 'Move the deliverable to this matter (notion_id from find_matter).' },
        priority: { type: 'string' },
        externalDueDate: { type: 'string', description: 'YYYY-MM-DD.' },
        drafterIds: { type: 'array', items: { type: 'string' }, description: 'personIds — replaces the drafter list.' },
        reviewerIds: { type: 'array', items: { type: 'string' }, description: 'personIds in review order — replaces the reviewer list.' },
        reviewDates: { type: 'array', items: { type: 'string' }, description: 'YYYY-MM-DD per reviewer.' },
        currentlyWithIds: { type: 'array', items: { type: 'string' }, description: 'personIds who currently hold it.' },
      },
      required: ['deliverableId'],
    },
  },
  {
    name: 'update_task',
    description:
      "Amend an existing task. Pass its taskId (from create_task or find_entity) plus ONLY the fields you are changing. Set done=true to mark it complete (or done=false to reopen). Resolve a new matterId or assignee personIds first. Show the change for approval before calling.",
    input_schema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'The task notion_id to amend.' },
        name: { type: 'string' },
        matterId: { type: 'string', description: 'Move the task to this matter (notion_id from find_matter).' },
        dueDate: { type: 'string', description: 'YYYY-MM-DD.' },
        priority: { type: 'string' },
        status: { type: 'string' },
        done: { type: 'boolean', description: 'true = mark complete, false = reopen.' },
        assigneeIds: { type: 'array', items: { type: 'string' }, description: 'personIds — replaces the assignee list.' },
      },
      required: ['taskId'],
    },
  },
  {
    name: 'update_meeting',
    description:
      "Amend an existing meeting. Pass its meetingId (from create_meeting or find_entity) plus ONLY the fields you are changing. date is an ISO timestamp with +08:00 offset (Manila). Resolve a new matterId or attendee personIds first. Show the change for approval before calling. Newly added attendees are notified.",
    input_schema: {
      type: 'object',
      properties: {
        meetingId: { type: 'string', description: 'The meeting notion_id to amend.' },
        name: { type: 'string' },
        type: { type: 'string', description: 'e.g. Client Meeting, Internal, Call.' },
        date: { type: 'string', description: 'ISO timestamp with +08:00 offset.' },
        matterId: { type: 'string', description: 'Move the meeting to this matter (notion_id from find_matter).' },
        location: { type: 'string' },
        attendeeIds: { type: 'array', items: { type: 'string' }, description: 'personIds — replaces the attendee list.' },
      },
      required: ['meetingId'],
    },
  },
  {
    name: 'update_hearing',
    description:
      "Amend an existing court hearing. Pass its hearingId (from create_hearing or find_entity) plus ONLY the fields you are changing. date is an ISO timestamp with +08:00 offset (Manila). Resolve a new matterId or attendee personIds first. Show the change for approval before calling. Newly added attendees are notified.",
    input_schema: {
      type: 'object',
      properties: {
        hearingId: { type: 'string', description: 'The hearing notion_id to amend.' },
        name: { type: 'string' },
        type: { type: 'string', description: 'e.g. Pre-Trial, Trial, Motion Hearing, Arraignment.' },
        date: { type: 'string', description: 'ISO timestamp with +08:00 offset.' },
        matterId: { type: 'string', description: 'Move the hearing to this matter (notion_id from find_matter).' },
        status: { type: 'string', description: 'e.g. Scheduled, Held, Cancelled, Reset.' },
        attendeeIds: { type: 'array', items: { type: 'string' }, description: 'personIds — replaces the attendee list.' },
      },
      required: ['hearingId'],
    },
  },
  {
    name: 'search_jurisprudence',
    description:
      'Semantic search over Philippine Supreme Court decisions (juris.ph, sourced from lawphil). Use for legal research questions — "find cases on X", doctrine lookups, or finding authority for a position. Query by facts, issue, or doctrine in natural language, not just keywords. Returns case summaries with links; use get_case with a result id or case number for the full record. Summaries are AI-generated — always tell the user to verify against the full decision before citing in a filing.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Natural-language description of the legal question, facts, or doctrine.' },
        limit: { type: 'number', description: 'Max results, default 5, max 8.' },
        year: { type: 'number', description: 'Only decisions promulgated this year.' },
        caseType: { type: 'string', description: 'Filter, e.g. "Criminal", "Civil", "Labor", "Administrative".' },
      },
      required: ['query'],
    },
  },
  {
    name: 'search_republic_acts',
    description:
      'Semantic search over Philippine Republic Acts (juris.ph). Use for statute research — "what law covers X", finding the RA number for a named act, or checking what a statute penalizes. Returns summaries with links; use get_republic_act for the full record.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Subject matter or policy area in natural language.' },
        limit: { type: 'number', description: 'Max results, default 5, max 8.' },
        year: { type: 'number', description: 'Only acts enacted this year.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_case',
    description:
      'Fetch the full structured record of one Supreme Court decision from juris.ph: facts, procedural history, reasoning, disposition, issues, and cited authorities. Provide either an id from search_jurisprudence or a caseNumber like "G.R. No. 254972". Also useful to verify that a citation exists.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Document id from a search_jurisprudence result.' },
        caseNumber: { type: 'string', description: 'Official case number, e.g. "G.R. No. 254972".' },
      },
    },
  },
  {
    name: 'get_republic_act',
    description:
      'Fetch the full structured record of one Republic Act from juris.ph: summary, key provisions, and links. Provide either an id from search_republic_acts or an raNumber like "RA 11313".',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Document id from a search_republic_acts result.' },
        raNumber: { type: 'string', description: 'RA number, e.g. "RA 11313" or "11313".' },
      },
    },
  },
];
