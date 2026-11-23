import { NextResponse } from 'next/server';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { manilaToday } from '@/lib/dates';
import { CLOSED_STATUSES } from '@/lib/deliverable-status';
import { pgInList } from '@/lib/postgrest';
import { rowToCorporation, rowToCorporationMeeting, rowToResolution } from '@/lib/corporation-row';
import { CORPORATION_SELECT } from '@/lib/corporations/matter-links';
import { annexLabel, fileDocumentName, type ReportLetterFields } from '@/lib/client-reports/letter';
import { safeFileStem } from '@/lib/client-reports/server';
import type { Corporation } from '@/types/corporations';
import { OBLIGATIONS, companyName } from './obligations';
import {
  CORPORATE_REPORT_EVENTS, ITEM_EVENTS, buildCorporateReport, contactName,
  type ComplianceItem, type CorporateClientReport, type CorporateReportContext, type CorporateReportEvent,
} from './client-report';

/**
 * A paper on the company that can go with a report. Ids say where it is kept:
 * `c:<id>` a company file, `d:<id>` a version of a compliance deliverable,
 * `m:<meeting>:<slot>` a meeting's paper, `r:<resolution>:<signed|generated>`
 * a resolution's.
 */
export interface CompanyFile {
  id: string;
  name: string;
  storagePath: string;
  sizeBytes: number | null;
  /** The file's category, or what it is on the item. */
  group: string;
  /** What the letter first calls it. */
  document: string;
}

export interface CompanyReportAnnex extends CompanyFile {
  label: string;
}

export type CompanyAnnexChoice = { fileId: string; document: string }[];

export interface LoadedCorporateReport {
  corporation: Corporation;
  context: CorporateReportContext;
  report: CorporateClientReport;
  annexes: CompanyReportAnnex[];
  files: CompanyFile[];
  /** Who sends and signs off the letter: the person preparing it. */
  signer: { name: string; position: string | null };
  /** Who it goes to by default: the company's contact. */
  to: string[];
  attention: string;
}

type Reason = 'not_found' | 'not_recorded' | 'unknown_annex' | 'no_item';

const COMPLIANCE_COLUMNS = 'notion_id, name, type, status, external_due_date, date_done, matter_id';

/** The deliverable types the company's compliance filings carry (GIS, AFS, the BIR returns). */
export const COMPLIANCE_TYPES = [...new Set(Object.values(OBLIGATIONS).flatMap((o) => (o.deliverableType ? [o.deliverableType] : [])))];
const toItem = (r: Record<string, unknown>): ComplianceItem => ({
  id: r.notion_id as string,
  name: (r.name as string) ?? '',
  type: (r.type as string | null) ?? null,
  status: (r.status as string) ?? '',
  dueDate: (r.external_due_date as string | null) ?? null,
  doneOn: (r.date_done as string | null) ?? null,
});

const MEETING_SLOTS: { slot: string; column: string; name: string; document: string }[] = [
  { slot: 'minutes', column: 'minutes_file_path', name: 'Minutes', document: 'the minutes of the meeting' },
  { slot: 'attendance', column: 'attendance_sheet_path', name: 'Attendance sheet', document: 'the attendance sheet' },
  { slot: 'notice', column: 'notice_file_path', name: 'Notice of meeting', document: 'the notice of the meeting' },
  { slot: 'waiver', column: 'waiver_of_notice_file_path', name: 'Waiver of notice', document: 'the waiver of notice' },
];

const fileName = (path: string) => path.split('/').pop()?.replace(/^\d+[-_]/, '') ?? path;

/**
 * The company, its report for `event` (on `itemId` for an item's report), and
 * the papers that go with it: those the person picked, or by default the
 * event's own paper as Annex "A". The company and the item are read on the
 * person's JWT, so one they can't see is not found; the files, the matter's
 * code and the signer after that, on the firm-scoped service client.
 */
