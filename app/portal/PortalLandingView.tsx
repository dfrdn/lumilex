'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowUpRight,
  Briefcase,
  Check,
  ChevronDown,
  ClipboardCheck,
  FileCheck2,
  Gavel,
  Handshake,
  Landmark,
  Link2,
  Scale,
  Search,
  SearchX,
} from 'lucide-react';
import type { PortalMatterListRow } from '@/lib/portal/data';
import { classifyCourtLevel, COURT_LEVELS } from '@/lib/portal/court-level';
import {
  computeMatterStats,
  computePortalGroups,
  groupMembershipIndex,
  portalStatusLabel,
  OUTCOME_LABELS,
  type OutcomeKey,
  type PortalMatterGroup,
  type WorkDelivered,
} from '@/lib/portal/matter-insights';
import { MATTER_STATUS } from '@/lib/matter-status';

interface Props {
  rows: PortalMatterListRow[];
  workDelivered: WorkDelivered;
  greeting: string;
  firstName: string;
  /** Link prefix for matter detail pages — `/portal` live, the preview root in preview. */
  basePath: string;
}

type StatusFilter = 'all' | 'active' | 'concluded' | 'archived';
type GroupBy = 'none' | 'type' | 'court' | 'related';
type SortKey = 'recent' | 'newest' | 'oldest' | 'alpha';

const STATUS_FOR_FILTER: Record<Exclude<StatusFilter, 'all'>, string> = {
  active: 'Ongoing',
  concluded: 'Done',
  archived: 'Archived',
};

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'recent', label: 'Recent activity' },
  { key: 'newest', label: 'Newest first' },
  { key: 'oldest', label: 'Oldest first' },
  { key: 'alpha', label: 'A to Z' },
];

const OUTCOME_STYLES: Record<OutcomeKey, { badge: string; bar: string; dot: string }> = {
  Win: {
    badge: 'text-emerald-700 bg-emerald-50 dark:text-emerald-400 dark:bg-emerald-400/10',
    bar: 'bg-emerald-500 dark:bg-emerald-400',
    dot: 'bg-emerald-500 dark:bg-emerald-400',
  },
  Settled: {
    badge: 'text-teal-700 bg-teal-50 dark:text-teal-400 dark:bg-teal-400/10',
    bar: 'bg-teal-500 dark:bg-teal-400',
    dot: 'bg-teal-500 dark:bg-teal-400',
  },
  Terminated: {
    badge: 'text-[var(--text-secondary)] bg-subtle',
    bar: 'bg-stone-400 dark:bg-stone-500',
    dot: 'bg-stone-400 dark:bg-stone-500',
  },
  Loss: {
    badge: 'text-rose-700 bg-rose-50 dark:text-rose-400 dark:bg-rose-400/10',
    bar: 'bg-rose-400 dark:bg-rose-500',
    dot: 'bg-rose-400 dark:bg-rose-500',
  },
};

const OUTCOME_ORDER: OutcomeKey[] = ['Win', 'Settled', 'Terminated', 'Loss'];

function displayTitle(m: PortalMatterListRow): string {
  return m.case_title || m.name;
}

function formatActivityDate(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString('en-PH', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Manila',
  });
}

function matchesSearch(m: PortalMatterListRow, needle: string): boolean {
  if (!needle) return true;
  const haystack = [m.name, m.case_title, m.case_number, m.court, m.matter_code, m.type]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(needle);
}

