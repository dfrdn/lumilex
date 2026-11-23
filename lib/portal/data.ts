import type { SupabaseClient } from '@supabase/supabase-js';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { isAnnexFile } from '@/lib/annexes';
import { computeWorkDelivered, type WorkDelivered } from '@/lib/portal/matter-insights';
import type {
  PortalFile,
  ScheduleItem,
  PortalDeliverable,
  PortalFileRequest,
  PortalExhibit,
  PortalStatusReport,
} from '@/app/portal/matters/[id]/MatterDetailTabs';
import type { PortalTeamMember, PortalNextEvent } from '@/app/portal/matters/[id]/MatterPortalHero';
import type { PortalTimelineEvent } from '@/app/portal/matters/[id]/PortalTimeline';
import type { PortalChatMessage } from '@/app/portal/matters/[id]/PortalMatterChat';
import type { EngagementSignatureState } from '@/app/portal/matters/[id]/EngagementSignatureCard';
import { isClientVisibleMeeting } from '@/lib/portal/meetings';
import { portalScope } from './companies';
import type { HearingStatus } from '@/lib/hearing-status';
import {
  isClientDeliverable,
  isClientVisibleFileRow,
  isFiledDeliverable,
  isFiledVersion,
  isSentStatusReport,
  wasFiledWithAuthority,
} from '@/lib/portal/deliverable-visibility';

/**
 * Shared portal data loaders.
 *
 * Both the live portal (`app/portal/*`, `/api/portal/*`) and the partner/admin
 * preview (`app/client-portal-preview/*`) call these with the firm-scoped
 * service client (`getServiceDbForFirm`). A client's JWT reads none of the
 * tables behind them — the portal policies that once allowed it exposed whole
 * rows (drafts, the team's internal meetings, matter notes, invoice line
 * items) to anyone calling PostgREST directly, and were dropped in
 * `20261029_portal_close_direct_reads.sql`. So the explicit client/matter
 * scoping in every loader IS the gate: `clientId` must come from the portal
 * session (or the preview's access check), and a loader that drops a filter
 * shows the client someone else's work.
 *
 * What a client may see of a matter's work is decided in
 * `lib/portal/deliverable-visibility.ts`, and every reader here asks it.
 *
 * Chat history is the one per-user read: the live portal passes the signed-in
 * client user, so each user sees their own conversation; the preview passes
 * none and sees the matter's full Q&A across the client's users.
 */

const CANCELLED_HEARING: HearingStatus = 'Cancelled';
const POSTPONED_HEARING: HearingStatus = 'Postponed';

function isCancelledHearing(h: { status: string | null }): boolean {
  return h.status === CANCELLED_HEARING;
}

/**
 * Resolve a client's display name for the portal header. Returns null when
 * the client row doesn't exist (callers decide: fall back, or 404).
 */
export async function getPortalClientName(
  firmId: string,
  clientId: string,
): Promise<string | null> {
  const { data } = await getServiceDbForFirm(firmId)
    .from('clients')
    .select('full_company_name, name, client_code')
    .eq('notion_id', clientId)
    .maybeSingle();
  if (!data) return null;
  // Nameless records shouldn't surface a raw UUID in the header — prefer the
  // human-friendly client code when there's no name at all.
  return (
    data.full_company_name ||
    data.name ||
    (data.client_code ? `Client #${data.client_code}` : clientId)
  );
}

// ── Landing: matters list ─────────────────────────────────────────────────

export interface PortalMatterListRow {
  notion_id: string;
  name: string;
  case_title: string | null;
  case_number: string | null;
  court: string | null;
  status: string | null;
  type: string | null;
  date: string | null;
  matter_code: string | null;
  outcome: string | null;
  is_case: boolean | null;
  related_matter_ids: string[] | null;
  parent_matter_id: string | null;
  created_time: string | null;
  last_activity_at: string | null;
}

export async function loadPortalMatters(
  db: SupabaseClient,
  clientId: string,
): Promise<PortalMatterListRow[]> {
  // `matters.date` is NULL firm-wide; `last_activity_at` is the real recency
  // signal and the landing view's default sort.
  const { data } = await db
    .from('matters')
    .select(
      'notion_id, name, case_title, case_number, court, status, type, date, matter_code, outcome, is_case, related_matter_ids, parent_matter_id, created_time, last_activity_at',
    )
    .eq('client_id', clientId)
    .order('last_activity_at', { ascending: false, nullsFirst: false });
  return (data ?? []) as PortalMatterListRow[];
}

