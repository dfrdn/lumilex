import { getSupabase } from '@/lib/supabase';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { signStoragePaths } from '@/lib/storage-sign';
import type {
  NotionClient, NotionMatter, NotionCase, NotionAnnouncement,
  NotionTaskDetail, NotionMeetingDetail, NotionHearingDetail,
  NotionFilingDetail, NotionDeliverableDetail, NotionFileDetail, FileAttachment,
  DeliverableFileVersion, DeliverableActionLog, DeliverableComment, CommentReaction,
} from '@/types/notion';

/**
 * Resolve the owning client from a matter. Only `deliverables` denormalizes
 * `client_name`; every other entity reaches its client through the matter.
 * Detail getters only — never call this inside a list mapper (N+1).
 */
async function resolveMatterClient(
  matterId: string | null | undefined,
  firmId: string,
): Promise<{ client: string; clientId: string | null }> {
  if (!matterId) return { client: '', clientId: null };
  const { data } = await getServiceDbForFirm(firmId)
    .from('matters')
    .select('client_id, client_name')
    .eq('notion_id', matterId)
    .maybeSingle();
  return { client: data?.client_name ?? '', clientId: data?.client_id ?? null };
}

function parseFileUrlsRaw(raw: unknown): FileAttachment[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try { const parsed = JSON.parse(raw); return Array.isArray(parsed) ? parsed : []; }
    catch { return []; }
  }
  return [];
}

/** Resolve storage paths to fresh signed URLs (1-hour expiry). */
async function resolveFileUrls(raw: unknown): Promise<FileAttachment[]> {
  const files = parseFileUrlsRaw(raw);
  if (files.length === 0) return files;

  const needsSigning = files.some((f) => f.path);
  if (!needsSigning) return files; // legacy rows with direct URLs

  const paths = files.filter((f) => f.path).map((f) => f.path!);

  if (paths.length === 0) return files;

  // No `download` option → inline Content-Disposition, so previews render.
  // Raw client for the storage handle only.
  const signedMap = await signStoragePaths(getSupabase(), 'files', paths, 60 * 60);

  return files.map((f) => ({
    ...f,
    url: (f.path && signedMap.get(f.path)) || f.url,
  }));
}

/** Check if a fileUrl is a storage path (not a full URL) and resolve to signed URL. */
function isStoragePath(fileUrl: string): boolean {
  return !!fileUrl && !fileUrl.startsWith('http');
}

/** Batch-resolve storage paths in deliverable file/action records. */
export async function resolveDeliverableUrls<T extends { fileUrl: string }>(
  rows: T[],
): Promise<T[]> {
  const paths = rows.filter((r) => isStoragePath(r.fileUrl)).map((r) => r.fileUrl);
  if (paths.length === 0) return rows;

  const supabase = getSupabase(); // storage-only: raw client for the handle
  const { data, error } = await supabase.storage
    .from('files')
    .createSignedUrls(paths, 60 * 60);

  if (error || !data) return rows;

  const signedMap = new Map<string, string>();
  for (const item of data) {
    if (item.signedUrl && item.path) signedMap.set(item.path, item.signedUrl);
  }

  return rows.map((r) => ({
    ...r,
    fileUrl: isStoragePath(r.fileUrl) ? (signedMap.get(r.fileUrl) ?? r.fileUrl) : r.fileUrl,
  }));
}

// ── Get by ID ───────────────────────────────────────────────────────

export async function getAnnouncementById(id: string, firmId: string): Promise<NotionAnnouncement | null> {
  const supabase = getServiceDbForFirm(firmId);
  const { data, error } = await supabase
    .from('announcements').select('*').eq('notion_id', id).single();
  if (error || !data) return null;
  return {
    id: data.notion_id, url: data.notion_url, name: data.name,
    createdTime: data.created_time, content: data.content,
  };
}

