'use client';

import { useEffect, useRef, useState } from 'react';
import { Download, FileText, Mail } from 'lucide-react';
import Modal from '@/components/ui/Modal';
import ReportFileView, { reportTabClass } from '@/components/client-reports/ReportFileView';
import { formatDate } from '@/lib/format-date';
import { formatManila } from '@/lib/dates';

interface SentReport {
  id: number;
  subject: string;
  bodyHtml: string | null;
  sentAt: string;
  sentByName: string | null;
  /** The firm's trademark mailbox the reports go out from. */
  from: string;
  recipientEmail: string;
  ccEmails: string[];
  /** Went out by other means; only recorded here, so there is no email to show. */
  sentOutside: boolean;
  notes: string | null;
  attachments: { name: string; isPdf: boolean; isImage: boolean; viewUrl: string | null; downloadUrl: string | null }[];
}

/** The email exactly as it went, in a frame so its styles stay its own. */
function EmailFrame({ html }: { html: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(480);
  const fit = () => {
    const h = frame.current?.contentDocument?.body?.scrollHeight;
    if (h) setHeight(h + 32);
  };
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <iframe
      ref={frame}
      title="Email as sent"
      srcDoc={`<!doctype html><html><body style="margin:16px;background:#fff">${html}</body></html>`}
      sandbox="allow-same-origin"
      onLoad={fit}
      style={{ height }}
      className="block w-full border-0 bg-white"
    />
  );
}

/** A client report as it was sent: the email, who it went to, and what was attached. */
export default function SentReportModal({ trademarkId, reportId, onClose }: { trademarkId: string; reportId: number; onClose: () => void }) {
  const [report, setReport] = useState<SentReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<number>(-1);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/trademark/${trademarkId}/reports/${reportId}`)
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) setError(data.error || 'Could not load the report');
        else {
          setReport(data.report);
          // A recorded report has no email of its own, so it opens on what was sent.
          if (data.report.sentOutside && data.report.attachments.length > 0) setTab(0);
        }
      });
    return () => { cancelled = true; };
  }, [trademarkId, reportId]);

  const shown = report && tab >= 0 ? report.attachments[tab] : null;
  const tabClass = reportTabClass;

  return (
    <Modal open onClose={onClose} size="xl" icon={<Mail className="w-4 h-4" />} title={report?.subject ?? 'Sent report'}>
      {error ? (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      ) : !report ? (
        <div className="h-60 rounded-xl bg-stone-100 dark:bg-white/5 animate-pulse" aria-busy />
      ) : (
        <div className="space-y-3">
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-0.5 text-xs">
            <dt className="text-stone-500 dark:text-stone-400">From</dt>
            <dd className="text-stone-800 dark:text-stone-100">
              {report.sentOutside
                ? `Sent outside the app${report.sentByName ? ` · recorded by ${report.sentByName}` : ''}`
                : `${report.from || 'The firm’s trademark mailbox'}${report.sentByName ? ` · sent by ${report.sentByName}` : ''}`}
            </dd>
            <dt className="text-stone-500 dark:text-stone-400">To</dt>
            <dd className="text-stone-800 dark:text-stone-100">{report.recipientEmail || '—'}</dd>
            {report.ccEmails.length > 0 && (
              <>
                <dt className="text-stone-500 dark:text-stone-400">Cc</dt>
                <dd className="text-stone-800 dark:text-stone-100">{report.ccEmails.join(', ')}</dd>
              </>
            )}
            <dt className="text-stone-500 dark:text-stone-400">Sent</dt>
            <dd className="text-stone-800 dark:text-stone-100">{report.sentOutside ? formatDate(report.sentAt) : formatManila(report.sentAt, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</dd>
            {report.notes && (
              <>
                <dt className="text-stone-500 dark:text-stone-400">Notes</dt>
                <dd className="text-stone-800 dark:text-stone-100 whitespace-pre-line">{report.notes}</dd>
              </>
            )}
          </dl>

          <div className="flex flex-wrap items-center gap-1 border-b border-stone-200 dark:border-white/10 pb-2">
            {!report.sentOutside && (
              <button type="button" onClick={() => setTab(-1)} className={tabClass(tab === -1)}>
                <Mail className="w-3.5 h-3.5 shrink-0" /> Email
              </button>
            )}
            {report.attachments.map((a, i) => (
              <button key={a.name + i} type="button" onClick={() => setTab(i)} className={tabClass(tab === i)} title={a.name}>
                <FileText className="w-3.5 h-3.5 shrink-0" /> <span className="truncate">{a.name}</span>
              </button>
            ))}
          </div>

          {tab === -1 ? (
            report.bodyHtml ? (
              <div className="rounded-xl border border-stone-200 dark:border-white/10 overflow-hidden">
                <EmailFrame html={report.bodyHtml} />
              </div>
            ) : (
              <p className="text-sm text-stone-500 dark:text-stone-400">
                {report.sentOutside ? 'This report went out by other means and was recorded without its files.' : 'The email’s text wasn’t kept for this report.'}
              </p>
            )
          ) : shown ? (
            <div className="space-y-2">
              {(shown.isPdf || shown.isImage) && shown.viewUrl ? (
                <div className="h-[65vh] overflow-y-auto rounded-xl border border-stone-200 dark:border-white/10 bg-stone-100 dark:bg-white/5">
                  <ReportFileView url={shown.viewUrl} name={shown.name} />
                </div>
              ) : (
                <p className="text-sm text-stone-500 dark:text-stone-400">This file can’t be previewed here. Download it to open it.</p>
              )}
              {shown.downloadUrl && (
                <a href={shown.downloadUrl} className="inline-flex items-center gap-1.5 text-xs text-navy-700 dark:text-navy-300 hover:underline">
                  <Download className="w-3.5 h-3.5" /> Download {shown.name}
                </a>
              )}
            </div>
          ) : null}
        </div>
      )}
    </Modal>
  );
}