export async function loadCorporateReport(
  firmId: string,
  corporationId: string,
  event: CorporateReportEvent,
  itemId: string | null | undefined,
  personId: string,
  letter?: ReportLetterFields,
  annexChoice?: CompanyAnnexChoice,
): Promise<LoadedCorporateReport | Reason> {
  const authed = await getSupabaseServerAuthClient();
  const { data: row } = await authed.from('corporations').select(CORPORATION_SELECT).eq('id', corporationId).maybeSingle();
  if (!row) return 'not_found';
  const corporation = rowToCorporation(row);
  if (ITEM_EVENTS.has(event) !== !!itemId) return 'no_item';

  const today = manilaToday();
  const [item, { data: upcomingRows }] = await Promise.all([
    loadItem(authed, corporationId, event, itemId ?? null),
    authed.from('deliverables').select(COMPLIANCE_COLUMNS)
      .eq('subject_id', corporationId).in('type', COMPLIANCE_TYPES)
      .not('status', 'in', pgInList(CLOSED_STATUSES))
      .gte('external_due_date', today)
      .order('external_due_date', { ascending: true }).limit(6),
  ]);
  if (item === 'no_item') return 'no_item';

  const service = getServiceDbForFirm(firmId);
  const matterId = (item.compliance && item.matterId) || corporation.effectiveBillingMatterId;
  const clientId = corporation.clientId ?? corporation.engagingClientId;
  const [{ data: matter }, { data: client }, { data: companyFiles }, { data: versions }, { data: me }] = await Promise.all([
    matterId ? service.from('matters').select('matter_code').eq('notion_id', matterId).maybeSingle() : Promise.resolve({ data: null }),
    clientId ? service.from('clients').select('name, client_code').eq('notion_id', clientId).maybeSingle() : Promise.resolve({ data: null }),
    service.from('corporation_files').select('id, name, category, storage_path, size_bytes')
      .eq('corporation_id', corporationId).is('person_id', null).order('uploaded_at', { ascending: false }),
    item.compliance
      ? service.from('deliverable_files').select('id, file_name, file_url, file_size, version')
        .eq('deliverable_id', item.compliance.id).order('version', { ascending: false }).limit(5)
      : Promise.resolve({ data: [] }),
    service.from('team').select('name, position').eq('person_id', personId).maybeSingle(),
  ]);
  const signer = { name: (me?.name as string | undefined) ?? '', position: (me?.position as string | null | undefined) ?? null };

  const files: CompanyFile[] = [
    ...(versions ?? []).map((v: Record<string, unknown>): CompanyFile => ({
      id: `d:${v.id}`, name: v.file_name as string, storagePath: v.file_url as string, sizeBytes: (v.file_size as number | null) ?? null,
      group: `This filing — version ${v.version}`, document: CORPORATE_REPORT_EVENTS.compliance.annexDocument,
    })),
    ...item.papers,
    ...(companyFiles ?? []).map((f: Record<string, unknown>): CompanyFile => ({
      id: `c:${f.id}`, name: f.name as string, storagePath: f.storage_path as string, sizeBytes: (f.size_bytes as number | null) ?? null,
      group: f.category as string, document: annexDocumentForCategory(event, f.category as string, f.name as string),
    })),
  ];

  const spec = CORPORATE_REPORT_EVENTS[event];
  const context: CorporateReportContext = {
    corporation,
    clientName: (client?.name as string | undefined) ?? '',
    refNo: (matter?.matter_code as string | undefined) ?? (client?.client_code != null ? String(client.client_code) : ''),
    upcoming: (upcomingRows ?? []).map(toItem),
    compliance: item.compliance ?? undefined,
    meeting: item.meeting ?? undefined,
    resolution: item.resolution ?? undefined,
  };
  if (!spec.date(context)) return 'not_recorded';

  const own = files.find((f) => f.id.startsWith('d:') || f.id.startsWith('m:') || f.id.startsWith('r:'))
    ?? files.find((f) => f.id.startsWith('c:') && spec.annexCategories.includes(f.group));
  const choice: CompanyAnnexChoice = annexChoice ?? (own ? [{ fileId: own.id, document: own.document }] : []);
  const annexes: CompanyReportAnnex[] = [];
  for (const [i, c] of choice.entries()) {
    const f = files.find((x) => x.id === c.fileId);
    if (!f) return 'unknown_annex';
    annexes.push({ ...f, label: annexLabel(i), document: c.document.trim() || f.document });
  }

  const report = buildCorporateReport(context, event, {
    today,
    signatory: signer,
    letter,
    annexes: annexes.map((a) => a.document),
  });
  const to = [corporation.officialEmail, corporation.alternateEmail].map((e) => e?.trim()).filter((e): e is string => !!e);
  return { corporation, context, report, annexes, files, signer, to: to.slice(0, 1), attention: contactName(corporation) };
}