// ── Landing: work-delivered strip ─────────────────────────────────────────

/**
 * Engagement-wide counts of work the firm has delivered, for the landing
 * page's "work delivered" strip. `matterIds` must come from the client's own
 * matter rows — the caller scopes them.
 */
export async function loadPortalWorkDelivered(
  db: SupabaseClient,
  matterIds: string[],
): Promise<WorkDelivered> {
  if (matterIds.length === 0) {
    return { filings: 0, statusReports: 0, hearingsAttended: 0, meetingsHeld: 0 };
  }
  const [deliverablesRes, hearingsRes, meetingsRes] = await Promise.all([
    db.from('deliverables').select('status, type').in('matter_id', matterIds),
    db.from('hearings').select('date, type, status').in('matter_id', matterIds),
    db.from('meetings').select('date_start, type').in('matter_id', matterIds),
  ]);
  return computeWorkDelivered(
    {
      deliverables: deliverablesRes.data ?? [],
      hearings: hearingsRes.data ?? [],
      meetings: (meetingsRes.data ?? []).filter(isClientVisibleMeeting),
    },
    Date.now(),
  );
}

// ── Billing ────────────────────────────────────────────────────────────────

export interface PortalInvoiceRow {
  id: number;
  invoice_number: string;
  billing_month: string | null;
  matter_name: string | null;
  status: string;
  total_amount: number | null;
  total_expenses: number | null;
  paid_amount: number | null;
  sent_date: string | null;
  due_date: string | null;
  signed_pdf_path: string | null;
  pdf_storage_path: string | null;
}

export interface PortalPaymentRow {
  invoice_id: number;
  amount: number;
  payment_date: string;
  payment_method: string | null;
}

export interface PortalBillingData {
  invoices: PortalInvoiceRow[];
  payments: PortalPaymentRow[];
  deposits: { type: string; amount: number }[];
}

// Clients only ever see billed invoices — never drafts.
export const BILLED_INVOICE_STATUSES = ['sent', 'partial', 'paid'];

export async function loadPortalBilling(
  db: SupabaseClient,
  clientId: string,
): Promise<PortalBillingData> {
  const { data: invoices } = await db
    .from('invoices')
    .select(
      'id, invoice_number, billing_month, matter_name, status, total_amount, total_expenses, paid_amount, sent_date, due_date, signed_pdf_path, pdf_storage_path',
    )
    .eq('client_id', clientId)
    .in('status', BILLED_INVOICE_STATUSES)
    .order('billing_month', { ascending: false })
    .order('invoice_number', { ascending: false });

  const invoiceRows = (invoices ?? []) as PortalInvoiceRow[];
  const invoiceIds = invoiceRows.map((i) => i.id);

  const [paymentsRes, depositsRes] = await Promise.all([
    invoiceIds.length > 0
      ? db
          .from('invoice_payments')
          .select('invoice_id, amount, payment_date, payment_method')
          .in('invoice_id', invoiceIds)
          .order('payment_date', { ascending: false })
      : Promise.resolve({ data: [] as PortalPaymentRow[] }),
    db.from('client_deposits').select('type, amount').eq('client_id', clientId),
  ]);

  return {
    invoices: invoiceRows,
    payments: (paymentsRes.data ?? []) as PortalPaymentRow[],
    deposits: (depositsRes.data ?? []) as { type: string; amount: number }[],
  };
}

// ── Matter detail ────────────────────────────────────────────────────────

interface FileUrlEntry {
  url?: string;
  name?: string;
  path?: string;
}

interface FileRowRaw {
  notion_id: string;
  name: string;
  date_received: string | null;
  date_sent_filed: string | null;
  document_date: string | null;
  origin: string | null;
  deliverable_id: string | null;
  is_court_record: boolean | null;
  file_urls: FileUrlEntry[] | null;
}

