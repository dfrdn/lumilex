'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import {
  Gavel, FolderOpen, Paperclip, Check, X,
  Filter, ChevronDown, Upload,
} from 'lucide-react';
import FileAttachmentLinks from '@/components/FileAttachmentLinks';
import type { NotionHearingDetail, NotionFileDetail, NotionFilingDetail, FileAttachment } from '@/types/notion';
import type { MatterFiledCopy } from '@/lib/queries/detail';

// ── Types ─────────────────────────────────────────────────────────

type EventKind = 'hearing' | 'filing' | 'file';
type FilterMode = 'all' | 'hearing' | 'filing' | 'file';

interface TimelineEvent {
  id: string;
  name: string;
  date: string; // YYYY-MM-DD
  rawDate: string; // original ISO for sorting
  kind: EventKind;
  type: string; // badge label
  status: string;
  href: string;
  isResolved: boolean;
  fileUrls?: FileAttachment[];
  /**
   * True only for filing events whose filed copy hasn't been uploaded yet.
   * Drives the "Filed copy not yet uploaded" hint on the card.
   */
  awaitingFiledCopy?: boolean;
}

interface MonthGroup {
  key: string; // "2026-03"
  label: string; // "March 2026"
  events: TimelineEvent[];
}

interface Props {
  hearings: NotionHearingDetail[];
  files: NotionFileDetail[];
  /**
   * Filings = deliverables with an external_due_date. Merged onto the
   * timeline as kind='filing' alongside hearings/files so users can see
   * the case unfold in one view.
   */
  filings?: NotionFilingDetail[];
  /**
   * "Filed version" rows for this matter. Used to attach preview/download
   * affordances to each filing card (or show a "not yet uploaded" hint
   * when missing).
   */
  filedCopies?: MatterFiledCopy[];
  caseTitle: string;
  caseNumber: string;
  court: string;
  outcome: string;
}

// ── Helpers ────────────────────────────────────────────────────────

function extractDate(iso: string | null): string {
  if (!iso) return '';
  // If the input is already a date-only string, return as-is.
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  // Otherwise it's a timestamp — return the Manila calendar date, not the
  // raw UTC date-part, so events don't jump to the previous day for
  // early-morning Manila times stored as late-evening UTC.
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso.split('T')[0];
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
}

function formatDate(dateStr: string): string {
  if (!dateStr) return '';
  // Accept either YYYY-MM-DD or a full ISO timestamp, format in Manila tz.
  // Parsing "YYYY-MM-DD" without Z yields LOCAL midnight which is one day
  // off for users west of UTC (including Manila when combined with a later
  // UTC format). Pin to UTC midnight then format as Manila.
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? `${dateStr}T00:00:00Z` : dateStr;
  const d = new Date(iso);
  return d.toLocaleDateString('en-PH', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'Asia/Manila',
  });
}

function formatMonthYear(dateStr: string): string {
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? `${dateStr}T00:00:00Z` : dateStr;
  const d = new Date(iso);
  return d.toLocaleDateString('en-PH', {
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Manila',
  });
}

const KIND_CONFIG: Record<EventKind, {
  icon: typeof Gavel;
  dot: string;
  dotDark: string;
  ring: string;
  badge: string;
  label: string;
}> = {
  hearing: {
    icon: Gavel,
    dot: 'bg-red-500',
    dotDark: 'dark:bg-red-400',
    ring: 'ring-red-500/20 dark:ring-red-400/20',
    badge: 'bg-red-50 text-red-700 ring-red-200/60 dark:bg-red-500/12 dark:text-red-400 dark:ring-red-500/20',
    label: 'Hearing',
  },
  filing: {
    icon: FolderOpen,
    dot: 'bg-teal-500',
    dotDark: 'dark:bg-teal-400',
    ring: 'ring-teal-500/20 dark:ring-teal-400/20',
    badge: 'bg-teal-50 text-teal-700 ring-teal-200/60 dark:bg-teal-500/12 dark:text-teal-400 dark:ring-teal-500/20',
    label: 'Filing',
  },
  file: {
    icon: Paperclip,
    dot: 'bg-gold-500',
    dotDark: 'dark:bg-gold-400',
    ring: 'ring-gold-500/20 dark:ring-gold-400/20',
    badge: 'bg-gold-50 text-gold-700 ring-gold-200/60 dark:bg-gold-400/12 dark:text-gold-400 dark:ring-gold-400/20',
    label: 'File',
  },
};