export async function getTaskById(id: string, firmId: string): Promise<NotionTaskDetail | null> {
  const supabase = getServiceDbForFirm(firmId);
  const { data, error } = await supabase
    .from('tasks').select('*').eq('notion_id', id).single();
  if (error || !data) return null;
  const client = await resolveMatterClient(data.matter_id, firmId);
  return {
    id: data.notion_id, url: data.notion_url, name: data.name,
    matter: data.matter_name, matterId: data.matter_id,
    client: client.client, clientId: client.clientId,
    dueDate: data.due_date, status: data.status, priority: data.priority,
    done: data.done, assigneeIds: data.assignee_ids ?? [],
  };
}

export async function getMeetingById(id: string, firmId: string): Promise<NotionMeetingDetail | null> {
  const supabase = getServiceDbForFirm(firmId);
  const { data, error } = await supabase
    .from('meetings').select('*').eq('notion_id', id).single();
  if (error || !data) return null;
  const [client, current, { data: notes }] = await Promise.all([
    resolveMatterClient(data.matter_id, firmId),
    currentTeamIds(firmId),
    supabase.from('meeting_notes').select('body, version, updated_at, updated_by').eq('meeting_id', id).maybeSingle(),
  ]);
  return {
    id: data.notion_id, url: data.notion_url, name: data.name,
    date: data.date_start, endDate: data.date_end,
    matter: data.matter_name, matterId: data.matter_id,
    client: client.client, clientId: client.clientId,
    type: data.type, isAttended: data.is_attended,
    attendeeIds: currentOnly(data.attendee_ids, current),
    notes: notes?.body ?? '',
    notesVersion: notes?.version ?? 0,
    notesUpdatedAt: notes?.updated_at ?? null,
    notesUpdatedBy: notes?.updated_by ?? null,
  };
}

export async function getHearingById(id: string, firmId: string): Promise<NotionHearingDetail | null> {
  const supabase = getServiceDbForFirm(firmId);
  const { data, error } = await supabase
    .from('hearings').select('*').eq('notion_id', id).single();
  if (error || !data) return null;

  // Linked child Status Report (auto-created after attendance)
  const [{ data: sr }, client, current] = await Promise.all([
    supabase
      .from('deliverables')
      .select('notion_id, name, status')
      .eq('related_hearing_id', id)
      .eq('type', 'Status Report')
      .order('created_time', { ascending: false })
      .limit(1)
      .maybeSingle(),
    resolveMatterClient(data.matter_id, firmId),
    currentTeamIds(firmId),
  ]);

  return {
    id: data.notion_id, url: data.notion_url, name: data.name,
    date: data.date, matter: data.matter_name, matterId: data.matter_id,
    client: client.client, clientId: client.clientId,
    type: data.type, status: data.status,
    isAttended: data.is_attended ?? false,
    attendeeIds: currentOnly(data.attendee_ids, current),
    isFiled: data.is_filed ?? false,
    statusReport: sr ? { id: sr.notion_id, name: sr.name, status: sr.status } : null,
  };
}

/** A filing: an external deliverable with a due date, in the shape the detail pane reads. */
export async function getFilingById(id: string, firmId: string): Promise<NotionFilingDetail | null> {
  const supabase = getServiceDbForFirm(firmId);
  const { data, error } = await supabase
    .from('deliverables')
    .select('notion_id, notion_url, name, external_due_date, matter_id, matter_name, status, currently_with_ids, type')
    .eq('notion_id', id)
    .eq('type', 'External')
    .not('external_due_date', 'is', null)
    .maybeSingle();
  if (error || !data) return null;
  const client = await resolveMatterClient(data.matter_id, firmId);
  return {
    id: data.notion_id, url: data.notion_url ?? '', name: data.name,
    date: data.external_due_date, matter: data.matter_name, matterId: data.matter_id,
    client: client.client, clientId: client.clientId,
    status: data.status, attendeeIds: data.currently_with_ids ?? [],
    relatedDeliverableId: null,
    type: data.type ?? '',
  };
}

