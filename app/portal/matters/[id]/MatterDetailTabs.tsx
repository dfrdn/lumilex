'use client';

import { useMemo, useState } from 'react';
import {
  Paperclip, Calendar, FileText, Eye, Download, Archive,
  Gavel, Handshake, Inbox, Upload, Clock, Check, ScrollText,
  ClipboardCheck, History, Search, SearchX,
} from 'lucide-react';
import PortalTimeline, {
  type PortalTimelineEvent,
  type PortalTimelineKind,
} from './PortalTimeline';
import FilePreviewModal from '@/components/FilePreviewModal';
import { downloadFile } from '@/lib/download-file';
import type { FileAttachment } from '@/types/notion';
import PortalUploadModal from './PortalUploadModal';
import PortalMatterChat, { type PortalChatMessage } from './PortalMatterChat';
import { Sparkles } from 'lucide-react';

export interface PortalFile {
  id: string;
  name: string;
  path: string;
  url: string;          // pre-signed URL minted server-side
  date: string | null;
  origin: string | null;
  isCourtRecord: boolean;
  deliverableId: string | null;
}

export interface ScheduleItem {
  kind: 'meeting' | 'hearing';
  id: string;
  name: string;
  date: string | null;
  subline: string;
}

export interface PortalDeliverable {
  id: string;
  name: string;
  status: string | null;
  type: string | null;
  files: PortalFile[];
}

export interface PortalFileRequest {
  id: string;
  description: string;
  dueAt: string | null;
  createdAt: string;
  fulfilledAt: string | null;
  requesterName: string;
}

export interface PortalStatusReport {
  id: string;
  name: string;
  sentAt: string | null;
  file: {
    name: string;
    path: string;
    url: string;
  } | null;
}

export interface PortalExhibit {
  id: string;
  label: string;
  offeredBy: string;
  partyLabel: string;
  parentExhibitId: string | null;
  title: string;
  description: string;
  documentDate: string | null;
  purpose: string;
  status: string;
  rulingDate: string | null;
  rulingNote: string;
  file: {
    name: string;
    signedUrl: string;
    path: string;
  } | null;
}

type Tab = 'timeline' | 'ask' | 'files' | 'requests' | 'schedule' | 'status-reports' | 'deliverables' | 'exhibits';

const PORTAL_SIGN_ENDPOINT = '/api/portal/file-sign';

function formatDate(s: string | null | undefined): string {
  if (!s) return '';
  return new Date(s).toLocaleDateString('en-PH', {
    year: 'numeric', month: 'short', day: 'numeric', timeZone: 'Asia/Manila',
  });
}

function formatDateTime(s: string | null | undefined): string {
  if (!s) return '';
  return new Date(s).toLocaleString('en-PH', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Manila',
  });
}

interface Props {
  matterId: string;
  files: PortalFile[];
  schedule: ScheduleItem[];
  deliverables: PortalDeliverable[];
  fileRequests: PortalFileRequest[];
  exhibits: PortalExhibit[];
  statusReports: PortalStatusReport[];
  timelineEvents: PortalTimelineEvent[];
  chatInitialMessages: PortalChatMessage[];
  /** Read-only partner/admin preview — disables mutations and uses firm-side file endpoints. */
  preview?: boolean;
}