export default function PortalLandingView({
  rows,
  workDelivered,
  greeting,
  firstName,
  basePath,
}: Props) {
  const [search, setSearch] = useState('');
  // Land on the work in motion; clients with nothing active see everything.
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(() =>
    rows.some((m) => m.status === 'Ongoing') ? 'active' : 'all',
  );
  const [groupBy, setGroupBy] = useState<GroupBy>('none');
  const [sortKey, setSortKey] = useState<SortKey>('recent');

  const stats = useMemo(() => computeMatterStats(rows), [rows]);
  // Membership is computed over everything the client can see, so a filtered
  // view still badges a matter as part of its full group.
  const groups = useMemo(() => computePortalGroups(rows), [rows]);
  const groupIndex = useMemo(() => groupMembershipIndex(groups), [groups]);

  const statusCounts = useMemo(() => {
    const counts: Record<StatusFilter, number> = {
      all: rows.length,
      active: 0,
      concluded: 0,
      archived: 0,
    };
    for (const m of rows) {
      if (m.status === 'Ongoing') counts.active++;
      else if (m.status === 'Done') counts.concluded++;
      else if (m.status === MATTER_STATUS.ARCHIVED) counts.archived++;
    }
    return counts;
  }, [rows]);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const filtered = rows.filter(
      (m) =>
        matchesSearch(m, needle) &&
        (statusFilter === 'all' || m.status === STATUS_FOR_FILTER[statusFilter]),
    );
    const sorted = [...filtered];
    switch (sortKey) {
      case 'recent':
        sorted.sort((a, b) => (b.last_activity_at ?? '').localeCompare(a.last_activity_at ?? ''));
        break;
      case 'newest':
        sorted.sort((a, b) => (b.created_time ?? '').localeCompare(a.created_time ?? ''));
        break;
      case 'oldest':
        sorted.sort((a, b) => (a.created_time ?? '').localeCompare(b.created_time ?? ''));
        break;
      case 'alpha':
        sorted.sort((a, b) => displayTitle(a).localeCompare(displayTitle(b)));
        break;
    }
    return sorted;
  }, [rows, search, statusFilter, sortKey]);

  const sections = useMemo(
    () => buildSections(visible, groupBy, groups),
    [visible, groupBy, groups],
  );

  const hasFilters = search.trim() !== '' || statusFilter !== 'all';
  const sinceYear = useMemo(() => {
    const years = rows.map((m) => m.created_time?.slice(0, 4)).filter(Boolean) as string[];
    return years.length > 0 ? years.sort()[0] : null;
  }, [rows]);
  const countLabel =
    rows.length === 0
      ? 'No active matters at this time.'
      : rows.length === 1
        ? 'One matter entrusted to us.'
        : `${rows.length} matters entrusted to us${sinceYear ? ` since ${sinceYear}` : ''}${stats.active > 0 ? ` — ${stats.active} active today` : ''}.`;

  return (
    <main className="max-w-5xl mx-auto px-6 py-12">
      <section className="mb-8 pb-8 border-b border-gold-200/40 dark:border-gold-400/15">
        <p className="text-[10px] font-medium uppercase tracking-[0.22em] text-gold-700 dark:text-gold-400">
          {greeting}
          {firstName ? `, ${firstName}` : ''}
        </p>
        <h1 className="font-serif text-3xl md:text-4xl text-foreground tracking-tight mt-3">
          Your matters with us
        </h1>
        <p className="text-sm text-[var(--text-secondary)] mt-2">{countLabel}</p>
      </section>

      {rows.length === 0 ? (
        <div className="border border-[var(--border-color)] rounded-2xl bg-card p-10 text-center">
          <Briefcase className="w-8 h-8 mx-auto text-[var(--text-muted)] mb-3" />
          <p className="text-sm text-[var(--text-secondary)]">
            No matters yet. Your lawyer will reach out when work begins.
          </p>
        </div>
      ) : (
        <>
          <StatsBand stats={stats} groupCount={groups.length} workDelivered={workDelivered} />

          <section className="mt-8 space-y-3">
            <div className="flex flex-col sm:flex-row gap-3">
              <label className="relative flex-1">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by title, case number, court…"
                  className="w-full pl-9 pr-3 py-2 text-sm rounded-xl border border-[var(--border-color)] bg-card text-foreground placeholder:text-[var(--text-muted)] focus:outline-none focus:border-gold-500/60 dark:focus:border-gold-400/50 transition-colors"
                />
              </label>
              <SortMenu value={sortKey} onChange={setSortKey} />
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <div className="flex flex-wrap gap-1.5">
                {(
                  [
                    ['all', 'All'],
                    ['active', 'Active'],
                    ['concluded', 'Concluded'],
                    ['archived', 'Archived'],
                  ] as [StatusFilter, string][]
                ).map(([key, label]) => (
                  <Pill
                    key={key}
                    active={statusFilter === key}
                    onClick={() => setStatusFilter(key)}
                  >
                    {label}
                    <span className="ml-1 opacity-60">{statusCounts[key]}</span>
                  </Pill>
                ))}
              </div>
              <span className="hidden sm:block w-px h-4 bg-[var(--border-color)]" aria-hidden />
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--text-muted)] mr-0.5">
                  View
                </span>
                {(
                  [
                    ['none', 'List'],
                    ['type', 'By case type'],
                    ['court', 'By court level'],
                    ['related', 'By related cases'],
                  ] as [GroupBy, string][]
                ).map(([key, label]) => (
                  <Pill key={key} active={groupBy === key} onClick={() => setGroupBy(key)}>
                    {label}
                  </Pill>
                ))}
              </div>
            </div>
          </section>

          <section className="mt-6 space-y-8">
            {visible.length === 0 ? (
              <div className="border border-[var(--border-color)] rounded-2xl bg-card p-10 text-center">
                <SearchX className="w-8 h-8 mx-auto text-[var(--text-muted)] mb-3" />
                <p className="text-sm text-[var(--text-secondary)]">
                  No matters match your search or filters.
                </p>
                {hasFilters && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearch('');
                      setStatusFilter('all');
                    }}
                    className="mt-3 text-xs font-medium text-gold-700 dark:text-gold-400 hover:underline"
                  >
                    Clear filters
                  </button>
                )}
              </div>
            ) : (
              sections.map((section) => (
                <div key={section.key}>
                  {section.title !== null && (
                    <div className="flex items-baseline gap-2 mb-3">
                      <h2 className="font-serif text-lg text-foreground tracking-tight">
                        {section.title}
                      </h2>
                      <span className="text-xs text-[var(--text-muted)]">
                        {section.items.length === 1
                          ? '1 matter'
                          : `${section.items.length} matters`}
                      </span>
                    </div>
                  )}
                  {section.subtitle && (
                    <p className="text-xs text-[var(--text-secondary)] -mt-2 mb-3">
                      {section.subtitle}
                    </p>
                  )}
                  <ul className="space-y-2">
                    {section.items.map((m) => (
                      <MatterCard
                        key={m.notion_id}
                        matter={m}
                        basePath={basePath}
                        group={groupBy !== 'related' ? groupIndex.get(m.notion_id) : undefined}
                      />
                    ))}
                  </ul>
                </div>
              ))
            )}
          </section>
        </>
      )}
    </main>
  );
}

