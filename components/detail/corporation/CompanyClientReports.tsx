'use client';

import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, ChevronDown, Mail, Paperclip } from 'lucide-react';
import type { CorporateReportEvent } from '@/lib/corporations/client-report';
import { fileDocumentName } from '@/lib/client-reports/letter';
import { addDays, formatManila, manilaToday } from '@/lib/dates';
import { formatDate } from '@/lib/format-date';
import { uploadCorporationFile } from '@/lib/corporations/upload-file';
import ClientReportModal from '@/components/client-reports/ClientReportModal';
import Button from '@/components/ui/Button';
import { SubjectCard } from '@/components/ui/primitives';
import type { CorporationFile } from '@/types/corporations';

export interface Reportable {
  event: CorporateReportEvent;
  itemId: string | null;
  label: string;
  date: string;
  sent: { sentAt: string; recipientEmail: string } | null;
}

interface SentReport {
  id: number;
  event: CorporateReportEvent;
  itemId: string | null;
  eventDate: string;
  sentAt: string;
  sentBy: string | null;
  recipientEmail: string;
  ccEmails: string[];
  subject: string;
  attachments: { name: string; url: string | null }[];
}

const MUTED = 'text-stone-500 dark:text-stone-400';
const LINK = 'text-navy-700 dark:text-navy-300 hover:underline';
/** A report on something done in the last 60 days is shown as owed; older ones under "Earlier". */
const OWED_DAYS = 60;
/** How many earlier items show before "Show more". */
const EARLIER_SHOWN = 5;

const keyOf = (r: { event: string; itemId: string | null; date: string }) => `${r.event}|${r.itemId ?? ''}|${r.date}`;

export type CompanyReports = ReturnType<typeof useCompanyReports>;

/**
 * What can be reported on a company and what was sent. One fetch shared by the
 * page's banner and the Client reports card, so sending from either clears both.
 *
 * `version` changes whenever the company record does: a new registration is a
 * new report.
 */