/** What the letter calls a company file: the event's own paper in its words, else the file's name. */
function annexDocumentForCategory(event: CorporateReportEvent, category: string, name: string): string {
  const spec = CORPORATE_REPORT_EVENTS[event];
  if (spec.annexCategories.includes(category)) return spec.annexDocument;
  const owner = Object.values(CORPORATE_REPORT_EVENTS).find((s) => s.annexCategories.includes(category));
  return owner?.annexDocument ?? fileDocumentName(name);
}

type LoadedItem = {
  compliance: ComplianceItem | null;
  matterId: string | null;
  meeting: ReturnType<typeof rowToCorporationMeeting> | null;
  resolution: ReturnType<typeof rowToResolution> | null;
  papers: CompanyFile[];
};

async function loadItem(
  authed: Awaited<ReturnType<typeof getSupabaseServerAuthClient>>,
  corporationId: string,
  event: CorporateReportEvent,
  itemId: string | null,
): Promise<LoadedItem | 'no_item'> {
  const none: LoadedItem = { compliance: null, matterId: null, meeting: null, resolution: null, papers: [] };
  if (!itemId) return none;
  if (event === 'compliance') {
    const { data } = await authed.from('deliverables').select(COMPLIANCE_COLUMNS)
      .eq('notion_id', itemId).eq('subject_id', corporationId).in('type', COMPLIANCE_TYPES).maybeSingle();
    return data ? { ...none, compliance: toItem(data), matterId: (data.matter_id as string | null) ?? null } : 'no_item';
  }
  if (event === 'meeting') {
    const { data } = await authed.from('corporation_meetings').select('*').eq('id', itemId).eq('corporation_id', corporationId).maybeSingle();
    if (!data) return 'no_item';
    const papers = MEETING_SLOTS.flatMap((s): CompanyFile[] => {
      const path = data[s.column] as string | null;
      return path ? [{ id: `m:${itemId}:${s.slot}`, name: fileName(path), storagePath: path, sizeBytes: null, group: `This meeting — ${s.name}`, document: s.document }] : [];
    });
    return { ...none, meeting: rowToCorporationMeeting(data), papers };
  }
  const { data } = await authed.from('resolutions').select('*').eq('id', itemId).eq('corporation_id', corporationId).maybeSingle();
  if (!data) return 'no_item';
  const resolution = rowToResolution(data);
  const what = resolution.kind === 'Secretarys Certificate' ? 'the signed Secretary’s Certificate' : 'the signed resolution';
  const papers: CompanyFile[] = [
    ...(resolution.signedFilePath ? [{ id: `r:${itemId}:signed`, name: fileName(resolution.signedFilePath), storagePath: resolution.signedFilePath, sizeBytes: null, group: 'This resolution — signed', document: what }] : []),
    ...(resolution.generatedFilePath ? [{ id: `r:${itemId}:generated`, name: fileName(resolution.generatedFilePath), storagePath: resolution.generatedFilePath, sizeBytes: null, group: 'This resolution — as generated', document: what.replace('signed ', '') }] : []),
  ];
  return { ...none, resolution, papers };
}

/** The answer a route gives when there is no report to load. */
export function noCorporateReport(reason: Reason): NextResponse {
  if (reason === 'not_found') return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (reason === 'no_item') return NextResponse.json({ error: 'That item is not on this company' }, { status: 404 });
  if (reason === 'unknown_annex') return NextResponse.json({ error: 'An annex is not among this company’s files' }, { status: 400 });
  return NextResponse.json({ error: 'That is not recorded on this company yet' }, { status: 409 });
}

export function corporateReportFileName(loaded: Pick<LoadedCorporateReport, 'corporation' | 'report'>, ext: 'docx' | 'pdf' = 'docx'): string {
  const { corporation, report } = loaded;
  return `${safeFileStem(companyName(corporation) || 'company')}-${safeFileStem(CORPORATE_REPORT_EVENTS[report.event].label)}-${report.eventDate}.${ext}`;
}
