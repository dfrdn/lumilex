'use client';

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ChevronDown, FileText, Loader2, Mail, Paperclip, Send, Upload, X } from 'lucide-react';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import CellDropdown from '@/components/admin/CellDropdown';
import DatePickerInput from '@/components/DatePickerInput';
import ReportFileView, { reportTabClass } from '@/components/client-reports/ReportFileView';
import { uploadToSignedUrl } from '@/lib/upload';
import { manilaToday } from '@/lib/dates';
import { formatDate } from '@/lib/format-date';
import { REPORT_EVENTS, markReportSubject, type ReportEvent } from '@/lib/trademarks/client-report';
import { isClosed } from '@/lib/deliverable-status';
import type { Trademark } from '@/types/notion';

const INPUT =
  'w-full px-3 py-2 text-sm text-stone-800 dark:text-stone-100 bg-stone-50/80 dark:bg-white/5 border border-stone-200 dark:border-white/10 rounded-lg ' +
  'placeholder:text-stone-400 dark:placeholder:text-stone-500 focus:outline-none focus:ring-2 focus:ring-navy-400/20 focus:border-navy-400';
const LABEL = 'block text-[11px] font-semibold text-stone-400 dark:text-stone-500 uppercase tracking-wider mb-1.5';
const OTHER = 'other';
const NONE = 'none';
const MAX_BYTES = 25 * 1024 * 1024;

const splitEmails = (s: string) => s.split(/[\s,;]+/).map((e) => e.trim()).filter(Boolean);

interface PickedFile {
  key: string;
  name: string;
  /** Shown in the preview from the browser's own copy, so nothing waits on storage. */
  localUrl: string;
  /** Set once the file is in the mark's report folder. */
  path: string | null;
  failed: boolean;
}

/**
 * A client report on the team's own paper. `send` emails the uploaded files
 * as they are from the firm’s trademark mailbox with the firm's covering email; `record` logs a
 * report that already went out by other means, with the files that went.
 * Either is on one of the mark's steps — which then is no longer owed — or
 * under a title of its own. It can be one of the mark's status reports, which
 * then links to it and is marked sent out.
 */