// ── Stats band ────────────────────────────────────────────────────────

function StatsBand({
  stats,
  groupCount,
  workDelivered,
}: {
  stats: ReturnType<typeof computeMatterStats>;
  groupCount: number;
  workDelivered: WorkDelivered;
}) {
  const decided = stats.decided;
  const work = [
    { icon: <FileCheck2 className="w-4 h-4" />, value: workDelivered.filings, label: 'filings & submissions' },
    { icon: <Gavel className="w-4 h-4" />, value: workDelivered.hearingsAttended, label: 'hearings attended' },
    { icon: <Handshake className="w-4 h-4" />, value: workDelivered.meetingsHeld, label: 'meetings held' },
    { icon: <ClipboardCheck className="w-4 h-4" />, value: workDelivered.statusReports, label: 'status reports sent' },
  ].filter((w) => w.value > 0);
  return (
    <section aria-label="Engagement summary">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatTile
          icon={<Briefcase className="w-4 h-4" />}
          value={String(stats.active)}
          label="Active matters"
          caption="being worked on now"
        />
        <StatTile
          icon={<Check className="w-4 h-4" />}
          value={String(stats.concluded)}
          label="Concluded"
          caption="brought to completion"
        />
        <StatTile
          icon={<Scale className="w-4 h-4" />}
          value={decided > 0 ? String(stats.favorable) : '—'}
          label="Favorable results"
          caption={
            decided > 0 ? `won or settled, of ${decided} decided` : 'no recorded outcomes yet'
          }
        />
        <StatTile
          icon={<Landmark className="w-4 h-4" />}
          value={String(stats.courtCases)}
          label="Court cases"
          caption={groupCount > 0 ? `${groupCount} related case ${groupCount === 1 ? 'group' : 'groups'}` : 'across all forums'}
        />
      </div>

      {work.length > 0 && (
        <div className="mt-3 border border-[var(--border-color)] rounded-xl bg-card px-4 py-3">
          <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
            Work delivered across your engagement
          </span>
          <div className="flex flex-wrap gap-x-6 gap-y-2 mt-2">
            {work.map((w) => (
              <span key={w.label} className="inline-flex items-center gap-2 text-sm text-[var(--text-secondary)]">
                <span className="text-gold-700 dark:text-gold-400">{w.icon}</span>
                <span className="font-serif text-lg text-foreground leading-none">{w.value}</span>
                {w.label}
              </span>
            ))}
          </div>
        </div>
      )}

      {decided > 0 && (
        <div className="mt-3 border border-[var(--border-color)] rounded-xl bg-card px-4 py-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
              Case outcomes
            </span>
            <span className="text-[10px] text-[var(--text-muted)]">
              {decided} concluded with recorded outcome
            </span>
          </div>
          <div className="flex h-2 rounded-full overflow-hidden bg-subtle">
            {OUTCOME_ORDER.filter((k) => stats.outcomes[k] > 0).map((k) => (
              <div
                key={k}
                className={OUTCOME_STYLES[k].bar}
                style={{ width: `${(stats.outcomes[k] / decided) * 100}%` }}
                title={`${OUTCOME_LABELS[k]}: ${stats.outcomes[k]}`}
              />
            ))}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
            {OUTCOME_ORDER.filter((k) => stats.outcomes[k] > 0).map((k) => (
              <span key={k} className="inline-flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
                <span className={`w-2 h-2 rounded-full ${OUTCOME_STYLES[k].dot}`} />
                {OUTCOME_LABELS[k]} · {stats.outcomes[k]}
              </span>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function StatTile({
  icon,
  value,
  label,
  caption,
}: {
  icon: React.ReactNode;
  value: string;
  label: string;
  caption: string;
}) {
  return (
    <div className="border border-[var(--border-color)] rounded-xl bg-card p-4">
      <div className="flex items-center gap-2 text-gold-700 dark:text-gold-400">
        {icon}
        <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
          {label}
        </span>
      </div>
      <div className="font-serif text-2xl text-foreground mt-2 leading-none">{value}</div>
      <div className="text-[11px] text-[var(--text-secondary)] mt-1.5">{caption}</div>
    </div>
  );
}

// ── Controls ──────────────────────────────────────────────────────────

function Pill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
        active
          ? 'bg-navy-800 text-white border-navy-800 dark:bg-gold-400 dark:text-navy-950 dark:border-gold-400'
          : 'bg-card text-[var(--text-secondary)] border-[var(--border-color)] hover:border-[var(--border-hover)] hover:text-foreground'
      }`}
    >
      {children}
    </button>
  );
}

function SortMenu({ value, onChange }: { value: SortKey; onChange: (k: SortKey) => void }) {
  const [open, setOpen] = useState(false);
  const current = SORT_OPTIONS.find((o) => o.key === value)!;
  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="inline-flex items-center gap-2 px-3 py-2 text-sm rounded-xl border border-[var(--border-color)] bg-card text-[var(--text-secondary)] hover:border-[var(--border-hover)] hover:text-foreground transition-colors"
      >
        <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
          Sort
        </span>
        {current.label}
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <>
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => setOpen(false)}
          />
          <ul
            role="listbox"
            className="absolute right-0 z-20 mt-1 w-44 rounded-xl border border-[var(--border-color)] bg-card shadow-[var(--shadow-elevated)] py-1"
          >
            {SORT_OPTIONS.map((o) => (
              <li key={o.key}>
                <button
                  type="button"
                  role="option"
                  aria-selected={o.key === value}
                  onClick={() => {
                    onChange(o.key);
                    setOpen(false);
                  }}
                  className={`w-full text-left px-3 py-1.5 text-sm transition-colors hover:bg-subtle ${
                    o.key === value
                      ? 'text-gold-700 dark:text-gold-400 font-medium'
                      : 'text-[var(--text-secondary)]'
                  }`}
                >
                  {o.label}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

// ── Sections (grouping) ───────────────────────────────────────────────

interface Section {
  key: string;
  /** null = untitled flat list. */
  title: string | null;
  subtitle?: string;
  items: PortalMatterListRow[];
}

function buildSections(
  visible: PortalMatterListRow[],
  groupBy: GroupBy,
  groups: PortalMatterGroup[],
): Section[] {
  if (groupBy === 'none') {
    return [{ key: 'all', title: null, items: visible }];
  }

  if (groupBy === 'type') {
    const byType = new Map<string, PortalMatterListRow[]>();
    for (const m of visible) {
      const key = m.type || 'Other';
      const list = byType.get(key) ?? [];
      list.push(m);
      byType.set(key, list);
    }
    return [...byType.entries()]
      .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
      .map(([type, items]) => ({ key: `type:${type}`, title: type, items }));
  }

  if (groupBy === 'court') {
    const byLevel = new Map<string, PortalMatterListRow[]>();
    for (const m of visible) {
      const level = classifyCourtLevel(m.court);
      const list = byLevel.get(level.key) ?? [];
      list.push(m);
      byLevel.set(level.key, list);
    }
    return Object.values(COURT_LEVELS)
      .sort((a, b) => a.rank - b.rank)
      .filter((level) => byLevel.has(level.key))
      .map((level) => ({
        key: `court:${level.key}`,
        title: level.label,
        items: byLevel.get(level.key)!,
      }));
  }

  // related: one section per group that has visible members, then the rest.
  const visibleIds = new Set(visible.map((m) => m.notion_id));
  const byId = new Map(visible.map((m) => [m.notion_id, m]));
  const sections: Section[] = [];
  const grouped = new Set<string>();
  for (const g of groups) {
    const items = g.memberIds.filter((id) => visibleIds.has(id)).map((id) => byId.get(id)!);
    if (items.length === 0) continue;
    for (const m of items) grouped.add(m.notion_id);
    sections.push({
      key: `group:${g.id}`,
      title: g.name,
      subtitle: `${g.memberIds.length} interrelated ${g.memberIds.length === 1 ? 'case' : 'cases'} handled together`,
      items,
    });
  }
  const standalone = visible.filter((m) => !grouped.has(m.notion_id));
  if (standalone.length > 0) {
    sections.push({ key: 'standalone', title: 'Standalone matters', items: standalone });
  }
  return sections;
}

// ── Matter card ───────────────────────────────────────────────────────

function MatterCard({
  matter: m,
  basePath,
  group,
}: {
  matter: PortalMatterListRow;
  basePath: string;
  group?: PortalMatterGroup;
}) {
  const outcome = (m.outcome ?? '').trim() as OutcomeKey | '';
  const outcomeStyle = outcome && outcome in OUTCOME_STYLES ? OUTCOME_STYLES[outcome] : null;
  const activity = formatActivityDate(m.last_activity_at);
  return (
    <li>
      <Link
        href={`${basePath}/matters/${encodeURIComponent(m.notion_id)}`}
        className="block border border-[var(--border-color)] rounded-xl bg-card hover:bg-subtle hover:border-[var(--border-hover)] transition-all p-5"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              {m.matter_code && (
                <span className="text-[10px] font-mono font-semibold uppercase tracking-wider text-[var(--text-muted)] bg-subtle px-2 py-0.5 rounded">
                  {m.matter_code}
                </span>
              )}
              {m.status && (
                <span className="text-[10px] font-medium uppercase tracking-wider text-navy-700 dark:text-gold-400 bg-navy-50 dark:bg-gold-400/10 px-2 py-0.5 rounded">
                  {portalStatusLabel(m.status)}
                </span>
              )}
              {outcomeStyle && (
                <span
                  className={`text-[10px] font-medium uppercase tracking-wider px-2 py-0.5 rounded ${outcomeStyle.badge}`}
                >
                  {OUTCOME_LABELS[outcome as OutcomeKey]}
                </span>
              )}
              {group && (
                <span className="inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-[var(--text-secondary)] bg-subtle px-2 py-0.5 rounded">
                  <Link2 className="w-3 h-3" />
                  {group.memberIds.length} related
                </span>
              )}
            </div>
            <h2 className="font-serif text-lg text-foreground mt-2 truncate tracking-tight">
              {displayTitle(m)}
            </h2>
            <div className="text-xs text-[var(--text-secondary)] mt-1 space-x-3">
              {m.case_number && <span>{m.case_number}</span>}
              {m.court && <span>· {m.court}</span>}
              {m.type && <span>· {m.type}</span>}
            </div>
          </div>
          <div className="flex flex-col items-end gap-2 shrink-0 mt-1">
            <ArrowUpRight className="w-4 h-4 text-[var(--text-muted)]" />
            {activity && (
              <span className="hidden sm:block text-[10px] text-[var(--text-muted)] whitespace-nowrap">
                Updated {activity}
              </span>
            )}
          </div>
        </div>
      </Link>
    </li>
  );
}