// Position seniority — mirrors lib/queries/team-roles.ts. Inlined to avoid
// pulling that module's service-role coupling into the portal data path.
const TEAM_SENIORITY_ORDER = [
  'Founding Partner',
  'Managing Partner',
  'Monitoring Partner',
  'Partner',
  'Of Counsel',
  'Senior Associate',
  'Mid-level Associate',
  'Junior Associate',
  'Underbar Associate',
] as const;

function seniorityRank(position: string): number {
  const idx = TEAM_SENIORITY_ORDER.indexOf(position as (typeof TEAM_SENIORITY_ORDER)[number]);
  return idx >= 0 ? idx : TEAM_SENIORITY_ORDER.length;
}

export interface PortalEngagement {
  filePath: string | null;
  fileName: string | null;
  url: string | null;
  signature: EngagementSignatureState | null;
}

export interface PortalMatterDetailData {
  matter: {
    notion_id: string;
    name: string;
    case_title: string | null;
    case_number: string | null;
    court: string | null;
    status: string | null;
    type: string | null;
    date: string | null;
    matter_code: string | null;
  };
  files: PortalFile[];
  schedule: ScheduleItem[];
  filedDeliverables: PortalDeliverable[];
  statusReports: PortalStatusReport[];
  exhibits: PortalExhibit[];
  fileRequests: PortalFileRequest[];
  teamMembers: PortalTeamMember[];
  nextEvent: PortalNextEvent | null;
  timelineEvents: PortalTimelineEvent[];
  chatMessages: PortalChatMessage[];
  engagement: PortalEngagement | null;
}

/**
 * Returns null when the matter isn't under `clientId` — the caller should
 * 404. The explicit `client_id` filter is the gate, and it runs before
 * anything else on the matter is read.
 *
 * `clientUserId` narrows the chat history to one person's conversation (the
 * live portal); the preview omits it and sees every client user's questions.
 */