export function useCompanyReports(corporationId: string, version: unknown) {
  const [reportable, setReportable] = useState<Reportable[]>([]);
  const [sent, setSent] = useState<SentReport[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    fetch(`/api/corporation/${corporationId}/reports`)
      .then((r) => r.json())
      .then((d) => {
        setReportable(d.reportable ?? []);
        setSent(d.sent ?? []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [corporationId]);

  useEffect(load, [load, version]);

  const since = addDays(manilaToday(), -OWED_DAYS);
  const owed = reportable.filter((r) => !r.sent && r.date >= since);
  return { reportable, sent, owed, loading, load };
}

/** Sits at the top of the company page so a report waiting to go out is seen on arrival, on any tab. */
export function CompanyReportsOwedCard({ owed, onPrepare }: { owed: Reportable[]; onPrepare: (r: Reportable) => void }) {
  return (
    <div className="rounded-2xl border border-navy-200 bg-navy-50/70 px-4 py-3 dark:border-navy-400/20 dark:bg-navy-500/10">
      <p className="flex items-center gap-2 text-[11px] uppercase tracking-wider font-semibold text-navy-700 dark:text-navy-300">
        <Mail className="w-3.5 h-3.5" />
        {owed.length === 1 ? 'Client report to send' : `${owed.length} client reports to send`}
      </p>
      <ul className="mt-2 space-y-2">
        {owed.map((r) => (
          <li key={keyOf(r)} className="flex items-center justify-between gap-3">
            <p className="text-sm text-stone-800 dark:text-stone-100 min-w-0">
              <span className="font-medium">{r.label}</span>
              <span className={`text-xs ${MUTED}`}> · {formatDate(r.date)} · not yet sent</span>
            </p>
            <Button variant="primary" size="sm" className="shrink-0" onClick={() => onPrepare(r)}>
              Review &amp; send
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The report dialog for one reportable item, drafted from the record and sent from the firm's compliance mailbox. */
export function CompanyReportModal({ corporationId, report, onClose, onSent, onFileAdded }: {
  corporationId: string;
  report: Reportable;
  onClose: () => void;
  onSent: () => void;
  /** A paper uploaded as an annex is kept in the company's files. */
  onFileAdded: (file: CorporationFile) => void;
}) {
  return (
    <ClientReportModal
      key={keyOf(report)}
      api={`/api/corporation/${corporationId}/client-report`}
      report={{ event: report.event, ...(report.itemId ? { itemId: report.itemId } : {}) }}
      title={report.label}
      owner="company"
      groupLabel={(g) => g ?? 'Company file'}
      uploadAnnex={async (file) => {
        const { file: saved } = await uploadCorporationFile(corporationId, 'Other', file);
        onFileAdded(saved);
        return {
          id: `c:${saved.id}`, name: saved.name, sizeBytes: saved.sizeBytes, group: saved.category,
          document: fileDocumentName(saved.name), url: null,
        };
      }}
      onClose={onClose}
      onSent={onSent}
    />
  );
}

/**
 * Client reports on a company: what was done for it that the client can be
 * told about — its registrations, filed compliance items, meetings held and
 * resolutions signed — each with a report drafted from the record, reviewed
 * and sent from the firm's compliance mailbox; and the reports already sent.
 */
export default function CompanyClientReports({ reports, onPrepare }: {
  reports: CompanyReports;
  onPrepare: (r: Reportable) => void;
}) {
  const { reportable, sent, owed, loading } = reports;
  const [showAll, setShowAll] = useState(false);
  const earlier = reportable.filter((r) => !owed.includes(r));
  const shownEarlier = showAll ? earlier : earlier.slice(0, EARLIER_SHOWN);

  const row = (r: Reportable, primary: boolean) => (
    <li key={keyOf(r)} className="flex items-center justify-between gap-3 py-2">
      <div className="min-w-0">
        <p className="text-sm text-stone-800 dark:text-stone-100 truncate">{r.label}</p>
        <p className={`text-[11px] ${MUTED}`}>
          {formatDate(r.date)}
          {r.sent ? (
            <> · <CheckCircle2 className="inline w-3 h-3 -mt-px text-emerald-600 dark:text-emerald-400" /> sent {formatDate(r.sent.sentAt.slice(0, 10))} to {r.sent.recipientEmail}</>
          ) : ' · not yet sent'}
        </p>
      </div>
      <Button variant={primary ? 'primary' : 'outline'} size="sm" className="shrink-0" onClick={() => onPrepare(r)}>
        {r.sent ? 'Send again' : 'Review & send'}
      </Button>
    </li>
  );

  return (
    <SubjectCard title="Client reports" icon={<Mail className="w-4 h-4" />}>
      {loading ? (
        <div className="h-9 rounded-lg bg-stone-100 dark:bg-white/5 animate-pulse" aria-busy />
      ) : reportable.length === 0 && sent.length === 0 ? (
        <p className={`text-sm ${MUTED}`}>
          Nothing to report yet. A registration recorded here, a compliance item filed, a meeting held or a resolution signed can each be reported to the client.
        </p>
      ) : (
        <div className="space-y-4">
          {owed.length > 0 && (
            <div>
              <p className="text-[11px] uppercase tracking-wider font-semibold text-navy-700 dark:text-navy-300">
                {owed.length === 1 ? 'Report to send' : `${owed.length} reports to send`}
              </p>
              <ul className="divide-y divide-stone-100 dark:divide-white/[0.06]">{owed.map((r) => row(r, true))}</ul>
            </div>
          )}
          {earlier.length > 0 && (
            <div>
              <p className={`text-[11px] uppercase tracking-wider font-semibold ${MUTED}`}>Earlier</p>
              <ul className="divide-y divide-stone-100 dark:divide-white/[0.06]">{shownEarlier.map((r) => row(r, false))}</ul>
              {earlier.length > EARLIER_SHOWN && (
                <button type="button" onClick={() => setShowAll((s) => !s)} className={`mt-1 inline-flex items-center gap-1 text-xs ${LINK} cursor-pointer`}>
                  <ChevronDown className={`w-3 h-3 transition-transform ${showAll ? 'rotate-180' : ''}`} />
                  {showAll ? 'Show fewer' : `Show ${earlier.length - EARLIER_SHOWN} more`}
                </button>
              )}
            </div>
          )}
          {sent.length > 0 && (
            <div>
              <p className={`text-[11px] uppercase tracking-wider font-semibold ${MUTED}`}>Sent</p>
              <ul className="divide-y divide-stone-100 dark:divide-white/[0.06]">
                {sent.map((s) => (
                  <li key={s.id} className="py-2">
                    <p className="text-sm text-stone-800 dark:text-stone-100 truncate" title={s.subject}>{s.subject}</p>
                    <p className={`text-[11px] ${MUTED}`}>
                      {formatManila(s.sentAt, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}{s.sentBy ? ` · by ${s.sentBy}` : ''} · to {s.recipientEmail}
                      {s.ccEmails.length > 0 && <> · cc {s.ccEmails.join(', ')}</>}
                    </p>
                    {s.attachments.length > 0 && (
                      <p className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px]">
                        {s.attachments.map((a, i) => (
                          a.url ? (
                            <a key={i} href={a.url} className={`inline-flex items-center gap-1 ${LINK}`}>
                              <Paperclip className="w-3 h-3" /> {a.name}
                            </a>
                          ) : (
                            <span key={i} className={MUTED}>{a.name}</span>
                          )
                        ))}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

    </SubjectCard>
  );
}