export async function getDeliverableById(id: string, firmId: string): Promise<NotionDeliverableDetail | null> {
  const supabase = getServiceDbForFirm(firmId);
  const { data, error } = await supabase
    .from('deliverables').select('*').eq('notion_id', id).single();
  if (error || !data) return null;

  // Resolve parent link if this deliverable IS a Status Report
  let parentLink: NotionDeliverableDetail['parentLink'] = null;
  if (data.type === 'Status Report') {
    if (data.related_hearing_id) {
      const { data: parent } = await supabase
        .from('hearings')
        .select('notion_id, name')
        .eq('notion_id', data.related_hearing_id)
        .maybeSingle();
      if (parent) parentLink = { kind: 'hearing', id: parent.notion_id, name: parent.name };
    } else if (data.source_deliverable_id) {
      const { data: parent } = await supabase
        .from('deliverables')
        .select('notion_id, name')
        .eq('notion_id', data.source_deliverable_id)
        .maybeSingle();
      if (parent) parentLink = { kind: 'deliverable', id: parent.notion_id, name: parent.name };
    } else if (data.source_file_id) {
      const { data: parent } = await supabase
        .from('files')
        .select('notion_id, name')
        .eq('notion_id', data.source_file_id)
        .maybeSingle();
      if (parent) parentLink = { kind: 'file', id: parent.notion_id, name: parent.name || 'File' };
    }
  }

  // Child Status Report linked to this deliverable (if it was marked filed),
  // plus the owning client — the row carries only the denormalized
  // client_name, so the linkable id comes off the matter.
  const [{ data: sr }, client, current] = await Promise.all([
    supabase
      .from('deliverables')
      .select('notion_id, name, status')
      .eq('source_deliverable_id', id)
      .eq('type', 'Status Report')
      .order('created_time', { ascending: false })
      .limit(1)
      .maybeSingle(),
    resolveMatterClient(data.matter_id, firmId),
    currentTeamIds(firmId),
  ]);

  return {
    id: data.notion_id, url: data.notion_url, name: data.name,
    matter: data.matter_name, matterId: data.matter_id,
    // Matter first: `client_name` on the row is a snapshot taken at creation,
    // so a matter reassigned to another client leaves it stale. Taking the name
    // from the same lookup as clientId keeps the label and its link in step.
    client: client.client || data.client_name, clientId: client.clientId,
    status: data.status,
    drafter: currentOnly(data.drafter_ids, current),
    ...currentReviewers(data.reviewer_ids, data.review_dates, current),
    currentlyWith: data.currently_with_ids ?? [],
    externalDueDate: data.external_due_date,
    dateDone: data.date_done ?? null,
    priority: data.priority,
    type: data.type ?? '',
    subtype: data.subtype ?? '',
    createdTime: data.created_time ?? null,
    parentLink,
    statusReport: sr ? { id: sr.notion_id, name: sr.name, status: sr.status } : null,
  };
}

export async function getDeliverableVersions(deliverableId: string, firmId: string): Promise<DeliverableFileVersion[]> {
  const supabase = getServiceDbForFirm(firmId);
  const { data, error } = await supabase
    .from('deliverable_files')
    .select('*')
    .eq('deliverable_id', deliverableId)
    .order('version', { ascending: false });
  if (error) throw error;
  const rows = (data ?? []).map((row: any) => ({
    id: row.id,
    version: row.version,
    fileName: row.file_name,
    fileUrl: row.file_url as string,
    filePath: row.file_url as string | null,
    fileSize: row.file_size,
    needsReupload: row.needs_reupload ?? false,
    uploadedBy: row.uploaded_by,
    action: row.action,
    createdAt: row.created_at,
  }));
  return resolveDeliverableUrls(rows);
}