export async function loadPortalMatterDetail(
  firmId: string,
  clientId: string,
  matterId: string,
  opts: { clientUserId?: string } = {},
): Promise<PortalMatterDetailData | null> {
  const db = getServiceDbForFirm(firmId);
  const service = db;
  const { data: matter } = await db
    .from('matters')
    .select(
      'notion_id, name, case_title, case_number, court, status, type, date, matter_code, team_person_ids',
    )
    .eq('notion_id', matterId)
    .eq('client_id', clientId)
    .maybeSingle();
  if (!matter) return null;

  const chatQuery = db
    .from('portal_chat_messages')
    .select('role, content')
    .eq('matter_id', matterId)
    .order('created_at', { ascending: true })
    .limit(50);
  const [
    { data: chatRows },
    { data: deliverables },
    { data: filesData },
    { data: meetingRows },
    { data: hearings },
    { data: fileRequestsData },
    { data: exhibitsData },
  ] = await Promise.all([
    opts.clientUserId ? chatQuery.eq('client_user_id', opts.clientUserId) : chatQuery,
    db
      .from('deliverables')
      .select('notion_id, name, status, type, external_due_date, date_done')
      .eq('matter_id', matterId),
    db
      .from('files')
      .select(
        'notion_id, name, date_received, date_sent_filed, document_date, origin, deliverable_id, is_court_record, file_urls',
      )
      .eq('matter_id', matterId),
    db
      .from('meetings')
      .select('notion_id, name, date_start, date_end, type, location')
      .eq('matter_id', matterId),
    db
      .from('hearings')
      .select('notion_id, name, date, type, status')
      .eq('matter_id', matterId),
    db
      .from('file_requests')
      .select('id, description, due_at, created_at, fulfilled_at, canceled_at, requested_by')
      .eq('matter_id', matterId)
      .is('canceled_at', null)
      .order('created_at', { ascending: false }),
    db
      .from('exhibits')
      .select(
        `id, label, offered_by, party_label, parent_exhibit_id, title, description,
         document_date, purpose, file_id, status, ruling_date, ruling_note,
         file:files!exhibits_file_id_fkey ( notion_id, name, deliverable_id, file_urls )`,
      )
      .eq('matter_id', matterId),
  ]);

  const meetings = (meetingRows ?? []).filter(isClientVisibleMeeting);

  const chatMessages: PortalChatMessage[] = (chatRows ?? []).map((m) => ({
    role: m.role as 'user' | 'assistant',
    content: m.content as string,
  }));

  // ── Engagement letter + signature state. Matter ownership is already proven
  // by the matter fetch above.
  const { data: billingConfig } = await service
    .from('matter_billing_configs')
    .select('engagement_file_path, engagement_file_name')
    .eq('matter_id', matterId)
    .maybeSingle();

  let engagement: PortalEngagement | null = null;
  if (billingConfig?.engagement_file_path) {
    const [{ data: signData }, { data: sigRow }] = await Promise.all([
      service.storage
        .from('documents')
        .createSignedUrl(billingConfig.engagement_file_path, 60 * 60),
      db
        .from('engagement_signatures')
        .select('typed_name, signed_at')
        .eq('matter_id', matterId)
        .eq('document_path', billingConfig.engagement_file_path)
        .maybeSingle(),
    ]);
    engagement = {
      filePath: billingConfig.engagement_file_path,
      fileName: billingConfig.engagement_file_name ?? null,
      url: signData?.signedUrl ?? null,
      signature: sigRow ? { typedName: sigRow.typed_name, signedAt: sigRow.signed_at } : null,
    };
  }

  // ── What of the matter's work the client may see ──────────────────────────
  type DeliverableRow = {
    notion_id: string;
    name: string;
    status: string | null;
    type: string | null;
    external_due_date: string | null;
    date_done: string | null;
  };
  const delivs = (deliverables ?? []) as DeliverableRow[];
  const shownDeliverableIds = new Set(delivs.filter(isClientDeliverable).map((d) => d.notion_id));

  // ── Files: flatten file_urls + batch-sign storage paths ───────────────────
  // A register row tied to a deliverable the client can't see is that
  // deliverable's working copy, and stays out.
  const fileRows = ((filesData ?? []) as FileRowRaw[]).filter((r) =>
    isClientVisibleFileRow(r, shownDeliverableIds),
  );
  const flatRaw: PortalFile[] = [];
  for (const row of fileRows) {
    const urls = row.file_urls ?? [];
    urls.forEach((u, idx) => {
      if (!u?.path) return;
      flatRaw.push({
        id: `${row.notion_id}_${idx}`,
        name: u.name || row.name || 'file',
        path: u.path,
        url: '',
        date: row.date_sent_filed || row.date_received || row.document_date,
        origin: row.origin,
        isCourtRecord: !!row.is_court_record,
        deliverableId: row.deliverable_id,
      });
    });
  }

  if (flatRaw.length > 0) {
    const paths = flatRaw.map((f) => f.path);
    const { data: signed } = await service.storage.from('files').createSignedUrls(paths, 60 * 60);
    const byPath = new Map<string, string>();
    for (const s of signed ?? []) {
      if (s.path && s.signedUrl) byPath.set(s.path, s.signedUrl);
    }
    for (const f of flatRaw) {
      f.url = byPath.get(f.path) ?? '';
    }
  }

  flatRaw.sort((a, b) => {
    if (a.date && b.date) return a.date < b.date ? 1 : -1;
    if (a.date) return -1;
    if (b.date) return 1;
    return a.name.localeCompare(b.name);
  });
  const files = flatRaw;

  // ── Schedule ──────────────────────────────────────────────────────────────
  const schedule: ScheduleItem[] = [];
  for (const m of meetings) {
    schedule.push({
      kind: 'meeting',
      id: m.notion_id,
      name: m.name || 'Meeting',
      date: m.date_start,
      subline: [m.type, m.location].filter(Boolean).join(' · '),
    });
  }
  for (const h of hearings ?? []) {
    schedule.push({
      kind: 'hearing',
      id: h.notion_id,
      name: h.name || 'Hearing',
      date: h.date,
      subline: [h.type, h.status].filter(Boolean).join(' · '),
    });
  }
  schedule.sort((a, b) => {
    if (a.date && b.date) return a.date < b.date ? 1 : -1;
    if (a.date) return -1;
    if (b.date) return 1;
    return 0;
  });

  // ── Deliverables: filed-only ──────────────────────────────────────────────
  const filedDelivRows = delivs.filter(isFiledDeliverable);
  const sentStatusReports = delivs.filter(isSentStatusReport);

  // ── The filed copy per deliverable, from deliverable_files. Only the upload
  // tagged "Filed version" reaches the client: the latest version is often a
  // draft started after filing, or a working DOCX on a deliverable that was
  // never given a filed copy. With no filed version, the deliverable shows
  // without a document.
  type VersionRow = {
    deliverable_id: string;
    version: number;
    action: string | null;
    file_name: string;
    file_url: string | null;
    file_size: number | null;
    created_at: string;
  };
  const latestByDeliverable = new Map<string, VersionRow>();
  const versionSigned = new Map<string, string>();
  const versionDelivIds = [
    ...filedDelivRows.map((d) => d.notion_id),
    ...sentStatusReports.map((d) => d.notion_id),
  ];
  if (versionDelivIds.length > 0) {
    const { data: versionRows } = await service
      .from('deliverable_files')
      .select('deliverable_id, version, action, file_name, file_url, file_size, created_at')
      .in('deliverable_id', versionDelivIds)
      .ilike('action', 'Filed version%')
      .order('version', { ascending: false });

    // Rows are version-desc. Pick the report file for each deliverable: never an
    // annex (those share the finalized version), and prefer the signed PDF over
    // the DOCX within that latest version.
    for (const row of (versionRows ?? []) as VersionRow[]) {
      if (!isFiledVersion(row) || isAnnexFile(row.file_name)) continue;
      const existing = latestByDeliverable.get(row.deliverable_id);
      if (!existing) {
        latestByDeliverable.set(row.deliverable_id, row);
      } else if (
        existing.version === row.version &&
        !existing.file_name.toLowerCase().endsWith('.pdf') &&
        row.file_name.toLowerCase().endsWith('.pdf')
      ) {
        latestByDeliverable.set(row.deliverable_id, row);
      }
    }

    const versionPaths = Array.from(latestByDeliverable.values())
      .map((v) => v.file_url)
      .filter((p): p is string => !!p && !p.startsWith('http'));
    if (versionPaths.length > 0) {
      const { data: signed } = await service.storage
        .from('files')
        .createSignedUrls(versionPaths, 60 * 60);
      for (const s of signed ?? []) {
        if (s.path && s.signedUrl) versionSigned.set(s.path, s.signedUrl);
      }
    }
  }

  function versionAsPortalFile(deliverableId: string, v: VersionRow): PortalFile {
    const path = v.file_url && !v.file_url.startsWith('http') ? v.file_url : null;
    return {
      id: `${deliverableId}_filed_v${v.version}`,
      name: v.file_name,
      path: path ?? '',
      url: path ? versionSigned.get(path) ?? '' : v.file_url ?? '',
      date: v.created_at,
      origin: null,
      isCourtRecord: false,
      deliverableId,
    };
  }

  // ── Completed deliverables, with their filed copy. Newest first, by the date
  // on the file shown (or, with no copy yet, the deliverable's own date), like
  // the timeline.
  const filedDeliverables: PortalDeliverable[] = filedDelivRows
    .map((d) => {
      const v = latestByDeliverable.get(d.notion_id);
      const files = v ? [versionAsPortalFile(d.notion_id, v)] : [];
      const sortDate = files[0]?.date || d.date_done || d.external_due_date || '';
      return {
        row: {
          id: d.notion_id,
          name: d.name,
          status: d.status,
          type: d.type,
          files,
        },
        sortDate,
      };
    })
    .sort((a, b) => {
      if (a.sortDate !== b.sortDate) return a.sortDate < b.sortDate ? 1 : -1;
      return a.row.name.localeCompare(b.row.name);
    })
    .map((x) => x.row);

  // ── Status reports: type='Status Report' + sent-out status; surface the
  // latest version from the same deliverable_files lookup.
  let statusReports: PortalStatusReport[] = [];
  if (sentStatusReports.length > 0) {
    statusReports = sentStatusReports
      .map((d): PortalStatusReport => {
        const v = latestByDeliverable.get(d.notion_id);
        const path = v?.file_url && !v.file_url.startsWith('http') ? v.file_url : null;
        return {
          id: d.notion_id,
          name: d.name,
          sentAt: v?.created_at ?? null,
          file: v
            ? {
                name: v.file_name,
                path: path ?? '',
                url: path ? versionSigned.get(path) ?? '' : v.file_url ?? '',
              }
            : null,
        };
      })
      .sort((a, b) => {
        if (a.sentAt && b.sentAt) return a.sentAt < b.sentAt ? 1 : -1;
        if (a.sentAt) return -1;
        if (b.sentAt) return 1;
        return a.name.localeCompare(b.name);
      });
  }

  // ── Timeline: merge meetings, hearings, filings, status reports, and court
  // records into a single narrative feed.
  const nowForTimeline = Date.now();
  const timelineEvents: PortalTimelineEvent[] = [];

  for (const m of meetings ?? []) {
    if (!m.date_start) continue;
    const future = new Date(m.date_start).getTime() >= nowForTimeline;
    timelineEvents.push({
      id: m.notion_id,
      kind: 'meeting',
      date: m.date_start,
      headline: future ? `Meeting: ${m.name || 'Meeting'}` : m.name || 'Meeting',
      subline: [m.type, m.location].filter(Boolean).join(' · '),
      isUpcoming: future,
    });
  }

  for (const h of hearings ?? []) {
    if (!h.date) continue;
    // A cancelled hearing stays listed, marked cancelled, but is never upcoming.
    const future = !isCancelledHearing(h) && new Date(h.date).getTime() >= nowForTimeline;
    const name = h.name || 'Hearing';
    // Only a hearing that took place was held; a cancelled one may still be
    // dated ahead, and a postponed one moved to another day.
    const headline = isCancelledHearing(h)
      ? `Hearing cancelled — ${name}`
      : h.status === POSTPONED_HEARING
        ? `Hearing postponed — ${name}`
        : future
          ? `Hearing: ${name}`
          : `Hearing held — ${name}`;
    timelineEvents.push({
      id: h.notion_id,
      kind: 'hearing',
      date: h.date,
      headline,
      subline: [h.type, h.status].filter(Boolean).join(' · '),
      isUpcoming: future,
    });
  }

  for (const d of filedDelivRows) {
    const when = d.date_done || d.external_due_date;
    if (!when) continue;
    timelineEvents.push({
      id: `filing-${d.notion_id}`,
      kind: 'filing',
      date: when,
      // Only external work is lodged with a court or agency; the rest is sent.
      headline: `${wasFiledWithAuthority(d.type) ? 'Filed' : 'Sent'}: ${d.name}`,
      subline: d.type || 'Filing',
      isUpcoming: false,
    });
  }

  for (const r of statusReports) {
    if (!r.sentAt) continue;
    timelineEvents.push({
      id: `sr-${r.id}`,
      kind: 'status_report',
      date: r.sentAt,
      headline: `Status report sent — ${r.name}`,
      subline: '',
      isUpcoming: false,
    });
  }

  for (const f of fileRows) {
    const isCourtRecord =
      !!f.is_court_record || (typeof f.origin === 'string' && f.origin.toLowerCase() === 'court');
    if (!isCourtRecord) continue;
    const when = f.document_date || f.date_received || f.date_sent_filed;
    if (!when) continue;
    timelineEvents.push({
      id: `court-${f.notion_id}`,
      kind: 'court_record',
      date: when,
      headline: `Court record: ${f.name || 'Document'}`,
      subline: f.origin || '',
      isUpcoming: false,
    });
  }

  // ── Exhibits ────────────────────────────────────────────────────────────
  type ExhibitRowRaw = {
    id: string;
    label: string;
    offered_by: string;
    party_label: string;
    parent_exhibit_id: string | null;
    title: string;
    description: string;
    document_date: string | null;
    purpose: string;
    file_id: string | null;
    status: string;
    ruling_date: string | null;
    ruling_note: string;
    file: {
      notion_id: string;
      name: string;
      deliverable_id: string | null;
      file_urls: FileUrlEntry[] | null;
    } | null;
  };
  // An exhibit's document is a register row like any other: when it is the
  // working copy of a deliverable the client can't see, the exhibit is listed
  // without it.
  const exhibitRows = ((exhibitsData ?? []) as unknown as ExhibitRowRaw[]).map((e) =>
    e.file && !isClientVisibleFileRow(e.file, shownDeliverableIds) ? { ...e, file: null } : e,
  );
  const exhibitPaths: string[] = [];
  for (const e of exhibitRows) {
    const p = e.file?.file_urls?.[0]?.path;
    if (p) exhibitPaths.push(p);
  }
  const exhibitSignedByPath = new Map<string, string>();
  if (exhibitPaths.length > 0) {
    const { data: signed } = await service
      .storage.from('files')
      .createSignedUrls(exhibitPaths, 60 * 60);
    for (const s of signed ?? []) {
      if (s.path && s.signedUrl) exhibitSignedByPath.set(s.path, s.signedUrl);
    }
  }
  const exhibits: PortalExhibit[] = exhibitRows.map((e) => {
    const urlEntry = e.file?.file_urls?.[0];
    return {
      id: e.id,
      label: e.label,
      offeredBy: e.offered_by,
      partyLabel: e.party_label,
      parentExhibitId: e.parent_exhibit_id,
      title: e.title,
      description: e.description,
      documentDate: e.document_date,
      purpose: e.purpose,
      status: e.status,
      rulingDate: e.ruling_date,
      rulingNote: e.ruling_note,
      file: e.file
        ? {
            name: urlEntry?.name || e.file.name,
            signedUrl: urlEntry?.path ? exhibitSignedByPath.get(urlEntry.path) ?? '' : '',
            path: urlEntry?.path ?? '',
          }
        : null,
    };
  });

  // ── File requests ─────────────────────────────────────────────────────────
  type FileRequestRow = {
    id: string;
    description: string;
    due_at: string | null;
    created_at: string;
    fulfilled_at: string | null;
    canceled_at: string | null;
    requested_by: string;
  };
  const requestRows = (fileRequestsData ?? []) as FileRequestRow[];
  const requesterIds = [...new Set(requestRows.map((r) => r.requested_by).filter(Boolean))];
  const requesterNames = new Map<string, string>();
  if (requesterIds.length > 0) {
    const { data: members } = await service
      .from('team')
      .select('person_id, name')
      .in('person_id', requesterIds);
    for (const m of members ?? []) {
      if (m.person_id) requesterNames.set(m.person_id, m.name || '');
    }
  }
  const fileRequests: PortalFileRequest[] = requestRows.map((r) => ({
    id: r.id,
    description: r.description,
    dueAt: r.due_at,
    createdAt: r.created_at,
    fulfilledAt: r.fulfilled_at,
    requesterName: requesterNames.get(r.requested_by) || 'Your legal team',
  }));

  // ── Your legal team: resolve team_person_ids → team rows via service-role.
  // Clients see the corporate headshot only — the casual internal avatar
  // (team.avatar_url) is deliberately never selected here. No headshot →
  // initials.
  const teamPersonIds = ((matter.team_person_ids ?? []) as string[]) || [];
  let teamMembers: PortalTeamMember[] = [];
  if (teamPersonIds.length > 0) {
    const { data: teamRows } = await service
      .from('team')
      .select('person_id, name, initials, position, headshot_url, active')
      .in('person_id', teamPersonIds)
      .eq('active', true);
    type TeamRow = {
      person_id: string;
      name: string;
      initials: string;
      position: string;
      headshot_url: string | null;
    };
    teamMembers = ((teamRows ?? []) as TeamRow[])
      .map((r) => ({
        personId: r.person_id,
        name: r.name,
        initials: r.initials || '??',
        position: r.position || '',
        avatarUrl: r.headshot_url || null,
      }))
      .sort((a, b) => seniorityRank(a.position) - seniorityRank(b.position));
  }

  // ── On the horizon: next future meeting or hearing. A cancelled hearing is
  // never the next thing that happens.
  const nowMs = Date.now();
  const cancelledHearingIds = new Set(
    (hearings ?? []).filter(isCancelledHearing).map((h) => h.notion_id as string),
  );
  const nextEvent: PortalNextEvent | null = (() => {
    const upcomingItems = schedule
      .filter((s) => !(s.kind === 'hearing' && cancelledHearingIds.has(s.id)))
      .filter((s) => s.date && new Date(s.date).getTime() >= nowMs)
      .sort((a, b) => (a.date && b.date ? (a.date < b.date ? -1 : 1) : 0));
    const first = upcomingItems[0];
    if (!first || !first.date) return null;
    return {
      kind: first.kind,
      name: first.name,
      date: first.date,
      subline: first.subline,
    };
  })();

  return {
    matter: {
      notion_id: matter.notion_id,
      name: matter.name,
      case_title: matter.case_title,
      case_number: matter.case_number,
      court: matter.court,
      status: matter.status,
      type: matter.type,
      date: matter.date,
      matter_code: matter.matter_code,
    },
    files,
    schedule,
    filedDeliverables,
    statusReports,
    exhibits,
    fileRequests,
    teamMembers,
    nextEvent,
    timelineEvents,
    chatMessages,
    engagement,
  };
}

