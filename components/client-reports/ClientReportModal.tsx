'use client';

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, ArrowDown, ArrowUp, Download, FileText, Loader2, Mail, Paperclip, RefreshCw, Send, Upload, X } from 'lucide-react';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import SearchableSelect from '@/components/SearchableSelect';
import { MAX_ANNEXES, annexLabel, type CaptionRow } from '@/lib/client-reports/letter';
import ReportFileView, { reportTabClass } from '@/components/client-reports/ReportFileView';
import { formatDate } from '@/lib/format-date';

interface Preview {
  /** Whether the letter goes as a PDF; a firm without Word-to-PDF conversion sends the Word file. */
  pdf: boolean;
  /** The firm's mailbox the report goes from; blank when the firm has not set one. */
  from: string;
  eventDate: string;
  subject: string;
  message: string;
  caption: CaptionRow[];
  refNo: string;
  problems: string[];
  to: string[];
  addressee: string;
  /** Who the letter is to the attention of, when the record names a contact. */
  attention?: string;
  annexes: Annex[];
  files: ReportFile[];
}

/** A file's id on its record: a row id for a mark's files, a tagged string for a company's. */
type FileId = number | string;

/** A paper going with the report, in annex order, and what the letter calls it. */
interface Annex {
  fileId: FileId;
  document: string;
}

/** A paper on the record the report is about, to pick annexes from. */
export interface ReportFile {
  id: FileId;
  name: string;
  sizeBytes: number | null;
  /** Where it sits on the record — a step, a category — for the picker to say. */
  group: string | null;
  /** What the letter first calls it when picked. */
  document: string;
  /** A link to show it beside the letter. */
  url: string | null;
}

const megabytes = (n: number | null) => (n == null ? '' : `${(n / 1024 / 1024).toFixed(n < 1024 * 1024 ? 2 : 1)} MB`);

export interface SentClientReport {
  id: number;
  eventDate: string;
  sentAt: string;
  recipientEmail: string;
  ccEmails: string[];
  subject: string;
}

const INPUT =
  'w-full px-3 py-2 text-sm text-stone-800 dark:text-stone-100 bg-stone-50/80 dark:bg-white/5 border border-stone-200 dark:border-white/10 rounded-lg ' +
  'placeholder:text-stone-400 dark:placeholder:text-stone-500 focus:outline-none focus:ring-2 focus:ring-navy-400/20 focus:border-navy-400';
const LABEL = 'block text-[11px] font-semibold text-stone-400 dark:text-stone-500 uppercase tracking-wider mb-1.5';

const splitEmails = (s: string) => s.split(/[\s,;]+/).map((e) => e.trim()).filter(Boolean);

/**
 * Review and send a client report: on a step taken on a mark, a filing for a
 * company. The letter is built from the record; the person fills in only what
 * the record doesn't hold — who it is addressed to — and may reword the
 * covering email.
 *
 * The routes under `api` answer the same way for every kind of report: GET
 * for the draft, POST `/pdf`, `/docx` and `/send`, each given `report` — what
 * names the report (its event, and the item it is on) — in the query or body.
 */