/** Fetch version-level reactions grouped by version → emoji → personIds */
export async function getDeliverableVersionReactions(
  deliverableId: string,
  firmId: string,
): Promise<Record<number, CommentReaction[]>> {
  const supabase = getServiceDbForFirm(firmId);
  const { data, error } = await supabase
    .from('deliverable_version_reactions')
    .select('version, emoji, person_id')
    .eq('deliverable_id', deliverableId);
  if (error) throw error;

  // Group: version → emoji → personIds[]
  const map = new Map<number, Map<string, string[]>>();
  for (const row of data ?? []) {
    if (!map.has(row.version)) map.set(row.version, new Map());
    const emojiMap = map.get(row.version)!;
    const existing = emojiMap.get(row.emoji);
    if (existing) existing.push(row.person_id);
    else emojiMap.set(row.emoji, [row.person_id]);
  }

  const result: Record<number, CommentReaction[]> = {};
  for (const [version, emojiMap] of map) {
    result[version] = Array.from(emojiMap.entries()).map(([emoji, personIds]) => ({
      emoji,
      personIds,
    }));
  }
  return result;
}

export async function getDeliverableActions(deliverableId: string, firmId: string): Promise<DeliverableActionLog[]> {
  const supabase = getServiceDbForFirm(firmId);
  const { data, error } = await supabase
    .from('deliverable_actions')
    .select('*')
    .eq('deliverable_id', deliverableId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  const rows = (data ?? []).map((row: any) => ({
    id: row.id,
    action: row.action,
    oldStatus: row.old_status,
    newStatus: row.new_status,
    performedBy: row.performed_by,
    comment: row.comment,
    mentions: row.mentions ?? [],
    fileUrl: (row.file_url ?? '') as string,
    fileName: row.file_name,
    createdAt: row.created_at,
  }));
  return resolveDeliverableUrls(rows);
}

export async function getDeliverableComments(deliverableId: string, firmId: string): Promise<DeliverableComment[]> {
  const supabase = getServiceDbForFirm(firmId);
  const { data, error } = await supabase
    .from('deliverable_comments')
    .select('*, deliverable_comment_reactions(emoji, person_id)')
    .eq('deliverable_id', deliverableId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row: any) => {
    // Group reactions by emoji
    const reactionMap = new Map<string, string[]>();
    for (const r of row.deliverable_comment_reactions ?? []) {
      const existing = reactionMap.get(r.emoji);
      if (existing) existing.push(r.person_id);
      else reactionMap.set(r.emoji, [r.person_id]);
    }
    return {
      id: row.id,
      deliverableId: row.deliverable_id,
      parentType: row.parent_type,
      parentId: row.parent_id,
      comment: row.comment,
      mentions: row.mentions ?? [],
      personId: row.person_id,
      createdAt: row.created_at,
      reactions: Array.from(reactionMap.entries()).map(([emoji, personIds]) => ({ emoji, personIds })),
    };
  });
}

export async function getClientById(id: string, firmId: string): Promise<NotionClient | null> {
  const supabase = getServiceDbForFirm(firmId);
  const { data, error } = await supabase
    .from('clients').select('*').eq('notion_id', id).single();
  if (error || !data) return null;
  return {
    id: data.notion_id, url: data.notion_url, name: data.name,
    clientCode: data.client_code ?? '',
    status: data.status ?? '',
    fullCompanyName: data.full_company_name ?? '',
    tin: data.tin ?? '',
    contactEmail: data.contact_email ?? '',
    phoneNumber: data.phone_number ?? '',
    pointPersons: data.point_persons ?? '',
    discount: data.discount ?? null,
    receivables: data.receivables ?? null,
    priority: data.priority ?? false,
    relationshipPartnerId: data.relationship_partner_id ?? null,
    createdTime: data.created_time ?? null,
  };
}

export async function getMatterById(id: string, firmId: string): Promise<NotionMatter | null> {
  const supabase = getServiceDbForFirm(firmId);
  const { data, error } = await supabase
    .from('matters').select('*').eq('notion_id', id).single();
  if (error || !data) return null;
  return {
    id: data.notion_id, url: data.notion_url, name: data.name,
    matterCode: data.matter_code ?? '',
    clientId: data.client_id, clientName: data.client_name,
    relatedMatterIds: data.related_matter_ids ?? [],
    parentMatterId: data.parent_matter_id ?? null,
  };
}