// ── What a client may open ────────────────────────────────────────────────

export interface PortalVisibleFileRow {
  notion_id: string;
  name: string;
  matter_id: string;
  deliverable_id: string | null;
  file_urls: FileUrlEntry[] | null;
}

const IN_BATCH = 100;

function chunks<T>(items: T[], size = IN_BATCH): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * The register rows the client's Files tab lists — every `files` row on the
 * client's matters (or on one of them, with `matterId`), less the working
 * copies of deliverables the client can't see. The download, sign and zip
 * routes build their allowlists from this, so a path is openable exactly when
 * the page shows it.
 */
export async function loadPortalVisibleFileRows(
  db: SupabaseClient,
  clientId: string,
  matterId?: string,
): Promise<{ rows: PortalVisibleFileRow[]; shownDeliverableIds: Set<string> }> {
  let mattersQuery = db.from('matters').select('notion_id').eq('client_id', clientId);
  if (matterId) mattersQuery = mattersQuery.eq('notion_id', matterId);
  const { data: matters } = await mattersQuery;
  const matterIds = (matters ?? []).map((m) => m.notion_id as string);
  if (matterIds.length === 0) return { rows: [], shownDeliverableIds: new Set() };

  const deliverableRows: { notion_id: string; type: string | null; status: string | null }[] = [];
  const fileRows: PortalVisibleFileRow[] = [];
  for (const batch of chunks(matterIds)) {
    const [{ data: delivs }, { data: files }] = await Promise.all([
      db.from('deliverables').select('notion_id, type, status').in('matter_id', batch),
      db
        .from('files')
        .select('notion_id, name, matter_id, deliverable_id, file_urls')
        .in('matter_id', batch),
    ]);
    deliverableRows.push(...((delivs ?? []) as typeof deliverableRows));
    fileRows.push(...((files ?? []) as PortalVisibleFileRow[]));
  }

  const shownDeliverableIds = new Set(
    deliverableRows.filter(isClientDeliverable).map((d) => d.notion_id),
  );
  return {
    rows: fileRows.filter((r) => isClientVisibleFileRow(r, shownDeliverableIds)),
    shownDeliverableIds,
  };
}

