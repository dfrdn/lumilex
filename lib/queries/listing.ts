import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { fetchAllRows, fetchAllRowsIn, IN_BATCH } from '@/lib/supabase-paginate';
import { normalizeDocumentType, deliverableTypeLabel } from '@/lib/document-type';
import { manilaDate, manilaDayEnd, manilaDayStart } from '@/lib/dates';
import { holdsUndated, type ListWindow } from '@/lib/calendar/views';
import { currentTeamIds, currentOnly, currentReviewers } from '@/lib/queries/people';
import { lifecycleOfficeActions } from '@/lib/trademarks/status-refresh';
import { MADRID_COLUMNS, madridFields } from '@/lib/trademark-row';
import type {
  TaskListing,
  MeetingListing,
  HearingListing,
  FilingListing,
  MatterListing,
  DeliverableListing,
  StatusReportListing,
  ClientListing,
  FileListing,
  TrademarkListing,
  TrademarkType,
  TrademarkStatus,
  DeliverableFileVersion,
} from '@/types/notion';

/**
 * Fetch all rows from a Supabase query, paginating past the 1000-row default.
 * The `build` callback receives a fresh `from(table).select(...)` and should
 * append any filters / ordering but NOT `.range()` or `.limit()`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchAll<T = any>(
  firmId: string,
  table: string,
  build: (q: any) => any,
  pageSize = 1000,
  selectCols = '*',
): Promise<T[]> {
  const supabase = getServiceDbForFirm(firmId);
  const all: T[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await build(
      supabase.from(table).select(selectCols),
    ).range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

/** Rows of `table` whose `column` (unique) is in `ids`, read in batches. */
function selectIn<T>(firmId: string, table: string, cols: string, column: string, ids: string[]): Promise<T[]> {
  const supabase = getServiceDbForFirm(firmId);
  return fetchAllRowsIn<T>(ids, (batch, from, to) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.from(table).select(cols).in(column, batch).order(column) as any).range(from, to),
  );
}

type MatterName = { notion_id: string; name: string | null; matter_code: string | null };

/** Every matter's display name and code — paged, so it holds past PostgREST's 1,000-row cap. */
function allMatterNames(firmId: string): Promise<MatterName[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return fetchAll<MatterName>(firmId, 'matters', (q: any) => q.order('notion_id'), 1000, 'notion_id, name, matter_code');
}

/** The columns the deliverable listings map (see the row mappers below). */
const DELIVERABLE_LISTING_COLS =
  'notion_id, notion_url, name, matter_id, matter_name, client_name, status, drafter_ids, reviewer_ids, ' +
  'review_dates, currently_with_ids, external_due_date, priority, type, created_time, notion_last_edited_at';

// ── Matters ───────────────────────────────────────────────────────