export async function getCaseById(id: string, firmId: string): Promise<NotionCase | null> {
  const supabase = getServiceDbForFirm(firmId);
  const { data, error } = await supabase
    .from('matters').select('*').eq('notion_id', id).single();
  if (error || !data) return null;
  return {
    id: data.notion_id, url: data.notion_url, name: data.name,
    matterCode: data.matter_code ?? '',
    clientId: data.client_id, clientName: data.client_name,
    relatedMatterIds: data.related_matter_ids ?? [],
    parentMatterId: data.parent_matter_id ?? null,
    type: data.type ?? '',
    status: data.status ?? '',
    caseTitle: data.case_title ?? '',
    caseNumber: data.case_number ?? '',
    court: data.court ?? '',
    outcome: data.outcome ?? '',
    teamPersonIds: data.team_person_ids ?? [],
  };
}

// ── Relational queries (for Matter / Client detail pages) ───────────

function mapTask(row: any): NotionTaskDetail {
  return {
    id: row.notion_id, url: row.notion_url, name: row.name,
    matter: row.matter_name, matterId: row.matter_id,
    dueDate: row.due_date, status: row.status, priority: row.priority,
    done: row.done, assigneeIds: row.assignee_ids ?? [],
  };
}

function mapMeeting(row: any, current: Set<string>): NotionMeetingDetail {
  return {
    id: row.notion_id, url: row.notion_url, name: row.name,
    date: row.date_start, endDate: row.date_end,
    matter: row.matter_name, matterId: row.matter_id,
    type: row.type, isAttended: row.is_attended,
    attendeeIds: currentOnly(row.attendee_ids, current),
  };
}

function mapHearing(row: any, current: Set<string>): NotionHearingDetail {
  return {
    id: row.notion_id, url: row.notion_url, name: row.name,
    date: row.date, matter: row.matter_name, matterId: row.matter_id,
    type: row.type, status: row.status,
    isAttended: row.is_attended ?? false,
    attendeeIds: currentOnly(row.attendee_ids, current),
    isFiled: row.is_filed ?? false,
  };
}

function mapDeliverable(row: any, current: Set<string>): NotionDeliverableDetail {
  return {
    id: row.notion_id, url: row.notion_url, name: row.name,
    matter: row.matter_name, matterId: row.matter_id,
    client: row.client_name, status: row.status,
    drafter: currentOnly(row.drafter_ids, current),
    ...currentReviewers(row.reviewer_ids, row.review_dates, current),
    currentlyWith: row.currently_with_ids ?? [],
    externalDueDate: row.external_due_date,
    priority: row.priority,
    type: row.type ?? '',
    subtype: row.subtype ?? '',
    createdTime: row.created_time ?? null,
  };
}

export async function getFileById(id: string, firmId: string): Promise<NotionFileDetail | null> {
  const supabase = getServiceDbForFirm(firmId);
  const { data, error } = await supabase
    .from('files').select('*').eq('notion_id', id).single();
  if (error || !data) return null;
  // Client resolution stays here rather than in mapFile — mapFile also backs
  // getFilesByMatterId, where a per-row matter lookup would be an N+1.
  const [file, client] = await Promise.all([mapFile(data), resolveMatterClient(data.matter_id, firmId)]);
  return { ...file, client: client.client, clientId: client.clientId };
}

async function mapFile(row: any): Promise<NotionFileDetail> {
  return {
    id: row.notion_id, url: row.notion_url, name: row.name,
    matter: row.matter_name, matterId: row.matter_id,
    personsReadIds: row.persons_read_ids ?? [],
    createdTime: row.created_time,
    origin: row.origin ?? '',
    actionTaken: row.action_taken ?? '',
    dateReceived: row.date_received ?? null,
    dateSentFiled: row.date_sent_filed ?? null,
    documentDate: row.document_date ?? null,
    deliverableId: row.deliverable_id ?? null,
    deliverableName: row.deliverable_name ?? '',
    fileUrls: await resolveFileUrls(row.file_urls),
    isCourtRecord: row.is_court_record ?? false,
  };
}

