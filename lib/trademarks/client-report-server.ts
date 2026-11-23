import { NextResponse } from 'next/server';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { TRADEMARK_SELECT, rowToTrademark } from '@/lib/trademark-row';
import { manilaToday } from '@/lib/dates';
import type { Trademark, TrademarkFileStep } from '@/types/notion';
import { reportDocx as sharedReportDocx, safeFileStem } from '@/lib/client-reports/server';
import { wordingFrom } from './report-wording';
import { attachmentName, isReportUpload, reportFolder } from './report-attachments';
import {
  REPORT_EVENTS, annexDocumentFor, buildClientReport, reportSpec, roundFor, type ClientReport, type ReportEvent,
} from './client-report';
import { annexLabel, type ReportLetterFields } from '@/lib/client-reports/letter';
import { ROUND_STEPS } from './file-steps';

/** A paper on the mark, as the annex picker lists it. */
export interface MarkFile {
  id: number;
  name: string;
  storagePath: string;
  mimeType: string | null;
  sizeBytes: number | null;
  step: TrademarkFileStep | null;
}

export interface ReportAnnex extends MarkFile {
  /** "A", "B", … */
  label: string;
  /** What the letter calls it: "the Office Action". */
  document: string;
}

/** The papers the person picked to go with the report, in annex order. */
export type AnnexChoice = { fileId: number; document: string }[];

export interface LoadedReport {
  trademark: Trademark;
  report: ClientReport;
  annexes: ReportAnnex[];
  /** Every paper on the mark, newest first, to pick annexes from. */
  files: MarkFile[];
}

/**
 * The mark, its report for `event`, and the papers that go with it: those the
 * person picked, or by default the newest paper filed under the step, as Annex "A".
 * The mark is read on the person's own JWT, so a mark they can't see is
 * not found; its files and the signatory's position are read after that.
 */
export async function loadClientReport(
  firmId: string,
  trademarkId: string,
  event: ReportEvent,
  personId: string,
  letter?: ReportLetterFields,
  annexChoice?: AnnexChoice,
): Promise<LoadedReport | 'not_found' | 'not_recorded' | 'unknown_annex'> {
  const authed = await getSupabaseServerAuthClient();
  const { data: row } = await authed.from('trademarks').select(TRADEMARK_SELECT).eq('id', trademarkId).maybeSingle();
  if (!row) return 'not_found';
  const trademark = rowToTrademark(row);
  if (!REPORT_EVENTS[event].date(trademark)) return 'not_recorded';

  const service = getServiceDbForFirm(firmId);
  const [{ data: files }, { data: me }, { data: saved }] = await Promise.all([
    service.from('trademark_files')
      .select('id, name, storage_path, mime_type, size_bytes, step, office_action_id')
      .eq('trademark_id', trademarkId)
      .order('uploaded_at', { ascending: false }),
    service.from('team').select('name, position').eq('person_id', personId).maybeSingle(),
    authed.from('trademark_report_wording').select('key, body'),
  ]);
  const markFiles: MarkFile[] = (files ?? []).map((f) => ({
    id: f.id, name: f.name, storagePath: f.storage_path, mimeType: f.mime_type ?? null, sizeBytes: f.size_bytes ?? null, step: f.step ?? null,
  }));
  // A round's paper is that round's: the report on one Office Action never annexes another's.
  const round = roundFor(trademark, event);
  const fileStep = REPORT_EVENTS[event].fileStep;
  const stepPaperId = (files ?? []).find((f) =>
    f.step === fileStep && (!round || !ROUND_STEPS.has(fileStep) || f.office_action_id === round.id))?.id;
  const stepPaper = markFiles.find((f) => f.id === stepPaperId);
  const choice: AnnexChoice = annexChoice
    ?? (stepPaper ? [{ fileId: stepPaper.id, document: reportSpec(trademark, event).annexDocument }] : []);
  const annexes: ReportAnnex[] = [];
  for (const [i, c] of choice.entries()) {
    const f = markFiles.find((m) => m.id === c.fileId);
    if (!f) return 'unknown_annex';
    annexes.push({ ...f, label: annexLabel(i), document: c.document.trim() || annexDocumentFor(f, trademark) });
  }

  const report = buildClientReport(trademark, event, {
    today: manilaToday(),
    signatory: { name: me?.name ?? '', position: me?.position ?? null },
    letter,
    annexes: annexes.map((a) => a.document),
    wording: wordingFrom(saved ?? []),
  });
  return { trademark, report, annexes, files: markFiles };
}