/**
 * Every storage path in the `files` bucket the client may open: the visible
 * register rows' attachments, the filed copy of each deliverable and sent
 * status report the client sees, and the company papers the team shares of
 * the companies the client is shown (never a person's file).
 */
export async function loadPortalVisiblePaths(
  db: SupabaseClient,
  clientId: string,
): Promise<Set<string>> {
  const { rows, shownDeliverableIds } = await loadPortalVisibleFileRows(db, clientId);
  const allowed = new Set<string>();
  for (const row of rows) {
    for (const u of row.file_urls ?? []) {
      if (u?.path) allowed.add(u.path);
    }
  }
  for (const batch of chunks([...shownDeliverableIds])) {
    const { data: versions } = await db
      .from('deliverable_files')
      .select('action, file_url')
      .in('deliverable_id', batch)
      .ilike('action', 'Filed version%');
    for (const v of (versions ?? []) as { action: string | null; file_url: string | null }[]) {
      if (isFiledVersion(v) && v.file_url && !v.file_url.startsWith('http')) allowed.add(v.file_url);
    }
  }
  const { companyIds } = await portalScope(db, clientId);
  for (const batch of chunks(companyIds)) {
    const { data: papers } = await db
      .from('corporation_files')
      .select('storage_path')
      .in('corporation_id', batch)
      .eq('client_visible', true)
      .is('person_id', null);
    for (const f of papers ?? []) {
      if (f.storage_path) allowed.add(f.storage_path as string);
    }
  }
  return allowed;
}