export default function ClientReportModal({
  api, report, title, owner, groupLabel, uploadAnnex, onClose, onSent, onUseOwnPaper,
}: {
  /** e.g. `/api/trademark/<id>/client-report`. */
  api: string;
  /** Mount one per report (keyed by it), so each opens on a fresh draft. */
  report: Record<string, string>;
  title: string;
  /** What the record is called in the hints: "mark", "company". */
  owner: string;
  /** What the picker says a file's group is. */
  groupLabel: (group: string | null) => string;
  /** Upload a paper as an annex; it is kept on the record. */
  uploadAnnex: (file: File) => Promise<ReportFile>;
  onClose: () => void;
  onSent: (report: SentClientReport) => void;
  /** Send a letter the team wrote and saved as PDF instead, through the uploaded-report flow. */
  onUseOwnPaper?: () => void;
}) {
  const query = new URLSearchParams(report).toString();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [addressee, setAddressee] = useState('');
  const [attention, setAttention] = useState('');
  const [salutation, setSalutation] = useState('Dear Sir or Madam:');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [annexes, setAnnexes] = useState<Annex[]>([]);
  const [files, setFiles] = useState<ReportFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const annexInput = useRef<HTMLInputElement>(null);
  /** The email message as last generated: while the person hasn't reworded it, it follows the annexes. */
  const [generated, setGenerated] = useState({ message: '', annexKey: '' });
  /** A letter edited in Word, to send instead of the generated one. */
  const [edited, setEdited] = useState<{ name: string; base64: string } | null>(null);
  const editedInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<'download' | 'send' | null>(null);
  /** The letter as the client gets it: the PDF, rendered on the server. */
  const [pdf, setPdf] = useState<{ url: string; key: string } | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  /** Which file the preview shows: the letter, or an annex (by file id) as it will be attached. */
  const [showing, setShowing] = useState<{ fileId: FileId } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${api}?${query}`)
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setLoadError(data.error || 'Could not prepare the report');
          return;
        }
        const p = data as Preview;
        setPreview(p);
        setTo(p.to.join(', '));
        setAddressee(p.addressee);
        setAttention(p.attention ?? '');
        setSubject(p.subject);
        setMessage(p.message);
        setGenerated({ message: p.message, annexKey: JSON.stringify(p.annexes) });
        setAnnexes(p.annexes);
        setFiles(p.files);
      });
    return () => { cancelled = true; };
  }, [api, query]);

  const letter = { addressee, attention, salutation };
  const annexKey = JSON.stringify(annexes);
  /** What the PDF depends on; when it differs from the rendered one, the preview is out of date. */
  const letterKey = JSON.stringify([addressee, attention, salutation, annexKey, edited?.name ?? null, edited?.base64.length ?? 0]);

  // The email message names the annexes too: regenerate it when they change, unless the person has reworded it.
  const messageUntouched = message === generated.message;
  useEffect(() => {
    if (!preview || !messageUntouched || annexKey === generated.annexKey) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      fetch(`${api}?${query}&annexes=${encodeURIComponent(annexKey)}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((data: Preview | null) => {
          if (cancelled || !data) return;
          setGenerated({ message: data.message, annexKey });
          setMessage(data.message);
        });
    }, 400);
    return () => { cancelled = true; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [annexKey]);

  function addAnnex(file: ReportFile) {
    setAnnexes((prev) => (prev.some((a) => a.fileId === file.id) ? prev : [...prev, { fileId: file.id, document: file.document }]));
  }

  function moveAnnex(i: number, by: -1 | 1) {
    setAnnexes((prev) => {
      const next = [...prev];
      [next[i], next[i + by]] = [next[i + by], next[i]];
      return next;
    });
  }

  async function addUploaded(file: File) {
    if (file.size > 25 * 1024 * 1024) {
      toast.error(`${file.name} is over 25 MB`);
      return;
    }
    setUploading(true);
    try {
      const entry = await uploadAnnex(file);
      setFiles((prev) => [entry, ...prev]);
      addAnnex(entry);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : `Could not upload ${file.name}`);
    } finally {
      setUploading(false);
    }
  }
  const stale = !!pdf && pdf.key !== letterKey;
  /** The annexes that can be shown beside the letter, lettered as they will go. */
  const annexTabs = annexes.flatMap((a, i) => {
    const f = files.find((x) => x.id === a.fileId);
    return f?.url ? [{ fileId: f.id, label: annexLabel(i), name: f.name, url: f.url }] : [];
  });
  // An annex taken off the list while shown falls back to the letter.
  const shownAnnex = showing ? annexTabs.find((t) => t.fileId === showing.fileId) ?? null : null;

  async function loadPdf() {
    setPdfBusy(true);
    setPdfError(null);
    const key = letterKey;
    const res = await fetch(`${api}/pdf`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...report, letter, annexes, editedLetter: edited ?? undefined }),
    }).catch(() => null);
    setPdfBusy(false);
    if (!res?.ok) {
      const data = await res?.json().catch(() => ({}));
      setPdfError(data?.error || 'Could not render the letter');
      return;
    }
    const url = URL.createObjectURL(await res.blob());
    setPdf((prev) => {
      if (prev) URL.revokeObjectURL(prev.url);
      return { url, key };
    });
  }

  // First render once the report has loaded (the addressee comes with it), and again when an edited letter is picked or dropped.
  const editedKey = edited ? `${edited.name}:${edited.base64.length}` : '';
  useEffect(() => {
    if (preview?.pdf) void loadPdf();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview, editedKey]);

  useEffect(() => () => { if (pdf) URL.revokeObjectURL(pdf.url); }, [pdf]);

  async function download() {
    setBusy('download');
    const res = await fetch(`${api}/docx`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...report, letter, annexes }),
    });
    setBusy(null);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toast.error(data.error || 'Could not build the report');
      return;
    }
    const blob = await res.blob();
    const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? 'report.docx';
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }

  /** Download the letter, change it in Word, and pick it here: it goes instead of the generated one. */
  async function pickEdited(file: File) {
    if (!/\.docx$/i.test(file.name)) {
      toast.error('Pick the Word (.docx) file');
      return;
    }
    if (file.size > 3 * 1024 * 1024) {
      toast.error('The edited letter is over 3 MB');
      return;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    setEdited({ name: file.name, base64: btoa(binary) });
  }

  async function send() {
    if (!preview) return;
    const toList = splitEmails(to);
    if (toList.length === 0) {
      toast.error('Add at least one recipient');
      return;
    }
    setBusy('send');
    const res = await fetch(`${api}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...report, letter, to: toList, cc: splitEmails(cc), subject, message, annexes, editedLetter: edited ?? undefined }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) {
      toast.error(data.error || 'Could not send the report');
      return;
    }
    toast.success(`Report sent to ${toList.join(', ')}`);
    if (data.logError) toast.warning(`Sent, but not logged: ${data.logError}`);
    if (data.report) {
      const ccList = splitEmails(cc);
      onSent({
        id: data.report.id,
        eventDate: preview.eventDate,
        sentAt: data.report.sentAt,
        recipientEmail: toList[0],
        ccEmails: [...toList.slice(1), ...ccList],
        subject,
      });
    }
    onClose();
  }

  return (
    <Modal
      open
      onClose={onClose}
      dismissible={busy === null}
      size="xl"
      icon={<Mail className="w-4 h-4" />}
      title={title}
      description={preview ? `${formatDate(preview.eventDate)}${preview.from ? ` · sent from ${preview.from}` : ''}` : undefined}
      footer={
        <>
          <Button variant="outline" onClick={download} disabled={!preview || busy !== null}>
            {busy === 'download' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
            Download .docx
          </Button>
          <Button onClick={send} disabled={!preview || busy !== null}>
            {busy === 'send' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            Send report
          </Button>
        </>
      }
    >
      {loadError ? (
        <p className="text-sm text-red-600 dark:text-red-400">{loadError}</p>
      ) : !preview ? (
        <div className="h-40 rounded-xl bg-stone-100 dark:bg-white/5 animate-pulse" aria-busy />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
        <div className="space-y-4 min-w-0">
          {preview.problems.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-800 dark:border-amber-400/20 dark:bg-amber-400/10 dark:text-amber-200">
              <p className="flex items-center gap-1.5 font-medium"><AlertTriangle className="w-3.5 h-3.5" /> Fix on the {owner} first, or the report shows a blank</p>
              <ul className="mt-1 ml-5 list-disc space-y-0.5">
                {preview.problems.map((p) => <li key={p}>{p}</li>)}
              </ul>
            </div>
          )}

          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-xs rounded-xl border border-stone-200 dark:border-white/10 px-3.5 py-2.5">
            {[{ label: 'Ref. No.', value: preview.refNo }, ...preview.caption].map((r) => (
              <div key={r.label} className="contents">
                <dt className="text-stone-500 dark:text-stone-400">{r.label}</dt>
                <dd className={`text-stone-800 dark:text-stone-100 ${r.value.startsWith('[') ? 'text-amber-700 dark:text-amber-300' : ''}`}>{r.value}</dd>
              </div>
            ))}
          </dl>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block">
              <span className={LABEL}>To</span>
              <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="client@example.com" className={INPUT} />
            </label>
            <label className="block">
              <span className={LABEL}>Cc</span>
              <input value={cc} onChange={(e) => setCc(e.target.value)} placeholder="Optional" className={INPUT} />
            </label>
            <label className="block">
              <span className={LABEL}>Letter addressed to</span>
              <input value={addressee} onChange={(e) => setAddressee(e.target.value)} className={INPUT} />
            </label>
            <label className="block">
              <span className={LABEL}>Attention</span>
              <input value={attention} onChange={(e) => setAttention(e.target.value)} placeholder="Name at the client (optional)" className={INPUT} />
            </label>
            <label className="block sm:col-span-2">
              <span className={LABEL}>Salutation</span>
              <input value={salutation} onChange={(e) => setSalutation(e.target.value)} className={INPUT} />
            </label>
            <label className="block sm:col-span-2">
              <span className={LABEL}>Email subject</span>
              <input value={subject} onChange={(e) => setSubject(e.target.value)} className={INPUT} />
            </label>
            <label className="block sm:col-span-2">
              <span className={LABEL}>Email message</span>
              <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={4} className={`${INPUT} resize-y`} />
              <span className="mt-1 block text-[11px] text-stone-400 dark:text-stone-500">The caption above goes in the email too, with your name as the sender.</span>
            </label>
          </div>

          <div className="text-xs text-stone-600 dark:text-stone-300 space-y-1.5">
            {edited ? (
              <p className="flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5 text-stone-400" /> Your edited letter — {edited.name}
                <button type="button" onClick={() => setEdited(null)} className="text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 cursor-pointer" aria-label="Send the generated letter instead">
                  <X className="w-3.5 h-3.5" />
                </button>
              </p>
            ) : (
              <p className="flex items-center gap-1.5 flex-wrap">
                <FileText className="w-3.5 h-3.5 text-stone-400" /> The report, on the letterhead ({preview.pdf ? 'PDF' : '.docx'})
                <span className="text-stone-400 dark:text-stone-500">·</span>
                <button type="button" onClick={() => editedInput.current?.click()} className="inline-flex items-center gap-1 text-navy-700 dark:text-navy-300 hover:underline cursor-pointer">
                  <Upload className="w-3 h-3" /> Send an edited letter instead
                </button>
                {onUseOwnPaper && (
                  <>
                    <span className="text-stone-400 dark:text-stone-500">·</span>
                    <button type="button" onClick={onUseOwnPaper} className="inline-flex items-center gap-1 text-navy-700 dark:text-navy-300 hover:underline cursor-pointer">
                      <Upload className="w-3 h-3" /> Send your own PDF report
                    </button>
                  </>
                )}
              </p>
            )}
            <input
              ref={editedInput}
              type="file"
              accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) void pickEdited(f);
              }}
            />
          </div>

          <div className="space-y-2">
            <span className={LABEL}>Annexes</span>
            {annexes.length === 0 ? (
              <p className="text-xs text-amber-700 dark:text-amber-300">
                No annexes: the report goes alone. Add a paper from the {owner} or upload one.
              </p>
            ) : (
              <ol className="space-y-1.5">
                {annexes.map((a, i) => {
                  const f = files.find((x) => x.id === a.fileId);
                  return (
                    <li key={a.fileId} className="flex items-center gap-2 rounded-lg border border-stone-200 dark:border-white/10 px-2.5 py-1.5">
                      <span className="shrink-0 w-6 text-center text-xs font-semibold text-stone-500 dark:text-stone-400">“{annexLabel(i)}”</span>
                      <div className="min-w-0 flex-1">
                        <input
                          value={a.document}
                          onChange={(e) => setAnnexes((prev) => prev.map((x, j) => (j === i ? { ...x, document: e.target.value } : x)))}
                          aria-label={`What the letter calls Annex ${annexLabel(i)}`}
                          placeholder="the certificate"
                          className="w-full bg-transparent text-sm text-stone-800 dark:text-stone-100 focus:outline-none"
                        />
                        <p className="truncate text-[11px] text-stone-400 dark:text-stone-500">
                          {f?.name}{f?.sizeBytes != null ? ` · ${megabytes(f.sizeBytes)}` : ''}
                        </p>
                      </div>
                      <button type="button" disabled={i === 0} onClick={() => moveAnnex(i, -1)} aria-label="Move up"
                        className="p-1 text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 disabled:opacity-30 cursor-pointer disabled:cursor-default">
                        <ArrowUp className="w-3.5 h-3.5" />
                      </button>
                      <button type="button" disabled={i === annexes.length - 1} onClick={() => moveAnnex(i, 1)} aria-label="Move down"
                        className="p-1 text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 disabled:opacity-30 cursor-pointer disabled:cursor-default">
                        <ArrowDown className="w-3.5 h-3.5" />
                      </button>
                      <button type="button" onClick={() => setAnnexes((prev) => prev.filter((_, j) => j !== i))} aria-label={`Leave out Annex ${annexLabel(i)}`}
                        className="p-1 text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 cursor-pointer">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </li>
                  );
                })}
              </ol>
            )}
            {annexes.length < MAX_ANNEXES && (
              <div className="flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <SearchableSelect
                    options={files.filter((f) => !annexes.some((a) => a.fileId === f.id)).map((f) => ({
                      id: String(f.id), label: f.name, sublabel: groupLabel(f.group), hint: megabytes(f.sizeBytes),
                    }))}
                    value={null}
                    onChange={(id) => {
                      const f = files.find((x) => String(x.id) === id);
                      if (f) addAnnex(f);
                    }}
                    placeholder={`Add Annex “${annexLabel(annexes.length)}” from the ${owner}’s files…`}
                    searchPlaceholder={`Search the ${owner}’s files`}
                    aria-label={`Add an annex from the ${owner}’s files`}
                  />
                </div>
                <Button variant="outline" onClick={() => annexInput.current?.click()} disabled={uploading}>
                  {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Paperclip className="w-3.5 h-3.5" />}
                  Upload
                </Button>
                <input
                  ref={annexInput}
                  type="file"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    if (f) void addUploaded(f);
                  }}
                />
              </div>
            )}
            <p className="text-[11px] text-stone-400 dark:text-stone-500">
              The letter names each annex in the words above. An uploaded paper is kept in the {owner}’s files.
              {!messageUntouched && ' You reworded the email, so check that it names the annexes.'}
            </p>
          </div>
        </div>

        <div className="space-y-2 min-w-0 lg:sticky lg:top-0">
          <div className="flex items-center justify-between gap-2">
            {annexTabs.length > 0 ? (
              <div className="flex items-center gap-1 flex-wrap">
                <button type="button" onClick={() => setShowing(null)} className={reportTabClass(!shownAnnex)}>
                  <FileText className="w-3.5 h-3.5 shrink-0" /> Letter
                </button>
                {annexTabs.map((t) => (
                  <button key={t.fileId} type="button" onClick={() => setShowing({ fileId: t.fileId })} className={reportTabClass(shownAnnex?.fileId === t.fileId)} title={t.name}>
                    <FileText className="w-3.5 h-3.5 shrink-0" /> <span className="truncate">Annex “{t.label}”</span>
                  </button>
                ))}
              </div>
            ) : (
              <span className={LABEL + ' mb-0'}>Letter preview</span>
            )}
            {!shownAnnex && stale && !pdfBusy && (
              <button type="button" onClick={() => void loadPdf()} className="inline-flex items-center gap-1 text-xs text-navy-700 dark:text-navy-300 hover:underline cursor-pointer">
                <RefreshCw className="w-3 h-3" /> Update preview
              </button>
            )}
          </div>
          {shownAnnex ? (
            <div className="h-[60vh] min-h-[360px] overflow-y-auto rounded-xl border border-stone-200 dark:border-white/10 bg-stone-100 dark:bg-white/5">
              <ReportFileView url={shownAnnex.url} name={shownAnnex.name} />
            </div>
          ) : (
          <div className="relative h-[60vh] min-h-[360px] rounded-xl border border-stone-200 dark:border-white/10 bg-stone-100 dark:bg-white/5 overflow-hidden">
            {!preview.pdf && (
              <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-xs text-stone-500 dark:text-stone-400">
                The letter goes as a Word file. Download it to look it over before sending.
              </div>
            )}
            {pdf && (
              <div className={`h-full overflow-y-auto ${pdfBusy || stale ? 'opacity-50' : ''}`}>
                <iframe key={pdf.url} src={pdf.url} title="Letter preview" className="w-full h-full border-0" />
              </div>
            )}
            {pdfBusy && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-xs text-stone-500 dark:text-stone-400">
                <Loader2 className="w-5 h-5 animate-spin" /> Rendering the PDF…
              </div>
            )}
            {pdfError && !pdfBusy && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center text-xs text-red-600 dark:text-red-400">
                {pdfError}
                <button type="button" onClick={() => void loadPdf()} className="text-navy-700 dark:text-navy-300 hover:underline cursor-pointer">Try again</button>
              </div>
            )}
          </div>
          )}
        </div>
        </div>
      )}
    </Modal>
  );
}
