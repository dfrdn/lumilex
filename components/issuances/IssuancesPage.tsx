'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Scroll, Plus, Search, AlertTriangle, ExternalLink, Pin, Loader2,
} from 'lucide-react';
import {
  SOURCES, SOURCE_KEYS, TYPE_TAXONOMY, PRACTICE_AREAS, type SourceKey,
} from '@/lib/issuances/sources';
import {
  useIssuances, useIssuance, type IssuanceSummary,
} from '@/hooks/use-issuances';
import IssuanceDetail from './IssuanceDetail';
import IssuanceForm from './IssuanceForm';
import ScrapeRunStrip from './ScrapeRunStrip';
import { useHydrated } from '@/hooks/use-page-visits';
import { ConfidenceChip, SourceBadge } from './chips';

interface Props {
  canEdit?: boolean;
  /** Render the admin variant: show ScrapeRunStrip + low-confidence default filter. */
  variant?: 'lawyer' | 'admin';
}

type ViewMode = 'list' | 'read' | 'create' | 'edit';

export default function IssuancesPage({ canEdit = false, variant = 'lawyer' }: Props) {
  const mounted = useHydrated();

  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [activeId, setActiveId] = useState<number | null>(null);

  const [filterSource, setFilterSource] = useState<SourceKey | ''>('');
  const [filterType, setFilterType] = useState('');
  const [filterPractice, setFilterPractice] = useState('');
  const [filterStatus, setFilterStatus] = useState<'' | 'published' | 'archived'>('');
  const [filterConfidence, setFilterConfidence] = useState<'' | 'low'>('');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 220);
    return () => clearTimeout(t);
  }, [search]);

  // Types are source-scoped, so a new source clears the type filter.
  const chooseSource = (next: SourceKey | '') => {
    if (next === filterSource) return;
    setFilterSource(next);
    setFilterType('');
  };

  const { data: issuances, mutate, error } = useIssuances({
    source: filterSource || undefined,
    type: filterType || undefined,
    practiceArea: filterPractice || undefined,
    status: filterStatus || undefined,
    search: debouncedSearch || undefined,
    confidence: filterConfidence || undefined,
    limit: 200,
  });

  const { data: activeIssuance } = useIssuance(
    viewMode === 'read' || viewMode === 'edit' ? activeId : null,
  );

  const openDetail = useCallback((id: number) => {
    setActiveId(id);
    setViewMode('read');
  }, []);

  const backToList = useCallback(() => {
    setViewMode('list');
    setActiveId(null);
  }, []);

  // ── Sub-views ─────────────────────────────────────────────────────
  if (viewMode === 'create') {
    return (
      <IssuanceForm
        issuance={null}
        onBack={backToList}
        onSaved={() => {
          mutate();
          backToList();
        }}
      />
    );
  }

  if (viewMode === 'edit' && !activeIssuance) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-5 h-5 text-gold-500 animate-spin dark:text-gold-400" />
      </div>
    );
  }

  if (viewMode === 'edit' && activeIssuance) {
    return (
      <IssuanceForm
        issuance={activeIssuance}
        onBack={() => setViewMode('read')}
        onSaved={() => {
          mutate();
          setViewMode('read');
        }}
      />
    );
  }

  if (viewMode === 'read' && activeIssuance) {
    return (
      <IssuanceDetail
        issuance={activeIssuance}
        canEdit={canEdit}
        onBack={backToList}
        onEdit={() => setViewMode('edit')}
        onDeleted={() => {
          mutate();
          backToList();
        }}
        onMutate={mutate}
      />
    );
  }

  // ── List view ─────────────────────────────────────────────────────
  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gold-50 dark:bg-gold-900/20 flex items-center justify-center">
            <Scroll className="w-5 h-5 text-gold-600 dark:text-gold-400" />
          </div>
          <div>
            <h1 className="font-serif text-2xl font-bold tracking-tight text-stone-900 dark:text-stone-100">
              Issuances
            </h1>
            <p className="text-xs text-stone-400 dark:text-stone-500 mt-0.5">
              {mounted && issuances
                ? `${issuances.length} issuance${issuances.length !== 1 ? 's' : ''}`
                : ' '}
            </p>
          </div>
        </div>
        {canEdit && (
          <button
            type="button"
            onClick={() => setViewMode('create')}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-gold-500 text-white hover:bg-gold-600 transition-colors cursor-pointer shadow-sm"
          >
            <Plus className="w-4 h-4" /> New issuance
          </button>
        )}
      </div>

      {/* Admin-only scraper status */}
      {variant === 'admin' && <ScrapeRunStrip />}

      {/* Source chips */}
      <div className="flex flex-wrap gap-1.5">
        <FilterChip
          label="All sources"
          active={!filterSource}
          onClick={() => chooseSource('')}
        />
        {SOURCE_KEYS.map((key) => (
          <FilterChip
            key={key}
            label={SOURCES[key].shortLabel}
            title={SOURCES[key].label}
            active={filterSource === key}
            onClick={() => chooseSource(filterSource === key ? '' : key)}
          />
        ))}
      </div>

      {/* Type chips — only when a source is selected */}
      {filterSource && (
        <div className="flex flex-wrap gap-1.5">
          <FilterChip
            label="All types"
            active={!filterType}
            onClick={() => setFilterType('')}
            tone="subtle"
          />
          {TYPE_TAXONOMY[filterSource].map((t) => (
            <FilterChip
              key={t}
              label={t}
              active={filterType === t}
              onClick={() => setFilterType(filterType === t ? '' : t)}
              tone="subtle"
            />
          ))}
        </div>
      )}

      {/* Practice areas + search + curator-only filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400 dark:text-stone-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search title, number, summary…"
            className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] text-stone-800 dark:text-stone-200 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-gold-500/30 focus:border-gold-400 dark:placeholder:text-stone-500"
          />
        </div>
        <select
          value={filterPractice}
          onChange={(e) => setFilterPractice(e.target.value)}
          className="text-sm rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] text-stone-700 dark:text-stone-300 px-3 py-2 cursor-pointer focus:outline-none focus:ring-2 focus:ring-gold-500/30"
          aria-label="Filter by practice area"
        >
          <option value="">All practice areas</option>
          {PRACTICE_AREAS.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        {canEdit && (
          <>
            <button
              type="button"
              onClick={() => setFilterConfidence(filterConfidence === 'low' ? '' : 'low')}
              className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border transition-colors cursor-pointer ${
                filterConfidence === 'low'
                  ? 'border-amber-300 text-amber-700 bg-amber-50 dark:border-amber-700 dark:text-amber-300 dark:bg-amber-900/20'
                  : 'border-stone-200 text-stone-600 hover:border-amber-300 dark:hover:border-amber-500/50 dark:border-stone-700 dark:text-stone-400'
              }`}
            >
              <AlertTriangle className="w-3.5 h-3.5" /> Low confidence only
            </button>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value as '' | 'published' | 'archived')}
              className="text-sm rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] text-stone-700 dark:text-stone-300 px-3 py-2 cursor-pointer focus:outline-none focus:ring-2 focus:ring-gold-500/30"
              aria-label="Status filter"
            >
              <option value="">Published + archived</option>
              <option value="published">Published only</option>
              <option value="archived">Archived only</option>
            </select>
          </>
        )}
      </div>

      {/* List */}
      {!mounted || (!issuances && !error) ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-5 h-5 text-gold-500 animate-spin dark:text-gold-400" />
        </div>
      ) : error ? (
        <div className="px-4 py-3 text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg dark:bg-rose-900/20 dark:border-rose-800/40 dark:text-rose-300">
          Failed to load issuances.
        </div>
      ) : !issuances || issuances.length === 0 ? (
        <EmptyState canEdit={canEdit} onCreate={() => setViewMode('create')} />
      ) : (
        <IssuanceList items={issuances} onOpen={openDetail} />
      )}
    </div>
  );
}

