'use client';

import { PILL_TONE } from '@/components/ui/tone';
import { statusTone } from '@/lib/status-tone';
import { useState, useMemo, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  CheckSquare, FileText, Handshake, Scale, FolderOpen,
  AlertTriangle, ChevronRight, ChevronLeft, Filter, Search, X,
} from 'lucide-react';
import type { NotionHearingDetail, NotionDeliverableDetail, NotionTaskDetail, NotionFilingDetail } from '@/types/notion';
import { useDetailPane } from '@/components/DetailPaneContext';
import { toManilaDay } from '@/lib/dates';

// ── Helpers ──────────────────────────────────────────────────────────

function formatDate(d: string | null): string {
  if (!d) return '\u2014';
  // Accept either a plain YYYY-MM-DD date (DATE column) or a full ISO
  // timestamp (TIMESTAMPTZ column). Either way, format in Manila time so a
  // hearing at "2026-06-03 00:00:00 UTC" (= 8 AM Manila) shows as June 3,
  // not June 2 because of a user-local parse.
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d}T00:00:00Z` : d;
  return new Date(iso).toLocaleDateString('en-PH', {
    year: 'numeric', month: 'short', day: 'numeric', timeZone: 'Asia/Manila',
  });
}

function formatTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Manila' });
}

function getStatusStyle(status: string) {
  return PILL_TONE[statusTone(status)];
}

function isOverdue(date: string | null): boolean {
  if (!date) return false;
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
  return date < today;
}

function isDeliverableActive(status: string): boolean {
  const s = status.toLowerCase();
  return !s.includes('filed') && !s.includes('sent out') && !s.includes('archived');
}

function isHearingUpcoming(date: string | null): boolean {
  if (!date) return false;
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
  return toManilaDay(date) >= today;
}

// ── Types ────────────────────────────────────────────────────────────

interface Props {
  tasks: NotionTaskDetail[];
  deliverables: NotionDeliverableDetail[];
  hearings: NotionHearingDetail[];
  filings: NotionFilingDetail[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  meetings: any[];
  /**
   * Show a source-matter chip on each row. Defaults to auto-detect (true
   * only when rows span >1 matter). Group pages pass `true` so attribution
   * is always shown, even when the filtered set happens to land on one
   * member matter.
   */
  showSourceMatter?: boolean;
}

type TabKey = 'deliverables' | 'tasks' | 'hearings' | 'filings' | 'meetings';

const TAB_CONFIG: { key: TabKey; label: string; icon: typeof FileText }[] = [
  { key: 'deliverables', label: 'Deliverables', icon: FileText },
  { key: 'tasks', label: 'Tasks', icon: CheckSquare },
  { key: 'hearings', label: 'Hearings', icon: Scale },
  { key: 'filings', label: 'Filings', icon: FolderOpen },
  { key: 'meetings', label: 'Meetings', icon: Handshake },
];

// ── Component ────────────────────────────────────────────────────────

const HASH_TO_TAB: Record<string, TabKey> = {
  'section-tasks': 'tasks',
  'section-deliverables': 'deliverables',
  'section-hearings': 'hearings',
  'section-filings': 'filings',
  'section-meetings': 'meetings',
};

export default function MatterSections({ tasks, deliverables, hearings, filings, meetings, showSourceMatter: showSourceMatterProp }: Props) {
  const { openPane } = useDetailPane();
  const [activeTab, setActiveTab] = useState<TabKey>('deliverables');
  const [activeOnly, setActiveOnly] = useState(true);
  const [search, setSearch] = useState('');

  const showSourceMatter = useMemo(() => {
    if (showSourceMatterProp !== undefined) return showSourceMatterProp;
    const ids = new Set<string>();
    for (const d of deliverables) if (d.matterId) ids.add(d.matterId);
    for (const t of tasks) if (t.matterId) ids.add(t.matterId);
    for (const h of hearings) if (h.matterId) ids.add(h.matterId);
    for (const f of filings) if (f.matterId) ids.add(f.matterId);
    for (const m of meetings) if (m.matterId) ids.add(m.matterId);
    return ids.size > 1;
  }, [deliverables, tasks, hearings, filings, meetings, showSourceMatterProp]);

  // Reset search when switching tabs — each tab is its own scope.
  useEffect(() => { setSearch(''); }, [activeTab]);

  const searchMatch = useCallback(
    (name: string | null | undefined) => {
      if (!search.trim()) return true;
      return (name ?? '').toLowerCase().includes(search.toLowerCase());
    },
    [search],
  );

  const handleHash = useCallback(() => {
    const hash = window.location.hash.replace('#', '');
    const tab = HASH_TO_TAB[hash];
    if (tab) {
      setActiveTab(tab);
      requestAnimationFrame(() => {
        document.getElementById('matter-sections')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        history.replaceState(null, '', window.location.pathname + window.location.search);
      });
    }
  }, []);

  useEffect(() => {
    handleHash();
    window.addEventListener('hashchange', handleHash);
    return () => window.removeEventListener('hashchange', handleHash);
  }, [handleHash]);

  const overdueTasks = tasks.filter((t) => !t.done && isOverdue(t.dueDate)).length;

  const pureHearings = hearings.filter((h) => {
    const t = (h.type || '').toLowerCase();
    return t !== 'filing' && !t.includes('filing');
  });

  // Filtered lists — apply active-only filter, then search filter.
  const filteredDeliverables = (activeOnly
    ? deliverables.filter((d) => isDeliverableActive(d.status))
    : deliverables
  ).filter((d) => searchMatch(d.name));
  const filteredTasks = (activeOnly
    ? tasks.filter((t) => !t.done)
    : tasks
  ).filter((t) => searchMatch(t.name));
  const filteredHearings = (activeOnly
    ? pureHearings.filter((h) => isHearingUpcoming(h.date))
    : pureHearings
  ).filter((h) => searchMatch(h.name));
  const filteredFilings = (activeOnly
    ? filings.filter((f) => {
        const s = (f.status || '').toLowerCase();
        return !s.includes('filed') && !s.includes('sent out') && !s.includes('done') && !s.includes('completed') && !s.includes('archived');
      })
    : filings
  ).filter((f) => searchMatch(f.name));
  const filteredMeetings = (activeOnly
    ? meetings.filter((m) => isHearingUpcoming(m.date))
    : meetings
  ).filter((m) => searchMatch(m.name));

  // Counts for tab badges
  const counts: Record<TabKey, { filtered: number; total: number }> = useMemo(() => ({
    deliverables: { filtered: filteredDeliverables.length, total: deliverables.length },
    tasks: { filtered: filteredTasks.length, total: tasks.length },
    hearings: { filtered: filteredHearings.length, total: pureHearings.length },
    filings: { filtered: filteredFilings.length, total: filings.length },
    meetings: { filtered: filteredMeetings.length, total: meetings.length },
  }), [filteredDeliverables, filteredTasks, filteredHearings, filteredFilings, filteredMeetings, deliverables, tasks, pureHearings, filings, meetings]);

  return (
    <div id="matter-sections" className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] shadow-[var(--shadow-card)] overflow-hidden animate-fade-up mb-6">
      {/* Tab bar */}
      <div className="border-b border-[var(--border-color)]">
        <div className="flex items-center overflow-x-auto scrollbar-hide px-4 pt-1 -mb-px">
          {TAB_CONFIG.map(({ key, label, icon: Icon }) => {
            const c = counts[key];
            const isActive = activeTab === key;
            const hasOverdue = key === 'tasks' && overdueTasks > 0;
            return (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                className={`relative flex items-center gap-2 px-4 py-3.5 text-[13px] font-medium whitespace-nowrap transition-colors ${
                  isActive
                    ? 'text-gold-600 dark:text-gold-400'
                    : 'text-[var(--text-muted)] hover:text-foreground'
                }`}
              >
                <Icon className="w-4 h-4" />
                {label}
                <span className={`font-mono text-[11px] rounded-full px-2 py-0.5 tabular-nums ${
                  isActive
                    ? 'bg-gold-50 dark:bg-gold-500/10 text-gold-600 dark:text-gold-400'
                    : 'bg-[var(--subtle-bg)] text-[var(--text-muted)]'
                }`}>
                  {c.filtered}
                </span>
                {hasOverdue && (
                  <span className="w-1.5 h-1.5 rounded-full bg-red-500 absolute top-2.5 right-0.5" />
                )}
                {isActive && (
                  <span className="absolute bottom-0 left-4 right-4 h-0.5 bg-gold-500 dark:bg-gold-400 rounded-full" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-1.5 px-5 py-2.5 border-b border-[var(--border-color)] bg-[var(--subtle-bg)]/50">
        <button
          type="button"
          onClick={() => setActiveOnly(true)}
          className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
            activeOnly
              ? 'bg-foreground text-background'
              : 'text-[var(--text-muted)] hover:text-foreground hover:bg-[var(--subtle-bg)]'
          }`}
        >
          <Filter className="w-3 h-3" />
          Active Only
        </button>
        <button
          type="button"
          onClick={() => setActiveOnly(false)}
          className={`inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
            !activeOnly
              ? 'bg-foreground text-background'
              : 'text-[var(--text-muted)] hover:text-foreground hover:bg-[var(--subtle-bg)]'
          }`}
        >
          All Items
        </button>
        {activeOnly && counts[activeTab].filtered !== counts[activeTab].total && (
          <span className="text-[11px] text-[var(--text-muted)] ml-1">
            Showing {counts[activeTab].filtered} of {counts[activeTab].total}
          </span>
        )}
        <div className="ml-auto relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-[var(--text-muted)] pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={`Search ${activeTab}…`}
            className="w-44 sm:w-56 pl-7 pr-7 py-1.5 text-xs rounded-lg bg-[var(--card-bg)] border border-[var(--border-color)] text-foreground placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-gold-500/30 focus:border-gold-500"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 rounded text-[var(--text-muted)] hover:text-foreground hover:bg-[var(--subtle-bg)]"
              aria-label="Clear search"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* Tab content */}
      <div>
        {activeTab === 'deliverables' && (
          <TabContent
            items={filteredDeliverables}
            emptyIcon={FileText}
            emptyText={activeOnly ? 'No active deliverables' : 'No deliverables'}
            renderItem={(d) => (
              <Link
                key={d.id}
                href={`/dashboard/deliverables/${d.id}`}
                onClick={(e) => { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); openPane('deliverables', d.id); }}
                className="flex items-center justify-between gap-4 px-5 py-3 hover:bg-gold-50/40 dark:hover:bg-[rgba(201,168,76,0.06)] transition-all duration-150 group"
              >
                <div className="flex-1 min-w-0">
                  {showSourceMatter && d.matter && (
                    <p className="text-[10px] font-medium text-navy-700 dark:text-navy-400 mb-0.5 truncate">{d.matter}</p>
                  )}
                  <p className="text-sm font-medium text-foreground group-hover:text-gold-600 dark:group-hover:text-gold-400 truncate transition-colors duration-150">
                    {d.name || '(Untitled)'}
                  </p>
                  {d.priority && (
                    <p className={`text-[11px] font-medium mt-0.5 ${
                      d.priority.toLowerCase().includes('high') || d.priority.toLowerCase().includes('urgent')
                        ? 'text-red-500 dark:text-red-400'
                        : 'text-[var(--text-muted)]'
                    }`}>
                      {d.priority} priority
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2.5 shrink-0">
                  <span className={`text-[11px] rounded-full px-2.5 py-0.5 font-medium whitespace-nowrap border ${getStatusStyle(d.status)}`}>
                    {d.status || 'Unknown'}
                  </span>
                  {d.externalDueDate && (
                    <span className={`text-[11px] font-mono rounded-md px-2 py-0.5 font-medium inline-flex items-center gap-1 ${
                      isOverdue(d.externalDueDate)
                        ? 'bg-red-50 text-red-600 ring-1 ring-inset ring-red-200 dark:bg-red-500/10 dark:text-red-400 dark:ring-red-500/20'
                        : 'bg-[var(--subtle-bg)] text-[var(--text-secondary)] ring-1 ring-inset ring-[var(--border-color)]'
                    }`}>
                      {isOverdue(d.externalDueDate) && <AlertTriangle className="w-3 h-3" />}
                      {formatDate(d.externalDueDate).replace(/, \d{4}$/, '')}
                    </span>
                  )}
                  <ChevronRight className="w-3.5 h-3.5 text-[var(--text-muted)] opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
              </Link>
            )}
          />
        )}

        {activeTab === 'tasks' && (
          <TabContent
            items={filteredTasks}
            emptyIcon={CheckSquare}
            emptyText={activeOnly ? 'No open tasks' : 'No tasks'}
            renderItem={(t) => (
              <Link
                key={t.id}
                href={`/dashboard/tasks/${t.id}`}
                onClick={(e) => { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); openPane('tasks', t.id); }}
                className="flex items-center justify-between gap-4 px-5 py-3 hover:bg-gold-50/40 dark:hover:bg-[rgba(201,168,76,0.06)] transition-all duration-150 group"
              >
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <span className={`w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-colors ${
                    t.done
                      ? 'bg-emerald-500 border-emerald-500 text-white'
                      : 'border-[var(--border-color)]'
                  }`}>
                    {t.done && (
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    {showSourceMatter && t.matter && (
                      <p className="text-[10px] font-medium text-navy-700 dark:text-navy-400 truncate">{t.matter}</p>
                    )}
                    <p className={`text-sm font-medium truncate transition-colors duration-150 ${
                      t.done
                        ? 'text-[var(--text-muted)] line-through'
                        : 'text-foreground group-hover:text-gold-600 dark:group-hover:text-gold-400'
                    }`}>
                      {t.name || '(Untitled)'}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2.5 shrink-0">
                  {t.status && !t.done && (
                    <span className={`text-[11px] rounded-full px-2.5 py-0.5 font-medium whitespace-nowrap border ${getStatusStyle(t.status)}`}>
                      {t.status}
                    </span>
                  )}
                  {t.dueDate && (
                    <span className={`text-[11px] font-mono rounded-md px-2 py-0.5 font-medium inline-flex items-center gap-1 ${
                      !t.done && isOverdue(t.dueDate)
                        ? 'bg-red-50 text-red-600 ring-1 ring-inset ring-red-200 dark:bg-red-500/10 dark:text-red-400 dark:ring-red-500/20'
                        : 'bg-[var(--subtle-bg)] text-[var(--text-secondary)] ring-1 ring-inset ring-[var(--border-color)]'
                    }`}>
                      {!t.done && isOverdue(t.dueDate) && <AlertTriangle className="w-3 h-3" />}
                      {formatDate(t.dueDate).replace(/, \d{4}$/, '')}
                    </span>
                  )}
                  <ChevronRight className="w-3.5 h-3.5 text-[var(--text-muted)] opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
              </Link>
            )}
          />
        )}

        {activeTab === 'hearings' && (
          <TabContent
            items={filteredHearings}
            emptyIcon={Scale}
            emptyText={activeOnly ? 'No upcoming hearings' : 'No hearings'}
            renderItem={(h) => (
              <Link
                key={h.id}
                href={`/dashboard/hearings/${h.id}`}
                onClick={(e) => { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); openPane('hearings', h.id); }}
                className="flex items-center justify-between gap-4 px-5 py-3 hover:bg-gold-50/40 dark:hover:bg-[rgba(201,168,76,0.06)] transition-all duration-150 group"
              >
                <div className="flex-1 min-w-0">
                  {showSourceMatter && h.matter && (
                    <p className="text-[10px] font-medium text-navy-700 dark:text-navy-400 mb-0.5 truncate">{h.matter}</p>
                  )}
                  <p className="text-sm font-medium text-foreground group-hover:text-gold-600 dark:group-hover:text-gold-400 truncate transition-colors duration-150">
                    {h.name || '(Untitled)'}
                  </p>
                  {h.date && (
                    <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
                      {formatDate(h.date ?? null)}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2.5 shrink-0">
                  {h.type && (
                    <span className="text-[11px] rounded-full px-2.5 py-0.5 font-medium ring-1 ring-inset bg-red-50 text-red-700 ring-red-200/60 dark:bg-red-500/10 dark:text-red-400 dark:ring-red-500/20">
                      {h.type}
                    </span>
                  )}
                  {h.status && h.status !== 'Pending' && (
                    <span className={`text-[11px] rounded-full px-2 py-0.5 font-medium whitespace-nowrap border ${getStatusStyle(h.status)}`}>
                      {h.status}
                    </span>
                  )}
                  <ChevronRight className="w-3.5 h-3.5 text-[var(--text-muted)] opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
              </Link>
            )}
          />
        )}

        {activeTab === 'filings' && (
          <TabContent
            items={filteredFilings}
            emptyIcon={FolderOpen}
            emptyText={activeOnly ? 'No pending filings' : 'No filings'}
            renderItem={(f) => (
              <Link
                key={f.id}
                href={`/dashboard/deliverables/${f.id}`}
                onClick={(e) => { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); openPane('filings', f.id); }}
                className="flex items-center justify-between gap-4 px-5 py-3 hover:bg-gold-50/40 dark:hover:bg-[rgba(201,168,76,0.06)] transition-all duration-150 group"
              >
                <div className="flex-1 min-w-0">
                  {showSourceMatter && f.matter && (
                    <p className="text-[10px] font-medium text-navy-700 dark:text-navy-400 mb-0.5 truncate">{f.matter}</p>
                  )}
                  <p className="text-sm font-medium text-foreground group-hover:text-gold-600 dark:group-hover:text-gold-400 truncate transition-colors duration-150">
                    {f.name || '(Untitled)'}
                  </p>
                  {f.date && (
                    <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
                      {formatDate(f.date ?? null)}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2.5 shrink-0">
                  {f.status && (
                    <span className={`text-[11px] rounded-full px-2.5 py-0.5 font-medium whitespace-nowrap border ${getStatusStyle(f.status)}`}>
                      {f.status}
                    </span>
                  )}
                  <ChevronRight className="w-3.5 h-3.5 text-[var(--text-muted)] opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
              </Link>
            )}
          />
        )}

        {activeTab === 'meetings' && (
          <TabContent
            items={filteredMeetings}
            emptyIcon={Handshake}
            emptyText={activeOnly ? 'No upcoming meetings' : 'No meetings'}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            renderItem={(m: any) => (
              <Link
                key={m.id}
                href={`/dashboard/meetings/${m.id}`}
                onClick={(e) => { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); openPane('meetings', m.id); }}
                className="flex items-center justify-between gap-4 px-5 py-3 hover:bg-gold-50/40 dark:hover:bg-[rgba(201,168,76,0.06)] transition-all duration-150 group"
              >
                <div className="flex-1 min-w-0">
                  {showSourceMatter && m.matter && (
                    <p className="text-[10px] font-medium text-navy-700 dark:text-navy-400 mb-0.5 truncate">{m.matter}</p>
                  )}
                  <p className="text-sm font-medium text-foreground group-hover:text-gold-600 dark:group-hover:text-gold-400 truncate transition-colors duration-150">
                    {m.name || '(Untitled)'}
                  </p>
                  {m.date && (
                    <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
                      {formatDate(m.date ?? null)}
                      {m.date?.includes('T') && ` at ${formatTime(m.date)}`}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2.5 shrink-0">
                  {m.type && (
                    <span className="text-[11px] rounded-full px-2.5 py-0.5 font-medium ring-1 ring-inset bg-violet-50 text-violet-700 ring-violet-200/60 dark:bg-violet-500/10 dark:text-violet-400 dark:ring-violet-500/20">
                      {m.type}
                    </span>
                  )}
                  {m.isAttended && (
                    <span className="w-5 h-5 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    </span>
                  )}
                  <ChevronRight className="w-3.5 h-3.5 text-[var(--text-muted)] opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
              </Link>
            )}
          />
        )}


      </div>
    </div>
  );
}

// ── Generic tab content wrapper ──────────────────────────────────────

function TabContent<T extends { id: string }>({
  items,
  emptyIcon: EmptyIcon,
  emptyText,
  renderItem,
  pageSize = 15,
}: {
  items: T[];
  emptyIcon: typeof FileText;
  emptyText: string;
  renderItem: (item: T) => React.ReactNode;
  pageSize?: number;
}) {
  const [page, setPage] = useState(0);

  // Reset to page 0 whenever the item count shrinks below the current window
  // (e.g. user toggles Active Only or types in search). Avoids "no items" on
  // a now-past-the-end page.
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  useEffect(() => {
    if (page >= totalPages) setPage(0);
  }, [page, totalPages]);

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-center">
        <EmptyIcon className="w-8 h-8 text-[var(--text-muted)] mb-2 opacity-30" />
        <p className="text-sm text-[var(--text-muted)]">{emptyText}</p>
      </div>
    );
  }

  const start = page * pageSize;
  const end = Math.min(start + pageSize, items.length);
  const pageItems = items.slice(start, end);

  return (
    <div className="divide-y divide-[var(--border-color)]">
      {pageItems.map(renderItem)}
      {items.length > pageSize && (
        <div className="flex items-center justify-between gap-3 px-5 py-2.5">
          <span className="text-[11px] text-[var(--text-muted)] tabular-nums">
            {start + 1}–{end} of {items.length}
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="p-1 rounded-md text-[var(--text-muted)] hover:text-foreground hover:bg-[var(--subtle-bg)] disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-[var(--text-muted)] transition-colors"
              aria-label="Previous page"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <span className="text-[11px] text-[var(--text-secondary)] tabular-nums px-1.5">
              {page + 1} / {totalPages}
            </span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              className="p-1 rounded-md text-[var(--text-muted)] hover:text-foreground hover:bg-[var(--subtle-bg)] disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-[var(--text-muted)] transition-colors"
              aria-label="Next page"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