export default function MatterDetailTabs({
  matterId,
  files,
  schedule,
  deliverables,
  fileRequests,
  exhibits,
  statusReports,
  timelineEvents,
  chatInitialMessages,
  preview = false,
}: Props) {
  // In preview the viewer is a team member, so portal-session endpoints 401.
  // The firm-side file-sign / download endpoints are team-authed and sign the
  // same storage bucket, so previewing and downloading still work.
  const signEndpoint = preview ? '/api/file-sign' : PORTAL_SIGN_ENDPOINT;
  const openRequests = fileRequests.filter((r) => !r.fulfilledAt);
  const initialTab: Tab = openRequests.length > 0 ? 'requests' : 'files';
  const [tab, setTab] = useState<Tab>(initialTab);
  const [modal, setModal] = useState<{ files: FileAttachment[]; index: number } | null>(null);
  const [uploadModal, setUploadModal] = useState<
    { fileRequestId: string | null; description: string | null } | null
  >(null);

  function openModal(modalFiles: PortalFile[], index: number) {
    setModal({
      files: modalFiles.map((f) => ({ name: f.name, url: f.url, path: f.path })),
      index,
    });
  }

  return (
    <>
      {/* Tab strip */}
      <div className="border-b border-[var(--border-color)] mb-6 flex gap-1 overflow-x-auto">
        <TabButton
          active={tab === 'timeline'}
          onClick={() => setTab('timeline')}
          icon={<History className="w-3.5 h-3.5" />}
          label="Timeline"
          count={timelineEvents.length}
        />
        <TabButton
          active={tab === 'ask'}
          onClick={() => setTab('ask')}
          icon={<Sparkles className="w-3.5 h-3.5" />}
          label="Ask about your case"
        />
        <TabButton
          active={tab === 'files'}
          onClick={() => setTab('files')}
          icon={<Paperclip className="w-3.5 h-3.5" />}
          label="Files"
          count={files.length}
        />
        <TabButton
          active={tab === 'requests'}
          onClick={() => setTab('requests')}
          icon={<Inbox className="w-3.5 h-3.5" />}
          label="Requests"
          count={openRequests.length}
          highlight={openRequests.length > 0}
        />
        <TabButton
          active={tab === 'schedule'}
          onClick={() => setTab('schedule')}
          icon={<Calendar className="w-3.5 h-3.5" />}
          label="Schedule"
          count={schedule.length}
        />
        <TabButton
          active={tab === 'status-reports'}
          onClick={() => setTab('status-reports')}
          icon={<ClipboardCheck className="w-3.5 h-3.5" />}
          label="Status reports"
          count={statusReports.length}
        />
        <TabButton
          active={tab === 'deliverables'}
          onClick={() => setTab('deliverables')}
          icon={<FileText className="w-3.5 h-3.5" />}
          label="Completed deliverables"
          count={deliverables.length}
        />
        {exhibits.length > 0 && (
          <TabButton
            active={tab === 'exhibits'}
            onClick={() => setTab('exhibits')}
            icon={<ScrollText className="w-3.5 h-3.5" />}
            label="Evidence"
            count={exhibits.length}
          />
        )}
      </div>

      {tab === 'timeline' && <TimelineTab events={timelineEvents} />}
      {tab === 'ask' && (
        <PortalMatterChat
          matterId={matterId}
          initialMessages={chatInitialMessages}
          preview={preview}
        />
      )}
      {tab === 'files' && (
        <FilesTab
          files={files}
          matterId={matterId}
          openModal={openModal}
          onUploadClick={() => setUploadModal({ fileRequestId: null, description: null })}
          preview={preview}
          signEndpoint={signEndpoint}
        />
      )}
      {tab === 'requests' && (
        <RequestsTab
          fileRequests={fileRequests}
          onFulfill={(r) => setUploadModal({ fileRequestId: r.id, description: r.description })}
          preview={preview}
        />
      )}
      {tab === 'schedule' && <ScheduleTab schedule={schedule} />}
      {tab === 'status-reports' && (
        <StatusReportsTab statusReports={statusReports} openModal={openModal} signEndpoint={signEndpoint} />
      )}
      {tab === 'deliverables' && (
        <DeliverablesTab deliverables={deliverables} openModal={openModal} signEndpoint={signEndpoint} />
      )}
      {tab === 'exhibits' && <ExhibitsTab exhibits={exhibits} />}

      <FilePreviewModal
        open={!!modal}
        onClose={() => setModal(null)}
        files={modal?.files ?? []}
        initialIndex={modal?.index ?? 0}
        signEndpoint={signEndpoint}
      />

      <PortalUploadModal
        open={!!uploadModal}
        matterId={matterId}
        fileRequestId={uploadModal?.fileRequestId}
        requestDescription={uploadModal?.description}
        onClose={() => setUploadModal(null)}
        onUploaded={() => {
          // The file requests / files lists are server-rendered as props
          // here; the upload will show on the next navigation. Closing the
          // modal at least gives immediate visual feedback.
          setUploadModal(null);
        }}
      />
    </>
  );
}

// ── Tab button ──────────────────────────────────────────────────────────

function TabButton({
  active, onClick, icon, label, count, highlight = false,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  count?: number;
  highlight?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative flex items-center gap-1.5 px-4 py-3 text-sm font-medium transition-colors whitespace-nowrap ${
        active
          ? 'text-foreground'
          : 'text-[var(--text-secondary)] hover:text-foreground'
      }`}
    >
      {icon}
      {label}
      {count != null && (
        <span
          className={
            highlight
              ? 'inline-flex items-center justify-center min-w-[1.25rem] h-5 text-[10px] font-semibold text-white bg-gold-500 dark:bg-gold-400 dark:text-navy-900 rounded-full px-1.5'
              : `text-xs ${active ? 'text-[var(--text-muted)]' : 'text-[var(--text-muted)]'}`
          }
        >
          {highlight ? count : `(${count})`}
        </span>
      )}
      {active && (
        <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-gold-500 dark:bg-gold-400" />
      )}
    </button>
  );
}

// ── In-tab search / filter controls ─────────────────────────────────────
//
// Small matters don't need controls — they only render once a list is long
// enough that scanning it becomes work.
const CONTROLS_THRESHOLD = 6;

function MiniSearch({
  value, onChange, placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <label className="relative flex-1 min-w-[180px]">
      <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-[var(--border-color)] bg-card text-foreground placeholder:text-[var(--text-muted)] focus:outline-none focus:border-gold-500/60 dark:focus:border-gold-400/50 transition-colors"
      />
    </label>
  );
}

function MiniPill({
  active, onClick, children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-2 py-1 rounded-full text-[11px] font-medium border transition-colors whitespace-nowrap ${
        active
          ? 'bg-navy-800 text-white border-navy-800 dark:bg-gold-400 dark:text-navy-950 dark:border-gold-400'
          : 'bg-card text-[var(--text-secondary)] border-[var(--border-color)] hover:border-[var(--border-hover)] hover:text-foreground'
      }`}
    >
      {children}
    </button>
  );
}