/** The report on the firm's letterhead (lib/client-reports/server.ts). */
export function reportDocx(firmId: string, report: ClientReport): Promise<Buffer> {
  return sharedReportDocx(firmId, report.paragraphs);
}

/** The answer a route gives when there is no report to load. */
export function noReport(reason: 'not_found' | 'not_recorded' | 'unknown_annex'): NextResponse {
  if (reason === 'not_found') return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (reason === 'unknown_annex') return NextResponse.json({ error: 'An annex is not among this mark’s files' }, { status: 400 });
  return NextResponse.json({ error: 'That step is not recorded on this mark' }, { status: 409 });
}

export function reportFileName(t: Trademark, event: ReportEvent, eventDate: string, ext: 'docx' | 'pdf' = 'docx'): string {
  return `${safeFileStem(t.mark || 'mark')}-${safeFileStem(REPORT_EVENTS[event].label)}-${eventDate}.${ext}`;
}

const MAX_EDITED_BYTES = 3 * 1024 * 1024;

/**
 * The mark, read on the person's JWT so one they can't see is not found, and
 * who they are for the email's signature block, with that JWT's client for
 * any further check.
 */
export async function loadMarkForUploadedReport(
  firmId: string,
  trademarkId: string,
  personId: string,
): Promise<{
  trademark: Trademark;
  sender: { name: string; position: string | null };
  authed: Awaited<ReturnType<typeof getSupabaseServerAuthClient>>;
} | null> {
  const authed = await getSupabaseServerAuthClient();
  const { data: row } = await authed.from('trademarks').select(TRADEMARK_SELECT).eq('id', trademarkId).maybeSingle();
  if (!row) return null;
  const { data: me } = await getServiceDbForFirm(firmId).from('team').select('name, position').eq('person_id', personId).maybeSingle();
  return { trademark: rowToTrademark(row), sender: { name: me?.name ?? '', position: me?.position ?? null }, authed };
}

/**
 * Report files the person uploaded, checked to be this mark's and present in
 * storage. Read one at a time: each storage request holds a pooler connection.
 * With `read`, their bytes come back too, for attaching to an email.
 */
export async function readReportUploads(
  firmId: string,
  trademarkId: string,
  paths: string[],
  { read }: { read: boolean },
): Promise<{ files: { path: string; name: string; content: Buffer | null }[] } | { error: string; status: number }> {
  const service = getServiceDbForFirm(firmId);
  const folder = reportFolder(firmId, trademarkId);
  const files: { path: string; name: string; content: Buffer | null }[] = [];
  for (const path of [...new Set(paths)]) {
    if (!isReportUpload(firmId, trademarkId, path)) return { error: 'A file does not belong to this mark', status: 400 };
    const name = attachmentName(path);
    if (read) {
      const { data, error } = await service.storage.from('files').download(path);
      if (error || !data) return { error: `${name} did not finish uploading. Remove it and add it again.`, status: 409 };
      files.push({ path, name, content: Buffer.from(await data.arrayBuffer()) });
    } else {
      const object = path.slice(folder.length + 1);
      const { data: listed } = await service.storage.from('files').list(folder, { search: object });
      if (!listed?.some((o) => o.name === object)) return { error: `${name} did not finish uploading. Remove it and add it again.`, status: 409 };
      files.push({ path, name, content: null });
    }
  }
  return { files };
}