// ── Filter chip ────────────────────────────────────────────────────

function FilterChip({
  label,
  title,
  active,
  onClick,
  tone = 'strong',
}: {
  label: string;
  title?: string;
  active: boolean;
  onClick: () => void;
  tone?: 'strong' | 'subtle';
}) {
  if (tone === 'subtle') {
    return (
      <button
        type="button"
        onClick={onClick}
        title={title}
        className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors cursor-pointer ${
          active
            ? 'bg-stone-700 dark:bg-stone-200 text-white dark:text-stone-900'
            : 'bg-stone-50 dark:bg-stone-900/40 text-stone-600 dark:text-stone-400 hover:bg-stone-100 dark:hover:bg-stone-800'
        }`}
      >
        {label}
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
        active
          ? 'bg-stone-800 dark:bg-stone-200 text-white dark:text-stone-900'
          : 'bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-400 hover:bg-stone-200 dark:hover:bg-stone-700'
      }`}
    >
      {label}
    </button>
  );
}

// ── Empty state ────────────────────────────────────────────────────

function EmptyState({ canEdit, onCreate }: { canEdit: boolean; onCreate: () => void }) {
  return (
    <div className="text-center py-20">
      <Scroll className="w-10 h-10 mx-auto text-stone-300 dark:text-stone-600 mb-3" />
      <p className="text-sm text-stone-500 dark:text-stone-400">
        No issuances match the current filters.
      </p>
      {canEdit && (
        <button
          type="button"
          onClick={onCreate}
          className="mt-3 text-sm text-gold-600 dark:text-gold-400 hover:underline cursor-pointer"
        >
          Add one manually
        </button>
      )}
    </div>
  );
}