export async function getAllMatters(firmId: string): Promise<MatterListing[]> {
  const supabase = getServiceDbForFirm(firmId);

  // Fetch matters (select only needed columns) and team initials in parallel
  const [matters, lawyersRes] = await Promise.all([
    fetchAll(
      firmId,
      'matters',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (q: any) => q.order('name', { ascending: true }).order('notion_id'),
      1000,
      'notion_id, notion_url, name, matter_code, client_id, client_name, related_matter_ids, parent_matter_id, team_person_ids, type, status, last_activity_at',
    ),
    supabase.from('team').select('person_id, initials, name, avatar_url'),
  ]);

  if (lawyersRes.error) throw lawyersRes.error;

  // Build person_id → initials lookup
  const initialsMap = new Map<string, string>();
  const memberMap = new Map<string, { personId: string; initials: string; name: string; avatarUrl: string | null }>();
  for (const l of lawyersRes.data ?? []) {
    if (l.person_id) {
      initialsMap.set(l.person_id, l.initials || '??');
      memberMap.set(l.person_id, {
        personId: l.person_id,
        initials: l.initials || '??',
        name: l.name || '',
        avatarUrl: l.avatar_url ?? null,
      });
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return matters.map((row: any) => {
    const personIds: string[] = row.team_person_ids ?? [];
    return {
      id: row.notion_id,
      url: row.notion_url,
      name: row.name,
      matterCode: row.matter_code,
      clientId: row.client_id,
      clientName: row.client_name,
      relatedMatterIds: row.related_matter_ids ?? [],
      parentMatterId: row.parent_matter_id ?? null,
      teamPersonIds: personIds,
      type: row.type ?? '',
      status: row.status ?? '',
      lastActivityAt: row.last_activity_at ?? null,
      teamInitials: personIds
        .map((pid) => initialsMap.get(pid))
        .filter((v): v is string => !!v),
      teamMembers: personIds
        .map((pid) => memberMap.get(pid))
        .filter((v): v is { personId: string; initials: string; name: string; avatarUrl: string | null } => !!v),
    };
  });
}

// ── Deliverables ──────────────────────────────────────────────────

export async function getAllDeliverables(
  firmId: string,
  opts: { excludeStatusReports?: boolean } = {},
): Promise<DeliverableListing[]> {

  // Fetch deliverables and matters in parallel — matters give us canonical
  // name + matter_code so we can normalize the display string (the Notion
  // rollup `matter_name` inconsistently bakes the code into the title).
  const [data, matters] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fetchAll(firmId, 'deliverables', (q: any) => {
      let b = q.not('status', 'in', pgInList(HANDED_OFF_STATUSES));
      if (opts.excludeStatusReports) b = b.neq('type', 'Status Report');
      return b.order('external_due_date', { ascending: true }).order('notion_id');
    }, 1000, DELIVERABLE_LISTING_COLS),
    allMatterNames(firmId),
  ]);

  const matterMap = new Map<string, { name: string; code: string | null }>();
  for (const m of matters) {
    if (m.notion_id) matterMap.set(m.notion_id, { name: m.name ?? '', code: m.matter_code ?? null });
  }

  // Strip a trailing " (code)" from a matter_name fallback so we don't
  // double-print the code when we re-append one.
  const stripTrailingCode = (s: string) => s.replace(/\s*\([\d-]+\)\s*$/, '').trim();

  const current = await currentTeamIds(firmId);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return data.map((row: any) => {
    const canonical = row.matter_id ? matterMap.get(row.matter_id) : undefined;
    let matterDisplay: string;
    if (canonical) {
      matterDisplay = canonical.code
        ? `${stripTrailingCode(canonical.name)} (${canonical.code})`
        : stripTrailingCode(canonical.name);
    } else {
      // Fallback to the denormalized rollup as-is
      matterDisplay = row.matter_name ?? '';
    }

    return {
    id: row.notion_id,
    url: row.notion_url,
    name: row.name,
    matter: matterDisplay,
    matterId: row.matter_id ?? null,
    client: row.client_name,
    status: row.status,
    drafter: currentOnly(row.drafter_ids, current),
    ...currentReviewers(row.reviewer_ids, row.review_dates, current),
    currentlyWith: row.currently_with_ids ?? [],
    externalDueDate: row.external_due_date,
    priority: row.priority,
    type: row.type ?? '',
    createdTime: row.created_time ?? null,
    lastEditedAt: row.notion_last_edited_at ?? null,
    };
  });
}

// ── Internal Deliverables ─────────────────────────────────────────

/**
 * Fetch internal deliverables visible to a user — either as drafter or recipient.
 * Excludes archived items. "Filed or Sent out" rows are kept because that's the
 * "sent, awaiting acknowledgement" state for the internal flow.
 */