function mapMatter(row: any): NotionMatter {
  return {
    id: row.notion_id, url: row.notion_url, name: row.name,
    matterCode: row.matter_code ?? '',
    clientId: row.client_id, clientName: row.client_name,
    relatedMatterIds: row.related_matter_ids ?? [],
    parentMatterId: row.parent_matter_id ?? null,
  };
}

export async function getTasksByMatterId(matterId: string, firmId: string) {
  const supabase = getServiceDbForFirm(firmId);
  const { data, error } = await supabase
    .from('tasks').select('*').eq('matter_id', matterId)
    .order('due_date', { ascending: true });
  if (error) throw error;
  return (data ?? []).map(mapTask);
}

export async function getMeetingsByMatterId(matterId: string, firmId: string) {
  const supabase = getServiceDbForFirm(firmId);
  const { data, error } = await supabase
    .from('meetings').select('*').eq('matter_id', matterId)
    .order('date_start', { ascending: false });
  if (error) throw error;
  const current = await currentTeamIds(firmId);
  return (data ?? []).map((r) => mapMeeting(r, current));
}

export async function getHearingsByMatterId(matterId: string, firmId: string) {
  const supabase = getServiceDbForFirm(firmId);
  const { data, error } = await supabase
    .from('hearings').select('*').eq('matter_id', matterId)
    .order('date', { ascending: false });
  if (error) throw error;
  const current = await currentTeamIds(firmId);
  return (data ?? []).map((r) => mapHearing(r, current));
}

export async function getFilingsByMatterId(matterId: string, firmId: string) {
  // Filings = deliverables with deadline belonging to case matters
  const supabase = getServiceDbForFirm(firmId);
  const { data, error } = await supabase
    .from('deliverables').select('*').eq('matter_id', matterId)
    .not('external_due_date', 'is', null)
    .order('external_due_date', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row: any): NotionFilingDetail => ({
    id: row.notion_id, url: row.notion_url, name: row.name,
    date: row.external_due_date, matter: row.matter_name, matterId: row.matter_id,
    status: row.status, attendeeIds: row.currently_with_ids ?? [],
    relatedDeliverableId: null,
    type: row.type ?? '',
  }));
}

export async function getDeliverablesByMatterId(matterId: string, firmId: string) {
  const supabase = getServiceDbForFirm(firmId);
  const { data, error } = await supabase
    .from('deliverables').select('*').eq('matter_id', matterId)
    .order('external_due_date', { ascending: true });
  if (error) throw error;
  const current = await currentTeamIds(firmId);
  return (data ?? []).map((r) => mapDeliverable(r, current));
}

export async function getFilesByMatterId(matterId: string, firmId: string) {
  const supabase = getServiceDbForFirm(firmId);
  const { data, error } = await supabase
    .from('files').select('*').eq('matter_id', matterId)
    .order('created_time', { ascending: false });
  if (error) throw error;
  return Promise.all((data ?? []).map(mapFile));
}

/** A filed-version row decorated with its parent deliverable's name + id, for cross-listing in the matter's Files section. */
export interface MatterFiledCopy extends DeliverableFileVersion {
  deliverableId: string;
  deliverableName: string;
}

/**
 * All deliverable_files rows tagged "Filed version" whose parent deliverable
 * belongs to this matter. Used by the matter detail page so the
 * authoritative filed copies surface alongside regular Files.
 */