const FILTERS: { mode: FilterMode; label: string; icon: typeof Gavel }[] = [
  { mode: 'all', label: 'All', icon: Filter },
  { mode: 'hearing', label: 'Hearings', icon: Gavel },
  { mode: 'filing', label: 'Filings', icon: FolderOpen },
  { mode: 'file', label: 'Files', icon: Paperclip },
];

// ── Component ──────────────────────────────────────────────────────

export default function CaseTimeline({
  hearings,
  files,
  filings = [],
  filedCopies = [],
  caseTitle,
  caseNumber,
  court,
  outcome,
}: Props) {
  const [filter, setFilter] = useState<FilterMode>('all');
  const [expanded, setExpanded] = useState(true);

  // Normalize all events into a common shape
  const allEvents = useMemo<TimelineEvent[]>(() => {
    const hearingEvents: TimelineEvent[] = hearings.map((h) => ({
      id: h.id,
      name: h.name,
      date: extractDate(h.date),
      rawDate: h.date ?? '',
      kind: (h.type === 'Filing' ? 'filing' : 'hearing') as EventKind,
      type: h.type,
      status: h.status,
      href: h.type === 'Filing'
        ? `/dashboard/deliverables/${h.id}`
        : `/dashboard/hearings/${h.id}`,
      isResolved: h.isAttended || h.isFiled || h.status === 'Cancelled',
    }));

    const fileEvents: TimelineEvent[] = files
      .filter((f) => f.documentDate || f.dateReceived || f.dateSentFiled || f.createdTime)
      .map((f) => ({
        id: f.id,
        name: f.name,
        date: extractDate(f.documentDate ?? f.dateReceived ?? f.dateSentFiled ?? f.createdTime),
        rawDate: f.documentDate ?? f.dateReceived ?? f.dateSentFiled ?? f.createdTime ?? '',
        kind: 'file' as EventKind,
        type: f.origin || 'File',
        status: f.actionTaken || '',
        href: `/dashboard/files/${f.id}`,
        isResolved: false,
        fileUrls: f.fileUrls,
      }));

    // Group filed copies by their parent deliverable so each filing event
    // can show preview/download affordances directly on its card.
    const filedByDeliverable = new Map<string, FileAttachment[]>();
    for (const c of filedCopies) {
      const arr = filedByDeliverable.get(c.deliverableId) ?? [];
      arr.push({ name: c.fileName, url: c.fileUrl });
      filedByDeliverable.set(c.deliverableId, arr);
    }

    // Filings = deliverables with a deadline. Dedupe against any legacy
    // hearings rows that already represent the same filing (type='Filing'
    // shares the same deliverable id).
    const hearingIds = new Set(hearingEvents.map((e) => e.id));
    const filingEvents: TimelineEvent[] = filings
      .filter((f) => !hearingIds.has(f.id))
      .filter((f) => !!f.date)
      .map((f) => {
        const status = (f.status || '').toLowerCase();
        const attachments = filedByDeliverable.get(f.id) ?? [];
        return {
          id: f.id,
          name: f.name,
          date: extractDate(f.date),
          rawDate: f.date ?? '',
          kind: 'filing' as EventKind,
          type: 'Filing',
          status: f.status,
          href: `/dashboard/deliverables/${f.id}`,
          isResolved:
            status.includes('filed') ||
            status.includes('sent out') ||
            status === 'cancelled' ||
            status.includes('archived'),
          fileUrls: attachments.length > 0 ? attachments : undefined,
          awaitingFiledCopy: attachments.length === 0,
        };
      });

    return [...hearingEvents, ...fileEvents, ...filingEvents].sort((a, b) =>
      a.rawDate.localeCompare(b.rawDate),
    );
  }, [hearings, files, filings, filedCopies]);

  // Apply filter
  const filtered = useMemo(() => {
    if (filter === 'all') return allEvents;
    return allEvents.filter((e) => e.kind === filter);
  }, [allEvents, filter]);

  // Group by month
  const groups = useMemo<MonthGroup[]>(() => {
    const map = new Map<string, TimelineEvent[]>();
    for (const ev of filtered) {
      const key = ev.date.slice(0, 7); // "2026-03"
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(ev);
    }
    return Array.from(map.entries()).map(([key, events]) => ({
      key,
      label: formatMonthYear(events[0].date),
      events,
    }));
  }, [filtered]);

  // Counts for filter badges
  const counts = useMemo(() => ({
    all: allEvents.length,
    hearing: allEvents.filter((e) => e.kind === 'hearing').length,
    filing: allEvents.filter((e) => e.kind === 'filing').length,
    file: allEvents.filter((e) => e.kind === 'file').length,
  }), [allEvents]);

  if (allEvents.length === 0) return null;

  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });

  return (
    <>
      <section className="bg-card rounded-xl border border-[var(--border-color)] shadow-[var(--shadow-card)] overflow-hidden transition-all duration-200 hover:shadow-[var(--shadow-card-hover)] hover:border-[var(--border-hover)] animate-fade-up">
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-color)] cursor-pointer select-none hover:bg-card-hover transition-colors duration-150"
          onClick={() => setExpanded((o) => !o)}
        >
          <div className="flex items-center gap-2.5">
            <span className="text-[var(--text-muted)]">
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 8v4l3 3" />
                <circle cx="12" cy="12" r="10" />
              </svg>
            </span>
            <h2 className="text-[15px] font-semibold text-foreground">Case Timeline</h2>
            <span className="font-mono text-[11px] font-medium text-gold-400 bg-gold-50 dark:bg-[rgba(185, 143, 69,0.12)] rounded-full px-2.5 py-0.5 tabular-nums tracking-wide">
              {allEvents.length}
            </span>
          </div>
          <ChevronDown className={`w-4 h-4 text-[var(--text-muted)] transition-transform duration-250 ease-out ${expanded ? 'rotate-0' : '-rotate-90'}`} />
        </div>

        {/* Collapsible body */}
        <div className={`grid transition-[grid-template-rows] duration-300 ease-out ${expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
          <div className="overflow-hidden">
            <div className="px-5 py-5">
              {/* Case info strip */}
              {(caseNumber || court) && (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mb-5 pb-4 border-b border-[var(--border-color)]">
                  {caseNumber && (
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--text-muted)]">Case No.</span>
                      <span className="text-sm font-semibold text-foreground font-mono">{caseNumber}</span>
                    </div>
                  )}
                  {caseTitle && (
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--text-muted)]">Title</span>
                      <span className="text-sm text-[var(--text-secondary)]">{caseTitle}</span>
                    </div>
                  )}
                  {court && (
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--text-muted)]">Court</span>
                      <span className="text-sm text-[var(--text-secondary)]">{court}</span>
                    </div>
                  )}
                  {outcome && (
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--text-muted)]">Outcome</span>
                      <span className="text-sm font-medium text-emerald-600 dark:text-emerald-400">{outcome}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Filter toolbar */}
              <div className="flex items-center gap-1 mb-5 overflow-x-auto pb-1 -mb-1">
                {FILTERS.map(({ mode, label, icon: Icon }) => {
                  const count = counts[mode];
                  if (count === 0 && mode !== 'all') return null;
                  const active = filter === mode;
                  return (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setFilter(mode)}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-150 cursor-pointer whitespace-nowrap ${
                        active
                          ? 'bg-foreground text-background shadow-sm'
                          : 'text-[var(--text-secondary)] hover:text-foreground hover:bg-subtle border border-[var(--border-color)]'
                      }`}
                    >
                      <Icon className="w-3 h-3" />
                      {label}
                      <span className={`font-mono text-[10px] tabular-nums ${active ? 'opacity-70' : 'text-[var(--text-muted)]'}`}>
                        {count}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Timeline */}
              {filtered.length === 0 ? (
                <div className="text-center py-8 text-sm text-[var(--text-muted)]">
                  No {filter === 'all' ? 'events' : filter + 's'} in this case
                </div>
              ) : (
                <div className="relative">
                  {groups.map((group, gi) => (
                    <div key={group.key} className={gi > 0 ? 'mt-6' : ''}>
                      {/* Month header */}
                      <div className="sticky top-0 z-10 mb-3">
                        <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)] bg-card px-1 pr-3">
                          {group.label}
                        </span>
                      </div>

                      {/* Events in this month */}
                      <div className="relative ml-3 pl-6 border-l-2 border-[var(--border-color)]">
                        {group.events.map((ev, ei) => {
                          const config = KIND_CONFIG[ev.kind];
                          const Icon = config.icon;
                          const isFuture = ev.date > todayStr;
                          const isLast = gi === groups.length - 1 && ei === group.events.length - 1;

                          return (
                            <div
                              key={ev.id}
                              className={`relative group ${ei < group.events.length - 1 || !isLast ? 'pb-4' : ''}`}
                            >
                              {/* Timeline dot */}
                              <div className={`absolute -left-[calc(1.5rem+5px)] top-1.5 w-2.5 h-2.5 rounded-full ring-[3px] ring-card ${config.dot} ${config.dotDark} ${isFuture ? 'opacity-40' : ''}`} />

                              {/* Event card (link to entity detail page) */}
                              <Link
                                href={ev.href}
                                className={`block rounded-lg border bg-card p-3 transition-all duration-150 hover:shadow-[var(--shadow-card)] hover:border-[var(--border-hover)] group-hover:translate-x-0.5 ${isFuture ? 'opacity-60 border-dashed dark:border-[var(--border-color)]' : 'border-[var(--border-color)]'}`}
                              >
                                <div className="flex items-start justify-between gap-2">
                                  <div className="flex-1 min-w-0">
                                    {/* Type badge + status */}
                                    <div className="flex items-center gap-2 mb-1">
                                      <span className={`inline-flex items-center gap-1 text-[10px] font-semibold rounded-md px-1.5 py-0.5 ring-1 ring-inset ${config.badge}`}>
                                        <Icon className="w-2.5 h-2.5" />
                                        {ev.type || config.label}
                                      </span>
                                      {ev.status && ev.kind !== 'file' && (
                                        <span className="text-[10px] font-medium text-[var(--text-muted)] bg-subtle rounded-md px-1.5 py-0.5">
                                          {ev.status}
                                        </span>
                                      )}
                                    </div>

                                    {/* Name */}
                                    <p className="text-sm font-medium text-foreground line-clamp-2 group-hover:text-gold-600 dark:group-hover:text-gold-400 transition-colors duration-150">
                                      {ev.name || '(Untitled)'}
                                    </p>

                                    {/* Date */}
                                    <p className="text-[11px] font-mono text-[var(--text-muted)] mt-1">
                                      {formatDate(ev.date)}
                                    </p>
                                  </div>

                                  {/* Resolution indicator */}
                                  {ev.isResolved && ev.kind !== 'file' && (
                                    <span className={`shrink-0 mt-1 inline-flex items-center justify-center w-5 h-5 rounded-full ${
                                      ev.status === 'Cancelled'
                                        ? 'bg-red-500/15 text-red-500 dark:text-red-400'
                                        : 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                                    }`}>
                                      {ev.status === 'Cancelled' ? (
                                        <X className="w-3 h-3" />
                                      ) : (
                                        <Check className="w-3 h-3" />
                                      )}
                                    </span>
                                  )}
                                </div>

                                {/* File attachments — stop propagation so clicking a file link
                                    opens the preview instead of following the card's href. */}
                                {ev.fileUrls && ev.fileUrls.length > 0 && (
                                  <div className="mt-2 pt-2 border-t border-[var(--border-color)]" onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}>
                                    <FileAttachmentLinks files={ev.fileUrls} />
                                  </div>
                                )}

                                {/* "Filed copy not yet uploaded" hint — only on
                                    filing events with no attached filed version.
                                    Lets the user spot what's missing without
                                    drilling into each deliverable. */}
                                {ev.kind === 'filing' && ev.awaitingFiledCopy && (
                                  <div className="mt-2 pt-2 border-t border-dashed border-[var(--border-color)]">
                                    <p className="inline-flex items-center gap-1 text-[10px] font-medium text-[var(--text-muted)] italic">
                                      <Upload className="w-2.5 h-2.5" />
                                      Filed copy not yet uploaded
                                    </p>
                                  </div>
                                )}
                              </Link>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