export async function getInternalDeliverablesForUser(firmId: string, userId: string): Promise<DeliverableListing[]> {

  const [data, matters] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fetchAll(firmId, 'deliverables', (q: any) =>
      q
        .eq('type', 'Internal')
        .neq('status', DELIVERABLE_STATUS.ARCHIVED)
        .or(`drafter_ids.cs.{${userId}},reviewer_ids.cs.{${userId}}`)
        .order('date_done', { ascending: false, nullsFirst: false })
        .order('notion_id'),
    1000, DELIVERABLE_LISTING_COLS),
    allMatterNames(firmId),
  ]);

  const matterMap = new Map<string, { name: string; code: string | null }>();
  for (const m of matters) {
    if (m.notion_id) matterMap.set(m.notion_id, { name: m.name ?? '', code: m.matter_code ?? null });
  }
  const stripTrailingCode = (s: string) => s.replace(/\s*\([\d-]+\)\s*$/, '').trim();

  const current = await currentTeamIds(firmId);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return data.map((row: any) => {
    const canonical = row.matter_id ? matterMap.get(row.matter_id) : undefined;
    const matterDisplay = canonical
      ? canonical.code
        ? `${stripTrailingCode(canonical.name)} (${canonical.code})`
        : stripTrailingCode(canonical.name)
      : row.matter_name ?? '';

    return {
      id: row.notion_id,
      url: row.notion_url,
      name: row.name,
      matter: matterDisplay,
      matterId: row.matter_id ?? null,
      client: row.client_name,
      status: row.status,
      drafter: currentOnly(row.drafter_ids, current),
      ...currentReviewers(row.reviewer_ids, row.review_dates, current),
      currentlyWith: row.currently_with_ids ?? [],
      externalDueDate: row.external_due_date,
      priority: row.priority,
      type: row.type ?? '',
      createdTime: row.created_time ?? null,
      lastEditedAt: row.notion_last_edited_at ?? null,
    };
  });
}

// ── Status Reports ────────────────────────────────────────────────