function NoMatchNote({ onClear }: { onClear: () => void }) {
  return (
    <div className="border border-[var(--border-color)] rounded-xl bg-card px-5 py-10 text-center">
      <SearchX className="w-6 h-6 mx-auto text-[var(--text-muted)] mb-2" />
      <p className="text-sm text-[var(--text-secondary)]">Nothing matches your search or filters.</p>
      <button
        type="button"
        onClick={onClear}
        className="mt-2 text-xs font-medium text-gold-700 dark:text-gold-400 hover:underline"
      >
        Clear
      </button>
    </div>
  );
}

// ── Timeline tab ────────────────────────────────────────────────────────

const TIMELINE_KIND_LABELS: Record<PortalTimelineKind, string> = {
  hearing: 'Hearings',
  meeting: 'Meetings',
  filing: 'Filings',
  status_report: 'Status reports',
  court_record: 'Court records',
};

const TIMELINE_KIND_ORDER: PortalTimelineKind[] = [
  'hearing', 'meeting', 'filing', 'status_report', 'court_record',
];

function TimelineTab({ events }: { events: PortalTimelineEvent[] }) {
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState<'all' | PortalTimelineKind>('all');

  const counts = useMemo(() => {
    const c = new Map<PortalTimelineKind, number>();
    for (const e of events) c.set(e.kind, (c.get(e.kind) ?? 0) + 1);
    return c;
  }, [events]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return events.filter(
      (e) =>
        (kind === 'all' || e.kind === kind) &&
        (!q || `${e.headline} ${e.subline}`.toLowerCase().includes(q)),
    );
  }, [events, search, kind]);

  const showControls = events.length >= CONTROLS_THRESHOLD;
  return (
    <div>
      {showControls && (
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <MiniSearch value={search} onChange={setSearch} placeholder="Search case events…" />
          <div className="flex flex-wrap gap-1.5">
            <MiniPill active={kind === 'all'} onClick={() => setKind('all')}>
              All {events.length}
            </MiniPill>
            {TIMELINE_KIND_ORDER.filter((k) => (counts.get(k) ?? 0) > 0).map((k) => (
              <MiniPill key={k} active={kind === k} onClick={() => setKind(k)}>
                {TIMELINE_KIND_LABELS[k]} {counts.get(k)}
              </MiniPill>
            ))}
          </div>
        </div>
      )}
      {filtered.length === 0 && events.length > 0 ? (
        <NoMatchNote
          onClear={() => {
            setSearch('');
            setKind('all');
          }}
        />
      ) : (
        <PortalTimeline events={filtered} />
      )}
    </div>
  );
}

// ── Files tab ───────────────────────────────────────────────────────────

type FileSourceFilter = 'all' | 'court' | 'you' | 'other';
type FileSort = 'newest' | 'oldest' | 'alpha';

function fileSource(f: PortalFile): Exclude<FileSourceFilter, 'all'> {
  if (f.isCourtRecord || (f.origin ?? '').toLowerCase() === 'court') return 'court';
  if ((f.origin ?? '').toLowerCase().startsWith('client')) return 'you';
  return 'other';
}