export async function getFiledCopiesByMatterId(matterId: string, firmId: string): Promise<MatterFiledCopy[]> {
  const supabase = getServiceDbForFirm(firmId);

  // Exclude Status Report deliverables — those are internal-facing reports
  // and shouldn't surface in the matter's Files section alongside court
  // records and the actual external filings.
  const { data: deliverableRows, error: dErr } = await supabase
    .from('deliverables').select('notion_id, name').eq('matter_id', matterId)
    .neq('type', 'Status Report');
  if (dErr || !deliverableRows || deliverableRows.length === 0) return [];

  const nameById = new Map<string, string>();
  for (const row of deliverableRows as Array<{ notion_id: string; name: string }>) {
    nameById.set(row.notion_id, row.name);
  }
  const ids = Array.from(nameById.keys());

  const { data, error } = await supabase
    .from('deliverable_files')
    .select('id, deliverable_id, version, file_name, file_url, file_size, needs_reupload, uploaded_by, action, created_at')
    .in('deliverable_id', ids)
    .ilike('action', 'Filed version%')
    .order('created_at', { ascending: false });
  if (error || !data) return [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = data.map((row: any) => ({
    id: row.id as number,
    deliverableId: row.deliverable_id as string,
    deliverableName: nameById.get(row.deliverable_id) ?? '',
    version: row.version as number,
    fileName: row.file_name as string,
    fileUrl: row.file_url as string,
    fileSize: row.file_size as number | null,
    needsReupload: (row.needs_reupload ?? false) as boolean,
    uploadedBy: row.uploaded_by as string,
    action: row.action as string | null,
    createdAt: row.created_at as string,
  }));

  return resolveDeliverableUrls(rows);
}

export async function getMattersByClientId(clientId: string, firmId: string) {
  const supabase = getServiceDbForFirm(firmId);
  const { data, error } = await supabase
    .from('matters').select('*').eq('client_id', clientId)
    .order('name', { ascending: true });
  if (error) throw error;
  return (data ?? []).map(mapMatter);
}

export interface ClientMatterDetail {
  id: string;
  url: string;
  name: string;
  matterCode: string;
  type: string;
  status: string;
  caseTitle: string;
  caseNumber: string;
  court: string;
  outcome: string;
  teamPersonIds: string[];
  deliverableCount: number;
  activeDeliverableCount: number;
  taskCount: number;
  openTaskCount: number;
  hearingCount: number;
  meetingCount: number;
  filingCount: number;
  fileCount: number;
}

export async function getClientMattersWithCounts(clientId: string, firmId: string): Promise<ClientMatterDetail[]> {
  const supabase = getServiceDbForFirm(firmId);

  const { data: matters, error } = await supabase
    .from('matters').select('*').eq('client_id', clientId)
    .order('status', { ascending: true })
    .order('name', { ascending: true });
  if (error) throw error;
  if (!matters || matters.length === 0) return [];

  const matterIds = matters.map((m: any) => m.notion_id);

  // Fetch counts in parallel
  const [deliverables, tasks, hearings, meetings, filings, files] = await Promise.all([
    supabase.from('deliverables').select('matter_id, status').in('matter_id', matterIds),
    supabase.from('tasks').select('matter_id, done').in('matter_id', matterIds),
    supabase.from('hearings').select('matter_id').in('matter_id', matterIds).neq('type', 'Filing'),
    supabase.from('meetings').select('matter_id').in('matter_id', matterIds),
    supabase.from('deliverables').select('matter_id, status').in('matter_id', matterIds).not('external_due_date', 'is', null),
    supabase.from('files').select('matter_id').in('matter_id', matterIds),
  ]);

  // Build count maps
  const delivCount = new Map<string, number>();
  const activeDelivCount = new Map<string, number>();
  for (const d of deliverables.data ?? []) {
    delivCount.set(d.matter_id, (delivCount.get(d.matter_id) ?? 0) + 1);
    const s = (d.status || '').toLowerCase();
    if (!s.includes('filed') && !s.includes('sent out') && !s.includes('archived')) {
      activeDelivCount.set(d.matter_id, (activeDelivCount.get(d.matter_id) ?? 0) + 1);
    }
  }

  const taskCountMap = new Map<string, number>();
  const openTaskMap = new Map<string, number>();
  for (const t of tasks.data ?? []) {
    taskCountMap.set(t.matter_id, (taskCountMap.get(t.matter_id) ?? 0) + 1);
    if (!t.done) openTaskMap.set(t.matter_id, (openTaskMap.get(t.matter_id) ?? 0) + 1);
  }

  const hearingMap = new Map<string, number>();
  for (const h of hearings.data ?? []) {
    hearingMap.set(h.matter_id, (hearingMap.get(h.matter_id) ?? 0) + 1);
  }

  const meetingMap = new Map<string, number>();
  for (const m of meetings.data ?? []) {
    meetingMap.set(m.matter_id, (meetingMap.get(m.matter_id) ?? 0) + 1);
  }

  const filingMap = new Map<string, number>();
  for (const f of filings.data ?? []) {
    filingMap.set(f.matter_id, (filingMap.get(f.matter_id) ?? 0) + 1);
  }

  const fileMap = new Map<string, number>();
  for (const f of files.data ?? []) {
    fileMap.set(f.matter_id, (fileMap.get(f.matter_id) ?? 0) + 1);
  }

  return matters.map((m: any) => ({
    id: m.notion_id,
    url: m.notion_url,
    name: m.name,
    matterCode: m.matter_code ?? '',
    type: m.type ?? '',
    status: m.status ?? '',
    caseTitle: m.case_title ?? '',
    caseNumber: m.case_number ?? '',
    court: m.court ?? '',
    outcome: m.outcome ?? '',
    teamPersonIds: m.team_person_ids ?? [],
    deliverableCount: delivCount.get(m.notion_id) ?? 0,
    activeDeliverableCount: activeDelivCount.get(m.notion_id) ?? 0,
    taskCount: taskCountMap.get(m.notion_id) ?? 0,
    openTaskCount: openTaskMap.get(m.notion_id) ?? 0,
    hearingCount: hearingMap.get(m.notion_id) ?? 0,
    meetingCount: meetingMap.get(m.notion_id) ?? 0,
    filingCount: filingMap.get(m.notion_id) ?? 0,
    fileCount: fileMap.get(m.notion_id) ?? 0,
  }));
}

export async function getMattersByIds(ids: string[], firmId: string) {
  if (ids.length === 0) return [];
  const supabase = getServiceDbForFirm(firmId);
  const { data, error } = await supabase
    .from('matters').select('*').in('notion_id', ids);
  if (error) throw error;
  return (data ?? []).map(mapMatter);
}

// ── Trademarks ──────────────────────────────────────────────────────

import type { Trademark, TrademarkFile } from '@/types/notion';
import { TRADEMARK_SELECT, rowToTrademark, rowToTrademarkFile } from '@/lib/trademark-row';
import { currentTeamIds, currentOnly, currentReviewers } from '@/lib/queries/people';

export async function getTrademarkById(id: string, firmId: string): Promise<Trademark | null> {
  const supabase = getServiceDbForFirm(firmId);
  const { data, error } = await supabase
    .from('trademarks').select(TRADEMARK_SELECT).eq('id', id).single();
  if (error || !data) return null;
  return rowToTrademark(data);
}

export async function getTrademarkFiles(trademarkId: string, firmId: string): Promise<TrademarkFile[]> {
  const supabase = getServiceDbForFirm(firmId);
  const { data, error } = await supabase
    .from('trademark_files')
    .select('*')
    .eq('trademark_id', trademarkId)
    .order('uploaded_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(rowToTrademarkFile);
}

/** Resolve a single storage path to a fresh signed URL (1-hour, inline). */
export async function signTrademarkPath(path: string | null): Promise<string | null> {
  if (!path) return null;
  const supabase = getSupabase(); // storage-only: raw client for the handle
  const { data } = await supabase.storage
    .from('files')
    .createSignedUrl(path, 60 * 60, { download: false });
  return data?.signedUrl ?? null;
}