export async function getAllStatusReports(firmId: string): Promise<StatusReportListing[]> {

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = await fetchAll(firmId, 'deliverables', (q: any) =>
    q
      .eq('type', 'Status Report')
      .not('status', 'in', pgInList(CLOSED_STATUSES))
      .order('external_due_date', { ascending: true })
      .order('notion_id'),
    1000,
    `${DELIVERABLE_LISTING_COLS}, related_hearing_id, source_deliverable_id, source_file_id`,
  );

  const stripTrailingCode = (s: string) => s.replace(/\s*\([\d-]+\)\s*$/, '').trim();

  // Collect parent ids for batched lookup
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hearingIds = Array.from(new Set(data.map((r: any) => r.related_hearing_id).filter(Boolean))) as string[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sourceIds = Array.from(new Set(data.map((r: any) => r.source_deliverable_id).filter(Boolean))) as string[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fileIds = Array.from(new Set(data.map((r: any) => r.source_file_id).filter(Boolean))) as string[];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const matterIds = Array.from(new Set(data.map((r: any) => r.matter_id).filter(Boolean))) as string[];

  type Named = { notion_id: string; name: string };
  const [matters, hearings, sources, files] = await Promise.all([
    selectIn<MatterName>(firmId, 'matters', 'notion_id, name, matter_code', 'notion_id', matterIds),
    selectIn<Named>(firmId, 'hearings', 'notion_id, name', 'notion_id', hearingIds),
    selectIn<Named>(firmId, 'deliverables', 'notion_id, name', 'notion_id', sourceIds),
    selectIn<Named>(firmId, 'files', 'notion_id, name', 'notion_id', fileIds),
  ]);

  const matterMap = new Map<string, { name: string; code: string | null }>();
  for (const m of matters) {
    if (m.notion_id) matterMap.set(m.notion_id, { name: m.name ?? '', code: m.matter_code ?? null });
  }
  const hearingNameMap = new Map<string, string>(hearings.map((h) => [h.notion_id, h.name]));
  const sourceNameMap = new Map<string, string>(sources.map((d) => [d.notion_id, d.name]));
  const fileNameMap = new Map<string, string>(files.map((f) => [f.notion_id, f.name]));

  const current = await currentTeamIds(firmId);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return data.map((row: any) => {
    const canonical = row.matter_id ? matterMap.get(row.matter_id) : undefined;
    const matterDisplay = canonical
      ? (canonical.code
        ? `${stripTrailingCode(canonical.name)} (${canonical.code})`
        : stripTrailingCode(canonical.name))
      : (row.matter_name ?? '');

    let parentKind: 'hearing' | 'filing' | 'file' | null = null;
    let parentId: string | null = null;
    let parentName: string | null = null;
    if (row.related_hearing_id && hearingNameMap.has(row.related_hearing_id)) {
      parentKind = 'hearing';
      parentId = row.related_hearing_id;
      parentName = hearingNameMap.get(row.related_hearing_id) ?? null;
    } else if (row.source_deliverable_id && sourceNameMap.has(row.source_deliverable_id)) {
      parentKind = 'filing';
      parentId = row.source_deliverable_id;
      parentName = sourceNameMap.get(row.source_deliverable_id) ?? null;
    } else if (row.source_file_id && fileNameMap.has(row.source_file_id)) {
      parentKind = 'file';
      parentId = row.source_file_id;
      parentName = fileNameMap.get(row.source_file_id) ?? null;
    }

    return {
      id: row.notion_id,
      url: row.notion_url,
      name: row.name,
      matter: matterDisplay,
      matterId: row.matter_id ?? null,
      client: row.client_name,
      status: row.status,
      drafter: currentOnly(row.drafter_ids, current),
      ...currentReviewers(row.reviewer_ids, row.review_dates, current),
      currentlyWith: row.currently_with_ids ?? [],
      externalDueDate: row.external_due_date,
      priority: row.priority,
      type: row.type ?? '',
      createdTime: row.created_time ?? null,
      lastEditedAt: row.notion_last_edited_at ?? null,
      parentKind,
      parentId,
      parentName,
    };
  });
}

// ── Tasks ─────────────────────────────────────────────────────────

export async function getAllTasks(firmId: string): Promise<TaskListing[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = await fetchAll(firmId, 'tasks', (q: any) =>
    q.eq('done', false).neq('status', 'Done').order('due_date', { ascending: true }).order('notion_id'),
  1000, 'notion_id, notion_url, name, matter_name, due_date, status, priority, done, assignee_ids');

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return data.map((row: any) => ({
    id: row.notion_id,
    url: row.notion_url,
    name: row.name,
    matter: row.matter_name,
    dueDate: row.due_date,
    status: row.status,
    priority: row.priority,
    done: row.done,
    assigneeIds: row.assignee_ids ?? [],
  }));
}

// ── Meetings and hearings (Calendar's list tabs, read in a date window) ──

/** A window's bounds on a timestamptz column, as Manila days. Undated rows are kept while the window is open ahead (`holdsUndated`). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function inWindow(q: any, column: string, w: Pick<ListWindow, 'from' | 'to'>) {
  let out = q;
  if (w.from) {
    const start = manilaDayStart(w.from);
    out = holdsUndated(w) ? out.or(`${column}.gte."${start}",${column}.is.null`) : out.gte(column, start);
  }
  if (w.to) out = out.lte(column, manilaDayEnd(w.to));
  return out;
}

export async function getMeetings(firmId: string, w: Pick<ListWindow, 'from' | 'to'>): Promise<MeetingListing[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = await fetchAll(firmId, 'meetings', (q: any) =>
    inWindow(q, 'date_start', w).order('date_start', { ascending: false }).order('notion_id'),
  1000, 'notion_id, notion_url, name, date_start, date_end, matter_name, matter_id, type, is_attended, attendee_ids');

  const current = await currentTeamIds(firmId);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return data.map((row: any) => ({
    id: row.notion_id,
    url: row.notion_url,
    name: row.name,
    date: row.date_start,
    endDate: row.date_end,
    matter: row.matter_name,
    matterId: row.matter_id ?? null,
    type: row.type,
    isAttended: row.is_attended,
    attendeeIds: currentOnly(row.attendee_ids, current),
  }));
}

export async function getHearings(firmId: string, w: Pick<ListWindow, 'from' | 'to'>): Promise<HearingListing[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = await fetchAll(firmId, 'hearings', (q: any) =>
    inWindow(q, 'date', w).order('date', { ascending: false }).order('notion_id'),
  1000, 'notion_id, notion_url, name, date, matter_name, matter_id, type, status, is_attended, attendee_ids');

  const current = await currentTeamIds(firmId);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return data.map((row: any) => ({
    id: row.notion_id,
    url: row.notion_url,
    name: row.name,
    date: row.date,
    matter: row.matter_name,
    matterId: row.matter_id ?? null,
    type: row.type,
    status: row.status,
    isAttended: row.is_attended ?? false,
    attendeeIds: currentOnly(row.attendee_ids, current),
  }));
}

// ── Filings (deliverables belonging to case matters with a deadline) ──

export async function getAllFilings(firmId: string): Promise<FilingListing[]> {

  // Get matter IDs with case info
  const caseMatterIds = (
    await fetchAll<{ notion_id: string }>(
      firmId,
      'matters',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (q: any) => q.or('case_title.neq.,case_number.neq.,court.neq.').order('notion_id'),
      1000,
      'notion_id',
    )
  ).map((m) => m.notion_id);
  if (caseMatterIds.length === 0) return [];

  const supabase = getServiceDbForFirm(firmId);
  const data = (
    await fetchAllRowsIn(caseMatterIds, (batch, from, to) =>
      supabase
        .from('deliverables')
        .select('notion_id, notion_url, name, external_due_date, matter_name, matter_id, status, currently_with_ids')
        .not('external_due_date', 'is', null)
        .in('matter_id', batch)
        .order('notion_id')
        .range(from, to),
    )
  )
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .sort((a: any, b: any) => String(b.external_due_date).localeCompare(String(a.external_due_date)));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const filings = data.map((row: any) => ({
    id: row.notion_id as string,
    url: row.notion_url as string,
    name: row.name as string,
    date: row.external_due_date as string | null,
    matter: row.matter_name as string,
    matterId: (row.matter_id ?? null) as string | null,
    status: row.status as string,
    attendeeIds: (row.currently_with_ids ?? []) as string[],
  }));

  // Attach filed copies (deliverable_files rows tagged 'Filed version%')
  const filedByDeliverable = await getFiledCopiesByDeliverableIds(firmId, filings.map((f) => f.id));
  return filings.map((f) => ({ ...f, filedCopies: filedByDeliverable.get(f.id) ?? [] }));
}

/**
 * Batch-load the "Filed version" deliverable_files rows for a list of
 * deliverable IDs. Returns a Map of deliverableId → filed file versions
 * with signed URLs ready for download/preview.
 */
export async function getFiledCopiesByDeliverableIds(firmId: string, 
  deliverableIds: string[],
): Promise<Map<string, DeliverableFileVersion[]>> {
  const result = new Map<string, DeliverableFileVersion[]>();
  if (deliverableIds.length === 0) return result;

  const { resolveDeliverableUrls } = await import('./detail');
  const supabase = getServiceDbForFirm(firmId);

  // PostgREST passes .in() values as URL query params, which caps out around
  // a few kilobytes. With 1k+ filing IDs (~36 chars each) the URL would
  // exceed the limit and the request would silently fail. Chunk it.
  const chunks: string[][] = [];
  for (let i = 0; i < deliverableIds.length; i += IN_BATCH) chunks.push(deliverableIds.slice(i, i + IN_BATCH));
  const results = await Promise.all(
    chunks.map((chunk) =>
      supabase
        .from('deliverable_files')
        .select('id, deliverable_id, version, file_name, file_url, file_size, needs_reupload, uploaded_by, action, created_at')
        .in('deliverable_id', chunk)
        .ilike('action', 'Filed version%')
        .order('created_at', { ascending: false }),
    ),
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allRows: any[] = results.flatMap(({ data, error }) => (error || !data ? [] : data));

  const rows = allRows.map((row) => ({
    id: row.id as number,
    deliverableId: row.deliverable_id as string,
    version: row.version as number,
    fileName: row.file_name as string,
    fileUrl: row.file_url as string,
    fileSize: row.file_size as number | null,
    needsReupload: (row.needs_reupload ?? false) as boolean,
    uploadedBy: row.uploaded_by as string,
    action: row.action as string | null,
    createdAt: row.created_at as string,
  }));

  const signed = await resolveDeliverableUrls(rows);

  for (const row of signed) {
    const { deliverableId, ...version } = row;
    const arr = result.get(deliverableId) ?? [];
    arr.push(version);
    result.set(deliverableId, arr);
  }
  return result;
}

// ── Clients ───────────────────────────────────────────────────────

export async function getAllClients(firmId: string): Promise<ClientListing[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = await fetchAll(firmId, 'clients', (q: any) =>
    q.order('name', { ascending: true }).order('notion_id'),
  1000,
  'notion_id, notion_url, name, client_code, status, full_company_name, tin, contact_email, phone_number, ' +
  'point_persons, discount, receivables, priority, relationship_partner_id, created_time');

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return data.map((row: any) => ({
    id: row.notion_id,
    url: row.notion_url,
    name: row.name,
    clientCode: row.client_code ?? '',
    status: row.status ?? '',
    fullCompanyName: row.full_company_name ?? '',
    tin: row.tin ?? '',
    contactEmail: row.contact_email ?? '',
    phoneNumber: row.phone_number ?? '',
    pointPersons: row.point_persons ?? '',
    discount: row.discount ?? null,
    receivables: row.receivables ?? null,
    priority: row.priority ?? false,
    relationshipPartnerId: row.relationship_partner_id ?? null,
    createdTime: row.created_time ?? null,
  }));
}

// ── Files ─────────────────────────────────────────────────────────

export async function getAllFiles(firmId: string): Promise<FileListing[]> {
  const SELECT_COLS =
    'notion_id, name, matter_name, matter_id, origin, action_taken, date_received, document_date, is_court_record, created_time, file_urls';

  const [data, analyses] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fetchAll(firmId, 'files', (q: any) => q.order('created_time', { ascending: false }), 1000, SELECT_COLS),
    // The analysis records a free-text document type; the listing shows the
    // normalized one. A file can carry several analysis rows (retries), so
    // the first completed one with a type wins.
    fetchAll<{ file_id: string; document_type: string | null }>(
      firmId,
      'file_analyses',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (q: any) => q.eq('status', 'completed').not('file_id', 'is', null).order('id', { ascending: true }),
      1000,
      'file_id, document_type:entities->>documentType',
    ),
  ]);

  const typeByFile = new Map<string, string>();
  for (const a of analyses) {
    if (typeByFile.has(a.file_id)) continue;
    const t = normalizeDocumentType(a.document_type);
    if (t) typeByFile.set(a.file_id, t);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return data.map((row: any) => ({
    id: row.notion_id,
    url: '',
    name: row.name,
    matter: row.matter_name,
    matterId: row.matter_id,
    personsReadIds: [],
    origin: row.origin ?? '',
    actionTaken: row.action_taken ?? '',
    dateReceived: row.date_received,
    documentDate: row.document_date,
    isCourtRecord: row.is_court_record === true,
    documentType: typeByFile.get(row.notion_id) ?? null,
    createdTime: row.created_time,
    // Signed URLs are generated on-demand by FilePreviewModal via /api/file-sign
    fileUrls: typeof row.file_urls === 'string' ? JSON.parse(row.file_urls) : (row.file_urls ?? []),
  }));
}

// ── Trademark deadline dashboard ──────────────────────────────────

import {
  allDeadlinesForDashboard,
  type DashboardDeadline,
  type DashboardTrademarkInput,
  type ClientReportRow,
  type DeadlineKind,
} from '@/lib/trademark-deadlines';
import { CLOSED_STATUSES, HANDED_OFF_STATUSES, DELIVERABLE_STATUS } from '@/lib/deliverable-status';
import { pgInList } from '@/lib/postgrest';

/** How far ahead the deadline dashboard looks. Overdue deadlines are always in. */
export const DEADLINE_HORIZON_DAYS = 365;

/**
 * The marks with a deadline overdue or due within DEADLINE_HORIZON_DAYS —
 * found in the stored status (subject_status_items), not by reading every
 * mark — with their client-report history, expanded into the dashboard's
 * flat list.
 */
export async function getDeadlineDashboard(firmId: string): Promise<DashboardDeadline[]> {
  const supabase = getServiceDbForFirm(firmId);
  const horizon = manilaDate(DEADLINE_HORIZON_DAYS);

  const due = await fetchAllRows((from, to) =>
    supabase
      .from('subject_status_items')
      .select('subject_id, subject:subjects!inner(type)')
      .eq('subject.type', 'trademark')
      .lte('due_date', horizon)
      .order('subject_id')
      .order('item_key')
      .range(from, to),
  );
  const ids = [...new Set((due as { subject_id: string }[]).map((r) => r.subject_id))];

  const tmRows: unknown[] = [];
  const repRows: unknown[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100);
    const [tm, rep] = await Promise.all([
      supabase
        .from('trademarks')
        .select(
          'id, mark, type, classes, status, matter_id, matter_name, client_id, client_name, ' +
          'client_code, client_index, country, contact_email, mark_image_path, reg_ir_no, ' +
          `${MADRID_COLUMNS}, ` +
          'filing_date, noi_date, noi_payment_date, issuance_notice_date, issuance_fee_paid_date, ' +
          'reg_date, dau_3_filing_date, dau_3_motex, dau_3_motex_decision, dau_5_filing_date, renewal_filing_date, ' +
          'renewal_dau_filed_date, renewal_dau_5_filed_date, ' +
          'abandonment_mailing_date, revival_filed_date, revival_declined, ' +
          'trademark_office_actions(id, kind, mailing_date, respond_by, motex, motex_decision, response_filed_date)',
        )
        // An abandoned mark is here only for an open revival; the stored status put it in.
        .in('id', batch),
      supabase
        .from('trademark_client_reports')
        .select('id, trademark_id, deadline_kind, deadline_due, sent_at, sent_by, recipient_email')
        .not('deadline_kind', 'is', null)
        .in('trademark_id', batch)
        .order('sent_at', { ascending: false }),
    ]);
    tmRows.push(...(tm.data ?? []));
    repRows.push(...(rep.data ?? []));
  }
  const tmRes = { data: tmRows };
  const repRes = { data: repRows };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const trademarks: DashboardTrademarkInput[] = (tmRes.data ?? []).map((row: any) => ({
    id: row.id,
    mark: row.mark ?? '',
    type: row.type ?? null,
    classes: row.classes ?? [],
    status: row.status ?? 'Prelim',
    matterId: row.matter_id ?? null,
    matterName: row.matter_name ?? '',
    clientId: row.client_id ?? null,
    clientName: row.client_name ?? '',
    clientCode: row.client_code ?? null,
    clientIndex: row.client_index ?? 0,
    country: row.country ?? 'PH',
    contactEmail: row.contact_email ?? null,
    markImagePath: row.mark_image_path ?? null,
    regIrNo: row.reg_ir_no ?? null,
    ...madridFields(row),
    filingDate: row.filing_date ?? null,
    noiDate: row.noi_date ?? null,
    noiPaymentDate: row.noi_payment_date ?? null,
    issuanceNoticeDate: row.issuance_notice_date ?? null,
    issuanceFeePaidDate: row.issuance_fee_paid_date ?? null,
    officeActions: lifecycleOfficeActions(row.trademark_office_actions),
    abandonmentMailingDate: row.abandonment_mailing_date ?? null,
    revivalFiledDate: row.revival_filed_date ?? null,
    revivalDeclined: !!row.revival_declined,
    regDate: row.reg_date ?? null,
    dau3FilingDate: row.dau_3_filing_date ?? null,
    dau3Motex: !!row.dau_3_motex,
    dau3MotexDecision: row.dau_3_motex_decision ?? null,
    dau5FilingDate: row.dau_5_filing_date ?? null,
    renewalFilingDate: row.renewal_filing_date ?? null,
    renewalDauFiledDate: row.renewal_dau_filed_date ?? null,
    renewalDau5FiledDate: row.renewal_dau_5_filed_date ?? null,
  }));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const reports: ClientReportRow[] = (repRes.data ?? []).map((row: any) => ({
    trademarkId: row.trademark_id,
    deadlineKind: row.deadline_kind as DeadlineKind,
    deadlineDue: row.deadline_due,
    sentAt: row.sent_at,
    sentBy: row.sent_by,
    recipientEmail: row.recipient_email,
  }));

  return allDeadlinesForDashboard(trademarks, reports).filter((d) => d.due <= horizon);
}

/** Get matter IDs where user is on the team (for Files "My items" filter) */
export async function getUserMatterIds(firmId: string, userId: string): Promise<string[]> {
  const supabase = getServiceDbForFirm(firmId);
  const { data, error } = await supabase
    .from('matters')
    .select('notion_id')
    .contains('team_person_ids', [userId]);

  if (error) throw error;
  return (data ?? []).map((m: { notion_id: string }) => m.notion_id);
}