export default function UploadedReportModal({
  mode, trademark: t, steps, initialEvent, statusReports = [], onClose, onDone,
}: {
  mode: 'send' | 'record';
  trademark: Trademark;
  /** The mark's recorded steps a report can be on. */
  steps: { event: ReportEvent; date: string }[];
  initialEvent?: ReportEvent | null;
  /** The status report deliverables on the mark's page, to say which one this report is. */
  statusReports?: { id: string; name: string; status: string }[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [about, setAbout] = useState<string>(initialEvent ?? steps[steps.length - 1]?.event ?? OTHER);
  const [title, setTitle] = useState('');
  const [aboutOpen, setAboutOpen] = useState(false);
  const aboutRef = useRef<HTMLButtonElement>(null);
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [tab, setTab] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const [to, setTo] = useState(t.contactEmail ?? '');
  const [cc, setCc] = useState('');
  const [salutation, setSalutation] = useState('Dear Sir or Madam:');
  const [message, setMessage] = useState('Please find attached our report on the above trademark.');
  const [sentOn, setSentOn] = useState<string | null>(manilaToday());
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [deliverableId, setDeliverableId] = useState<string>(NONE);
  const [deliverableOpen, setDeliverableOpen] = useState(false);
  const deliverableRef = useRef<HTMLButtonElement>(null);
  const linked = statusReports.find((d) => d.id === deliverableId) ?? null;

  const event = about === OTHER ? null : (about as ReportEvent);
  const reportName = event ? REPORT_EVENTS[event].subjectName : title.trim() || 'Report';
  const [subject, setSubject] = useState(() => markReportSubject(t, reportName));
  const [subjectEdited, setSubjectEdited] = useState(false);
  useEffect(() => {
    if (!subjectEdited) setSubject(markReportSubject(t, reportName));
  }, [reportName, subjectEdited, t]);

  const urls = useRef<string[]>([]);
  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), []);

  async function add(list: File[]) {
    for (const file of list) {
      if (file.size > MAX_BYTES) {
        toast.error(`${file.name} is over 25 MB`);
        continue;
      }
      const key = `${file.name}:${file.size}:${Date.now()}:${Math.random()}`;
      const localUrl = URL.createObjectURL(file);
      urls.current.push(localUrl);
      setFiles((prev) => [...prev, { key, name: file.name, localUrl, path: null, failed: false }]);
      try {
        const res = await fetch(`/api/trademark/${t.id}/reports/upload`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: file.name, size: file.size }),
        });
        const prep = await res.json().catch(() => ({}));
        if (!res.ok || !prep.signedUrl) throw new Error(prep.error || `Could not upload ${file.name}`);
        await uploadToSignedUrl(prep.signedUrl, file, { name: file.name, size: file.size, type: file.type });
        setFiles((prev) => prev.map((f) => (f.key === key ? { ...f, path: prep.storagePath } : f)));
      } catch (e) {
        toast.error(e instanceof Error ? e.message : `Could not upload ${file.name}`);
        setFiles((prev) => prev.map((f) => (f.key === key ? { ...f, failed: true } : f)));
      }
    }
  }

  function remove(key: string) {
    setFiles((prev) => prev.filter((f) => f.key !== key));
    setTab(0);
  }

  /** The first file is the letter; the rest go as its annexes. */
  function makeLetter(key: string) {
    setFiles((prev) => [...prev.filter((f) => f.key === key), ...prev.filter((f) => f.key !== key)]);
    setTab(0);
  }

  const uploading = files.some((f) => !f.path && !f.failed);
  const ready = files.filter((f) => f.path);

  async function submit() {
    if (about === OTHER && !title.trim()) {
      toast.error('Give the report a title');
      return;
    }
    if (ready.length === 0) {
      toast.error(mode === 'send' ? 'Add the report to send' : 'Add the report as it was sent');
      return;
    }
    const base = {
      ...(event ? { event } : { title: title.trim() }),
      paths: ready.map((f) => f.path),
      ...(linked ? { deliverableId: linked.id } : {}),
    };
    let body: Record<string, unknown>;
    if (mode === 'send') {
      const toList = splitEmails(to);
      if (toList.length === 0) {
        toast.error('Add at least one recipient');
        return;
      }
      body = { ...base, to: toList, cc: splitEmails(cc), subject, message, salutation };
    } else {
      if (!sentOn) {
        toast.error('Say when it was sent');
        return;
      }
      body = { ...base, sentOn, sentTo: to.trim(), subject, notes: notes.trim() || undefined };
    }
    setBusy(true);
    const res = await fetch(`/api/trademark/${t.id}/reports${mode === 'send' ? '/send' : ''}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => null);
    const data = await res?.json().catch(() => ({}));
    setBusy(false);
    if (!res?.ok) {
      toast.error(data?.error || (mode === 'send' ? 'Could not send the report' : 'Could not record the report'));
      return;
    }
    if (mode === 'send') {
      toast.success(`Report sent to ${splitEmails(to).join(', ')}`);
      if (data.logError) toast.warning(`Sent, but not logged: ${data.logError}`);
    } else {
      toast.success('Report recorded');
    }
    if (linked && data.statusError) toast.warning(`${linked.name} ${data.statusError}`);
    onDone();
    onClose();
  }

  const aboutLabel = event ? `${REPORT_EVENTS[event].label} · ${formatDate(steps.find((s) => s.event === event)?.date ?? '')}` : 'Something else';
  const shown = files[tab] ?? null;

  return (
    <Modal
      open
      onClose={onClose}
      dismissible={!busy}
      size="xl"
      icon={mode === 'send' ? <Mail className="w-4 h-4" /> : <Paperclip className="w-4 h-4" />}
      title={mode === 'send' ? 'Send your own report' : 'Record a report sent elsewhere'}
      description={mode === 'send' ? 'Your files go as they are, from the firm’s trademark mailbox, with the firm’s covering email.' : 'Nothing is sent. The report is logged on the mark with its files.'}
      footer={
        <Button onClick={submit} disabled={busy || uploading}>
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : mode === 'send' ? <Send className="w-3.5 h-3.5" /> : <Paperclip className="w-3.5 h-3.5" />}
          {uploading ? 'Uploading…' : mode === 'send' ? 'Send report' : 'Record report'}
        </Button>
      }
    >
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
        <div className="space-y-3 min-w-0">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className={about === OTHER ? '' : 'sm:col-span-2'}>
              <span className={LABEL}>Report on</span>
              <button ref={aboutRef} type="button" onClick={() => setAboutOpen((o) => !o)} className={`${INPUT} flex items-center justify-between text-left cursor-pointer`}>
                <span className="truncate">{aboutLabel}</span>
                <ChevronDown className="w-3.5 h-3.5 opacity-60 shrink-0" />
              </button>
              {aboutOpen && (
                <CellDropdown
                  mode="single"
                  value={about}
                  options={[
                    ...steps.map((s) => ({ id: s.event, label: REPORT_EVENTS[s.event].label, sublabel: formatDate(s.date) })),
                    { id: OTHER, label: 'Something else', sublabel: 'Give it a title' },
                  ]}
                  onSelect={(id) => {
                    setAboutOpen(false);
                    if (id) setAbout(id);
                  }}
                  onClose={() => setAboutOpen(false)}
                  anchorRef={aboutRef}
                />
              )}
            </div>
            {about === OTHER && (
              <label className="block">
                <span className={LABEL}>Title</span>
                <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Status Report" className={INPUT} />
              </label>
            )}

            {statusReports.length > 0 && (
              <div className="sm:col-span-2">
                <span className={LABEL}>Status report</span>
                <button ref={deliverableRef} type="button" onClick={() => setDeliverableOpen((o) => !o)} className={`${INPUT} flex items-center justify-between text-left cursor-pointer`}>
                  <span className="truncate">{linked ? linked.name : 'Not a status report'}</span>
                  <ChevronDown className="w-3.5 h-3.5 opacity-60 shrink-0" />
                </button>
                {deliverableOpen && (
                  <CellDropdown
                    mode="single"
                    value={deliverableId}
                    options={[
                      ...statusReports.map((d) => ({ id: d.id, label: d.name, sublabel: d.status })),
                      { id: NONE, label: 'Not a status report' },
                    ]}
                    onSelect={(id) => {
                      setDeliverableOpen(false);
                      if (id) setDeliverableId(id);
                    }}
                    onClose={() => setDeliverableOpen(false)}
                    anchorRef={deliverableRef}
                  />
                )}
                {linked && !isClosed(linked.status) && (
                  <span className="mt-1 block text-[11px] text-stone-400 dark:text-stone-500">
                    {mode === 'send' ? 'It is marked sent out today, when the report goes.' : 'It is marked sent out on the day above.'}
                  </span>
                )}
              </div>
            )}

            {mode === 'record' ? (
              <>
                <div>
                  <span className={LABEL}>Sent on</span>
                  <DatePickerInput value={sentOn} onChange={setSentOn} />
                </div>
                <label className="block">
                  <span className={LABEL}>Sent to</span>
                  <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="Who it went to (optional)" className={INPUT} />
                </label>
              </>
            ) : (
              <>
                <label className="block">
                  <span className={LABEL}>To</span>
                  <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="client@example.com" className={INPUT} />
                </label>
                <label className="block">
                  <span className={LABEL}>Cc</span>
                  <input value={cc} onChange={(e) => setCc(e.target.value)} placeholder="Optional" className={INPUT} />
                </label>
              </>
            )}
            <label className="block sm:col-span-2">
              <span className={LABEL}>{mode === 'send' ? 'Email subject' : 'Subject'}</span>
              <input value={subject} onChange={(e) => { setSubject(e.target.value); setSubjectEdited(true); }} className={INPUT} />
            </label>
            {mode === 'send' ? (
              <>
                <label className="block sm:col-span-2">
                  <span className={LABEL}>Salutation</span>
                  <input value={salutation} onChange={(e) => setSalutation(e.target.value)} className={INPUT} />
                </label>
                <label className="block sm:col-span-2">
                  <span className={LABEL}>Email message</span>
                  <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={4} className={`${INPUT} resize-y`} />
                  <span className="mt-1 block text-[11px] text-stone-400 dark:text-stone-500">The mark’s caption goes above it, with your name as the sender.</span>
                </label>
              </>
            ) : (
              <label className="block sm:col-span-2">
                <span className={LABEL}>Notes</span>
                <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Optional — how it was sent, a reply expected…" className={`${INPUT} resize-y`} />
              </label>
            )}
          </div>

          <div>
            <span className={LABEL}>{mode === 'send' ? 'Report and annexes' : 'What was sent'}</span>
            {files.length > 0 && (
              <ul className="mb-2 divide-y divide-stone-100 dark:divide-white/[0.06] rounded-lg border border-stone-200 dark:border-white/10">
                {files.map((f, i) => (
                  <li key={f.key} className="flex items-center gap-2 px-3 py-1.5 text-xs">
                    <FileText className="w-3.5 h-3.5 text-stone-400 shrink-0" />
                    <span className="truncate text-stone-800 dark:text-stone-100">{f.name}</span>
                    <span className="text-stone-400 dark:text-stone-500 shrink-0">{i === 0 ? 'Letter' : 'Annex'}</span>
                    <span className="ml-auto flex items-center gap-2 shrink-0">
                      {f.failed ? (
                        <span className="text-red-600 dark:text-red-400">Not uploaded</span>
                      ) : !f.path ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-stone-400" />
                      ) : i > 0 ? (
                        <button type="button" onClick={() => makeLetter(f.key)} className="text-navy-700 dark:text-navy-300 hover:underline cursor-pointer">Make the letter</button>
                      ) : null}
                      <button type="button" onClick={() => remove(f.key)} className="text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 cursor-pointer" aria-label={`Remove ${f.name}`}>
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <button type="button" onClick={() => fileInput.current?.click()} className="inline-flex items-center gap-1 text-xs text-navy-700 dark:text-navy-300 hover:underline cursor-pointer">
              <Upload className="w-3 h-3" /> {files.length === 0 ? 'Add the report (PDF)' : 'Add an annex'}
            </button>
            <input
              ref={fileInput}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                const list = Array.from(e.target.files ?? []);
                e.target.value = '';
                if (list.length) void add(list);
              }}
            />
          </div>
        </div>

        <div className="space-y-2 min-w-0 lg:sticky lg:top-0">
          {files.length > 1 ? (
            <div className="flex flex-wrap items-center gap-1">
              {files.map((f, i) => (
                <button key={f.key} type="button" onClick={() => setTab(i)} className={reportTabClass(tab === i)} title={f.name}>
                  <FileText className="w-3.5 h-3.5 shrink-0" /> <span className="truncate">{i === 0 ? 'Letter' : `Annex · ${f.name}`}</span>
                </button>
              ))}
            </div>
          ) : (
            <span className={LABEL + ' mb-0'}>Preview</span>
          )}
          <div className="h-[60vh] min-h-[360px] overflow-y-auto rounded-xl border border-stone-200 dark:border-white/10 bg-stone-100 dark:bg-white/5">
            {shown ? (
              <ReportFileView url={shown.localUrl} name={shown.name} />
            ) : (
              <div className="h-full flex items-center justify-center p-6 text-center text-xs text-stone-500 dark:text-stone-400">
                {mode === 'send' ? 'Add your report — the letter first, then any annexes.' : 'Add the report as it was sent, and anything that went with it.'}
              </div>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