function FilesTab({
  files, matterId, openModal, onUploadClick, preview, signEndpoint,
}: {
  files: PortalFile[];
  matterId: string;
  openModal: (files: PortalFile[], index: number) => void;
  onUploadClick: () => void;
  preview: boolean;
  signEndpoint: string;
}) {
  const [search, setSearch] = useState('');
  const [source, setSource] = useState<FileSourceFilter>('all');
  const [sort, setSort] = useState<FileSort>('newest');

  const sourceCounts = useMemo(() => {
    const c: Record<Exclude<FileSourceFilter, 'all'>, number> = { court: 0, you: 0, other: 0 };
    for (const f of files) c[fileSource(f)]++;
    return c;
  }, [files]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = files.filter(
      (f) =>
        (source === 'all' || fileSource(f) === source) &&
        (!q || `${f.name} ${f.origin ?? ''}`.toLowerCase().includes(q)),
    );
    const sorted = [...filtered];
    // Incoming order is already newest-first (server-sorted).
    if (sort === 'oldest') sorted.reverse();
    else if (sort === 'alpha') sorted.sort((a, b) => a.name.localeCompare(b.name));
    return sorted;
  }, [files, search, source, sort]);

  const showControls = files.length >= CONTROLS_THRESHOLD;
  const uploadButton = preview ? (
    <span
      className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--text-muted)] bg-subtle rounded-lg px-3 py-1.5 opacity-60 cursor-not-allowed"
      title="The client uploads files here — disabled in preview"
    >
      <Upload className="w-3.5 h-3.5" />
      Send files
    </span>
  ) : (
    <button
      type="button"
      onClick={onUploadClick}
      className="inline-flex items-center gap-1.5 text-xs font-medium text-white bg-navy-600 hover:bg-navy-700 rounded-lg px-3 py-1.5 transition-colors"
    >
      <Upload className="w-3.5 h-3.5" />
      Send files
    </button>
  );

  if (files.length === 0) {
    return (
      <div className="border border-[var(--border-color)] rounded-xl bg-card px-5 py-12 text-center">
        <p className="text-sm text-[var(--text-secondary)]">No files on this matter yet.</p>
        <div className="mt-4 flex justify-center">{uploadButton}</div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex justify-end items-center gap-2 mb-3">
        {!preview && (
          <a
            href={`/api/portal/matters/${encodeURIComponent(matterId)}/files/zip`}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground border border-[var(--border-color)] bg-card hover:bg-subtle rounded-lg px-3 py-1.5 transition-colors"
          >
            <Archive className="w-3.5 h-3.5" />
            Download all
          </a>
        )}
        {uploadButton}
      </div>
      {showControls && (
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <MiniSearch value={search} onChange={setSearch} placeholder="Search files…" />
          <div className="flex flex-wrap gap-1.5">
            <MiniPill active={source === 'all'} onClick={() => setSource('all')}>
              All {files.length}
            </MiniPill>
            {sourceCounts.court > 0 && (
              <MiniPill active={source === 'court'} onClick={() => setSource('court')}>
                Court records {sourceCounts.court}
              </MiniPill>
            )}
            {sourceCounts.you > 0 && (
              <MiniPill active={source === 'you'} onClick={() => setSource('you')}>
                From you {sourceCounts.you}
              </MiniPill>
            )}
            {sourceCounts.other > 0 && (
              <MiniPill active={source === 'other'} onClick={() => setSource('other')}>
                Other {sourceCounts.other}
              </MiniPill>
            )}
          </div>
          <span className="w-px h-4 bg-[var(--border-color)]" aria-hidden />
          <div className="flex gap-1.5">
            {(
              [
                ['newest', 'Newest'],
                ['oldest', 'Oldest'],
                ['alpha', 'A to Z'],
              ] as [FileSort, string][]
            ).map(([key, label]) => (
              <MiniPill key={key} active={sort === key} onClick={() => setSort(key)}>
                {label}
              </MiniPill>
            ))}
          </div>
        </div>
      )}
      {visible.length === 0 ? (
        <NoMatchNote
          onClear={() => {
            setSearch('');
            setSource('all');
          }}
        />
      ) : (
        <ul className="space-y-2">
          {visible.map((f, idx) => (
            <FileRow
              key={f.id}
              file={f}
              onPreview={() => openModal(visible, idx)}
              signEndpoint={signEndpoint}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Requests tab ────────────────────────────────────────────────────────

function formatDueDate(iso: string | null): { label: string; overdue: boolean } | null {
  if (!iso) return null;
  const due = new Date(iso);
  const overdue = due.getTime() < Date.now();
  const label = due.toLocaleDateString('en-PH', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'Asia/Manila',
  });
  return { label, overdue };
}

function RequestsTab({
  fileRequests, onFulfill, preview,
}: {
  fileRequests: PortalFileRequest[];
  onFulfill: (r: PortalFileRequest) => void;
  preview: boolean;
}) {
  const open = fileRequests.filter((r) => !r.fulfilledAt);
  const fulfilled = fileRequests.filter((r) => r.fulfilledAt);

  if (fileRequests.length === 0) {
    return (
      <div className="border border-[var(--border-color)] rounded-xl bg-card px-5 py-12 text-center">
        <Inbox className="w-6 h-6 mx-auto text-[var(--text-muted)] mb-2" />
        <p className="text-sm text-[var(--text-secondary)]">
          No requests from your legal team yet.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {open.length > 0 && (
        <div>
          <p className="text-[10px] font-medium uppercase tracking-wider text-[var(--text-muted)] mb-2">
            Awaiting your reply ({open.length})
          </p>
          <ul className="space-y-2">
            {open.map((r) => {
              const due = formatDueDate(r.dueAt);
              return (
                <li
                  key={r.id}
                  className="border border-gold-200 dark:border-gold-400/30 bg-gold-50/40 dark:bg-gold-400/5 rounded-xl px-4 py-4"
                >
                  <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">
                    {r.description}
                  </p>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--text-secondary)] mt-2">
                    <span>From {r.requesterName}</span>
                    {due && (
                      <>
                        <span className="text-[var(--text-muted)]">·</span>
                        <span
                          className={`inline-flex items-center gap-1 ${
                            due.overdue ? 'text-red-700 dark:text-red-400 font-medium' : ''
                          }`}
                        >
                          <Clock className="w-3 h-3" />
                          {due.overdue ? 'Overdue · ' : 'Due '}
                          {due.label}
                        </span>
                      </>
                    )}
                  </div>
                  <div className="mt-3 flex justify-end">
                    {preview ? (
                      <span
                        className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--text-muted)] bg-subtle rounded-lg px-3 py-1.5 opacity-60 cursor-not-allowed"
                        title="The client replies here — disabled in preview"
                      >
                        <Upload className="w-3.5 h-3.5" />
                        Send files
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onFulfill(r)}
                        className="inline-flex items-center gap-1.5 text-xs font-medium text-white bg-navy-600 hover:bg-navy-700 rounded-lg px-3 py-1.5 transition-colors"
                      >
                        <Upload className="w-3.5 h-3.5" />
                        Send files
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {fulfilled.length > 0 && (
        <div>
          <p className="text-[10px] font-medium uppercase tracking-wider text-[var(--text-muted)] mb-2">
            Recently sent ({fulfilled.length})
          </p>
          <ul className="space-y-2">
            {fulfilled.map((r) => (
              <li
                key={r.id}
                className="border border-[var(--border-color)] bg-card rounded-xl px-4 py-3 flex items-start gap-3"
              >
                <div className="w-7 h-7 rounded-lg bg-subtle flex items-center justify-center shrink-0">
                  <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-foreground line-clamp-2">{r.description}</p>
                  <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
                    From {r.requesterName}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ── Schedule tab ────────────────────────────────────────────────────────

function ScheduleTab({ schedule }: { schedule: ScheduleItem[] }) {
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState<'all' | 'hearing' | 'meeting'>('all');

  const counts = useMemo(
    () => ({
      hearing: schedule.filter((s) => s.kind === 'hearing').length,
      meeting: schedule.filter((s) => s.kind === 'meeting').length,
    }),
    [schedule],
  );

  const { upcoming, past, visibleCount } = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = schedule.filter(
      (s) =>
        (kind === 'all' || s.kind === kind) &&
        (!q || `${s.name} ${s.subline}`.toLowerCase().includes(q)),
    );
    const now = Date.now();
    return {
      upcoming: filtered.filter((s) => s.date && new Date(s.date).getTime() >= now).reverse(),
      past: filtered.filter((s) => !s.date || new Date(s.date).getTime() < now),
      visibleCount: filtered.length,
    };
  }, [schedule, search, kind]);

  if (schedule.length === 0) {
    return (
      <div className="border border-[var(--border-color)] rounded-xl bg-card px-5 py-12 text-center">
        <p className="text-sm text-[var(--text-secondary)]">
          No meetings or hearings on file for this matter.
        </p>
      </div>
    );
  }

  const showControls = schedule.length >= CONTROLS_THRESHOLD;
  return (
    <div className="space-y-6">
      {showControls && (
        <div className="flex flex-wrap items-center gap-2">
          <MiniSearch value={search} onChange={setSearch} placeholder="Search schedule…" />
          <div className="flex flex-wrap gap-1.5">
            <MiniPill active={kind === 'all'} onClick={() => setKind('all')}>
              All {schedule.length}
            </MiniPill>
            {counts.hearing > 0 && (
              <MiniPill active={kind === 'hearing'} onClick={() => setKind('hearing')}>
                Hearings {counts.hearing}
              </MiniPill>
            )}
            {counts.meeting > 0 && (
              <MiniPill active={kind === 'meeting'} onClick={() => setKind('meeting')}>
                Meetings {counts.meeting}
              </MiniPill>
            )}
          </div>
        </div>
      )}
      {visibleCount === 0 && (
        <NoMatchNote
          onClear={() => {
            setSearch('');
            setKind('all');
          }}
        />
      )}
      {upcoming.length > 0 && (
        <div>
          <p className="text-[10px] font-medium uppercase tracking-wider text-[var(--text-muted)] mb-2">
            Upcoming ({upcoming.length})
          </p>
          <ul className="space-y-2">
            {upcoming.map((s) => (
              <ScheduleRow key={`${s.kind}-${s.id}`} item={s} highlight />
            ))}
          </ul>
        </div>
      )}
      {past.length > 0 && (
        <div>
          <p className="text-[10px] font-medium uppercase tracking-wider text-[var(--text-muted)] mb-2">
            Past ({past.length})
          </p>
          <ul className="space-y-2">
            {past.map((s) => (
              <ScheduleRow key={`${s.kind}-${s.id}`} item={s} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ── Status reports tab ──────────────────────────────────────────────────

function StatusReportsTab({
  statusReports, openModal, signEndpoint,
}: {
  statusReports: PortalStatusReport[];
  openModal: (files: PortalFile[], index: number) => void;
  signEndpoint: string;
}) {
  if (statusReports.length === 0) {
    return (
      <div className="border border-[var(--border-color)] rounded-xl bg-card px-5 py-12 text-center">
        <ClipboardCheck className="w-6 h-6 mx-auto text-[var(--text-muted)] mb-2" />
        <p className="text-sm text-[var(--text-secondary)]">
          No status reports sent yet.
        </p>
      </div>
    );
  }

  return (
    <ul className="space-y-2">
      {statusReports.map((r) => {
        const previewable: PortalFile[] = r.file
          ? [{
              id: `${r.id}_sr`,
              name: r.file.name,
              path: r.file.path,
              url: r.file.url,
              date: r.sentAt,
              origin: null,
              isCourtRecord: false,
              deliverableId: r.id,
            }]
          : [];
        return (
          <li
            key={r.id}
            className="border border-[var(--border-color)] rounded-xl bg-card px-4 py-3"
          >
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-subtle flex items-center justify-center shrink-0">
                <ClipboardCheck className="w-4 h-4 text-[var(--text-secondary)]" />
              </div>
              <div className="min-w-0 flex-1">
                {r.file ? (
                  <FileRowInline
                    file={previewable[0]}
                    onPreview={() => openModal(previewable, 0)}
                    signEndpoint={signEndpoint}
                  />
                ) : (
                  <>
                    <p className="text-sm font-medium text-foreground truncate">{r.name}</p>
                    {r.sentAt && (
                      <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
                        Sent {formatDate(r.sentAt)}
                      </p>
                    )}
                    <p className="text-[11px] text-[var(--text-muted)] mt-1 italic">
                      No file attached.
                    </p>
                  </>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// ── Deliverables tab ────────────────────────────────────────────────────

function DeliverablesTab({
  deliverables, openModal, signEndpoint,
}: {
  deliverables: PortalDeliverable[];
  openModal: (files: PortalFile[], index: number) => void;
  signEndpoint: string;
}) {
  const [search, setSearch] = useState('');
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return deliverables;
    return deliverables.filter((d) =>
      `${d.name} ${d.type ?? ''} ${d.files.map((f) => f.name).join(' ')}`.toLowerCase().includes(q),
    );
  }, [deliverables, search]);

  if (deliverables.length === 0) {
    return (
      <div className="border border-[var(--border-color)] rounded-xl bg-card px-5 py-12 text-center">
        <p className="text-sm text-[var(--text-secondary)]">
          No completed deliverables yet. Work in progress doesn&apos;t appear here.
        </p>
      </div>
    );
  }

  return (
    <div>
      {deliverables.length >= CONTROLS_THRESHOLD && (
        <div className="flex mb-3">
          <MiniSearch value={search} onChange={setSearch} placeholder="Search deliverables…" />
        </div>
      )}
      {visible.length === 0 ? (
        <NoMatchNote onClear={() => setSearch('')} />
      ) : (
        <DeliverablesList deliverables={visible} openModal={openModal} signEndpoint={signEndpoint} />
      )}
    </div>
  );
}

function DeliverablesList({
  deliverables, openModal, signEndpoint,
}: {
  deliverables: PortalDeliverable[];
  openModal: (files: PortalFile[], index: number) => void;
  signEndpoint: string;
}) {
  return (
    <ul className="space-y-3">
      {deliverables.map((d) => (
        <li
          key={d.id}
          className="border border-[var(--border-color)] rounded-xl bg-card overflow-hidden"
        >
          <div className="px-4 py-3 border-b border-[var(--border-color)]">
            <p className="text-sm font-medium text-foreground">{d.name}</p>
            {d.type && (
              <p className="text-xs text-[var(--text-secondary)] mt-0.5">{d.type}</p>
            )}
          </div>
          {d.files.length === 0 ? (
            <p className="px-4 py-3 text-xs text-[var(--text-muted)]">
              No filed version on file yet.
            </p>
          ) : (
            <ul className="divide-y divide-[var(--border-color)]">
              {d.files.map((f, idx) => (
                <li key={f.id} className="px-4 py-2.5">
                  <FileRowInline
                    file={f}
                    onPreview={() => openModal(d.files, idx)}
                    signEndpoint={signEndpoint}
                  />
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}

// ── Exhibits tab ────────────────────────────────────────────────────────

const EXHIBIT_PARTY_LABELS: Record<string, string> = {
  plaintiff: 'Plaintiff',
  defendant: 'Defendant',
  prosecution: 'Prosecution',
  accused: 'Accused',
  petitioner: 'Petitioner',
  respondent: 'Respondent',
  complainant: 'Complainant',
  other: 'Other',
};

const EXHIBIT_STATUS_TONE: Record<string, string> = {
  marked: 'bg-stone-100 text-stone-700 dark:bg-stone-500/10 dark:text-stone-300',
  offered: 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400',
  admitted: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400',
  denied: 'bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-400',
  withdrawn: 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400',
};

function compareExhibitLabels(a: string, b: string): number {
  const parse = (s: string) => {
    const [main, sub] = s.split(/-/, 2);
    return { main, sub: sub ?? '' };
  };
  const pa = parse(a);
  const pb = parse(b);
  const numA = /^\d+$/.test(pa.main);
  const numB = /^\d+$/.test(pb.main);
  let cmp = 0;
  if (numA && numB) cmp = parseInt(pa.main, 10) - parseInt(pb.main, 10);
  else if (numA) cmp = 1;
  else if (numB) cmp = -1;
  else cmp = pa.main.localeCompare(pb.main, undefined, { sensitivity: 'base' });
  if (cmp !== 0) return cmp;
  return pa.sub.localeCompare(pb.sub, undefined, { sensitivity: 'base', numeric: true });
}

function ExhibitsTab({ exhibits }: { exhibits: PortalExhibit[] }) {
  const [search, setSearch] = useState('');
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return exhibits;
    return exhibits.filter((e) =>
      `${e.label} ${e.title} ${e.purpose} ${e.description} ${e.status}`.toLowerCase().includes(q),
    );
  }, [exhibits, search]);

  if (exhibits.length === 0) {
    return (
      <div className="border border-[var(--border-color)] rounded-xl bg-card px-5 py-12 text-center">
        <ScrollText className="w-6 h-6 mx-auto text-[var(--text-muted)] mb-2" />
        <p className="text-sm text-[var(--text-secondary)]">
          No exhibits marked yet.
        </p>
      </div>
    );
  }

  const byParty = new Map<string, PortalExhibit[]>();
  for (const e of visible) {
    const key = `${e.offeredBy}::${e.partyLabel}`;
    const arr = byParty.get(key) ?? [];
    arr.push(e);
    byParty.set(key, arr);
  }
  for (const arr of byParty.values()) {
    arr.sort((a, b) => compareExhibitLabels(a.label, b.label));
  }
  const groups = Array.from(byParty.entries()).sort(([a], [b]) => a.localeCompare(b));

  return (
    <div className="space-y-6">
      {exhibits.length >= CONTROLS_THRESHOLD && (
        <div className="flex">
          <MiniSearch value={search} onChange={setSearch} placeholder="Search exhibits…" />
        </div>
      )}
      {visible.length === 0 && <NoMatchNote onClear={() => setSearch('')} />}
      {groups.map(([key, rows]) => {
        const [offeredBy, partyLabel] = key.split('::') as [string, string];
        const partyDisplay = offeredBy === 'other' && partyLabel.trim()
          ? partyLabel.trim()
          : EXHIBIT_PARTY_LABELS[offeredBy] ?? offeredBy;
        return (
          <div key={key}>
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-2">
              {partyDisplay}&apos;s Exhibits ({rows.length})
            </h3>
            <ul className="divide-y divide-[var(--border-color)] border border-[var(--border-color)] rounded-xl bg-card overflow-hidden">
              {rows.map((row) => {
                const tone = EXHIBIT_STATUS_TONE[row.status] ?? EXHIBIT_STATUS_TONE.marked;
                return (
                  <li key={row.id} className="px-4 py-3">
                    <div className="flex items-start gap-3">
                      <span className="shrink-0 inline-flex items-center justify-center min-w-[3rem] px-2 py-1 rounded-md bg-navy-50 dark:bg-navy-500/10 text-navy-700 dark:text-navy-300 text-[11px] font-bold font-mono mt-0.5">
                        Exh.&nbsp;{`"${row.label}"`}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-3">
                          <p className="text-sm font-medium text-foreground">
                            {row.title || <span className="italic text-[var(--text-muted)]">Untitled</span>}
                          </p>
                          <span className={`shrink-0 text-[10px] font-bold uppercase tracking-wider rounded-full px-2 py-0.5 ${tone}`}>
                            {row.status}
                          </span>
                        </div>
                        {row.purpose && (
                          <p className="text-xs text-[var(--text-secondary)] mt-1 whitespace-pre-wrap">
                            <span className="italic">Offered:</span> {row.purpose}
                          </p>
                        )}
                        {!row.purpose && row.description && (
                          <p className="text-xs text-[var(--text-secondary)] mt-1 whitespace-pre-wrap">
                            {row.description}
                          </p>
                        )}
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-[11px] text-[var(--text-muted)]">
                          {row.documentDate && <span>Dated {formatDate(row.documentDate)}</span>}
                          {row.file && row.file.signedUrl && (
                            <a
                              href={row.file.signedUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 text-navy-700 dark:text-navy-300 hover:underline"
                            >
                              <FileText className="w-3 h-3" />
                              {row.file.name}
                            </a>
                          )}
                          {row.rulingDate && (
                            <span title={row.rulingNote || undefined}>
                              Ruling {formatDate(row.rulingDate)}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

// ── Shared row components ───────────────────────────────────────────────

function FileRow({
  file, onPreview, signEndpoint,
}: {
  file: PortalFile;
  onPreview: () => void;
  signEndpoint: string;
}) {
  return (
    <li className="flex items-start justify-between gap-4 border border-[var(--border-color)] rounded-xl bg-card px-4 py-3">
      <button
        type="button"
        onClick={onPreview}
        className="min-w-0 flex-1 text-left group"
      >
        <p className="text-sm font-medium text-foreground truncate group-hover:text-gold-600 dark:group-hover:text-gold-400 transition-colors">
          {file.name}
        </p>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-[var(--text-secondary)] mt-0.5">
          {file.date && <span>{formatDate(file.date)}</span>}
          {file.origin && (
            <>
              <span className="text-[var(--text-muted)]">·</span>
              <span>{file.origin}</span>
            </>
          )}
          {file.isCourtRecord && (
            <>
              <span className="text-[var(--text-muted)]">·</span>
              <span className="text-amber-700 dark:text-amber-400">Court record</span>
            </>
          )}
        </div>
      </button>
      <FileActions file={file} onPreview={onPreview} signEndpoint={signEndpoint} />
    </li>
  );
}

function FileRowInline({
  file, onPreview, signEndpoint,
}: {
  file: PortalFile;
  onPreview: () => void;
  signEndpoint: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <button
        type="button"
        onClick={onPreview}
        className="min-w-0 flex-1 text-left group"
      >
        <p className="text-sm text-foreground truncate group-hover:text-gold-600 dark:group-hover:text-gold-400 transition-colors">
          {file.name}
        </p>
        {file.date && (
          <p className="text-[11px] text-[var(--text-muted)] mt-0.5">{formatDate(file.date)}</p>
        )}
      </button>
      <FileActions file={file} onPreview={onPreview} signEndpoint={signEndpoint} compact />
    </div>
  );
}

function FileActions({
  file, onPreview, signEndpoint, compact = false,
}: {
  file: PortalFile;
  onPreview: () => void;
  signEndpoint: string;
  compact?: boolean;
}) {
  const size = compact ? 'w-3 h-3' : 'w-3.5 h-3.5';
  const pad = compact ? 'p-1' : 'p-1.5';
  return (
    <div className="flex items-center gap-1 shrink-0">
      <button
        type="button"
        onClick={onPreview}
        title="Preview"
        aria-label={`Preview ${file.name}`}
        className={`${pad} rounded-md text-[var(--text-muted)] hover:text-foreground hover:bg-subtle transition-colors`}
      >
        <Eye className={size} />
      </button>
      <button
        type="button"
        onClick={() => void downloadFile(file, { signEndpoint })}
        title="Download"
        aria-label={`Download ${file.name}`}
        className={`${pad} rounded-md text-[var(--text-muted)] hover:text-foreground hover:bg-subtle transition-colors`}
      >
        <Download className={size} />
      </button>
    </div>
  );
}

function ScheduleRow({
  item, highlight = false,
}: {
  item: ScheduleItem;
  highlight?: boolean;
}) {
  const Icon = item.kind === 'hearing' ? Gavel : Handshake;
  return (
    <li
      className={`flex items-start gap-4 border rounded-xl px-4 py-3 ${
        highlight
          ? 'border-gold-200 dark:border-gold-400/30 bg-gold-50/40 dark:bg-gold-400/5'
          : 'border-[var(--border-color)] bg-card'
      }`}
    >
      <div
        className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
          highlight ? 'bg-gold-100 dark:bg-gold-400/10' : 'bg-subtle'
        }`}
      >
        <Icon className="w-4 h-4 text-[var(--text-secondary)]" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground truncate">{item.name}</p>
        <div className="flex flex-wrap items-center gap-x-2 text-xs text-[var(--text-secondary)] mt-0.5">
          {item.date && <span>{formatDateTime(item.date)}</span>}
          {item.subline && (
            <>
              <span className="text-[var(--text-muted)]">·</span>
              <span>{item.subline}</span>
            </>
          )}
        </div>
      </div>
    </li>
  );
}