// ── List ───────────────────────────────────────────────────────────

function IssuanceList({
  items,
  onOpen,
}: {
  items: IssuanceSummary[];
  onOpen: (id: number) => void;
}) {
  // Group by year-month of date_issued (fallback to created_at when missing).
  const groups = useMemo(() => {
    const m = new Map<string, IssuanceSummary[]>();
    for (const it of items) {
      const d = it.date_issued ? new Date(`${it.date_issued}T00:00:00`) : new Date(it.created_at);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const bucket = m.get(key) ?? [];
      bucket.push(it);
      m.set(key, bucket);
    }
    return Array.from(m.entries()).sort(([a], [b]) => (a < b ? 1 : -1));
  }, [items]);

  return (
    <div className="space-y-7">
      {groups.map(([key, bucket]) => {
        const [yy, mm] = key.split('-');
        const monthLabel = new Date(Number(yy), Number(mm) - 1, 1).toLocaleDateString('en-PH', {
          month: 'long',
          year: 'numeric',
        });
        return (
          <div key={key}>
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500 mb-2 px-1">
              {monthLabel}
            </h3>
            <div className="space-y-2">
              {bucket.map((it) => (
                <IssuanceRow key={it.id} item={it} onOpen={() => onOpen(it.id)} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function IssuanceRow({ item, onOpen }: { item: IssuanceSummary; onOpen: () => void }) {
  const date = item.date_issued
    ? new Date(`${item.date_issued}T00:00:00`).toLocaleDateString('en-PH', {
        month: 'short',
        day: 'numeric',
      })
    : null;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
      className="group bg-[var(--card-bg)] border border-[var(--border-color)] rounded-xl p-4 hover:border-gold-300 dark:hover:border-gold-700 transition-colors cursor-pointer"
    >
      <div className="flex items-start gap-3">
        <div className="shrink-0 w-14 text-right">
          <p className="text-[11px] font-semibold text-stone-400 dark:text-stone-500 uppercase tracking-wide">
            {date ?? '—'}
          </p>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5 mb-1">
            <SourceBadge source={item.source} />
            <span className="text-[10px] font-medium text-stone-500 dark:text-stone-400 uppercase tracking-wide">
              {item.type}
            </span>
            {item.number && (
              <span className="text-[11px] font-mono text-stone-500 dark:text-stone-400">
                · {item.number}
              </span>
            )}
            {item.pinned && (
              <Pin className="w-3 h-3 text-gold-500 dark:text-gold-400" />
            )}
            {item.ai_confidence && <ConfidenceChip confidence={item.ai_confidence} />}
            {item.status === 'archived' && (
              <span className="px-1.5 py-0.5 text-[10px] font-semibold rounded bg-stone-200 text-stone-600 dark:bg-stone-700 dark:text-stone-300 uppercase">
                archived
              </span>
            )}
          </div>
          <h4 className="font-serif font-bold text-sm text-stone-900 dark:text-stone-100 leading-snug group-hover:text-gold-700 dark:group-hover:text-gold-400 transition-colors">
            {item.title}
          </h4>
          {item.summary && (
            <p className="mt-1 text-xs text-stone-500 dark:text-stone-400 leading-relaxed line-clamp-2">
              {item.summary}
            </p>
          )}
          {item.practice_areas.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {item.practice_areas.map((a) => (
                <span
                  key={a}
                  className="px-1.5 py-0 text-[10px] rounded-full bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-400"
                >
                  {a}
                </span>
              ))}
            </div>
          )}
        </div>
        <a
          href={item.source_url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="shrink-0 p-1.5 rounded-md text-stone-400 hover:text-gold-600 dark:hover:text-gold-400 opacity-0 group-hover:opacity-100 transition-opacity"
          title="Open source"
        >
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </div>
    </div>
  );
}
