'use client';

import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import useSWR, { useSWRConfig } from 'swr';
import { toast } from 'sonner';
import {
  Scale, Search, Loader2, LayoutGrid, FolderKanban, Archive, Trophy, CheckCircle2,
  Users2, Check, X, Plus, Link2, AlertCircle, Calendar, FileText, Sparkles,
  ChevronDown, ChevronRight,
} from 'lucide-react';
import dynamic from 'next/dynamic';
import type {
  PartnerMatterManagementRow,
  PartnerMatterLite,
} from '@/lib/queries/partner-matters';
import { computeUtilization, type UtilizationBucket } from '@/lib/partner-lawyers/utilization';
import { IDLE_ARCHIVE_DAYS, IDLE_WARN_DAYS } from '@/lib/matters/archive';
import FilePreviewModal from '@/components/FilePreviewModal';
import Avatar from '@/components/Avatar';
import { MATTER_STATUSES, MATTER_STATUS } from '@/lib/matter-status';
import { DELIVERABLE_STATUS } from '@/lib/deliverable-status';
import { byLetterhead } from '@/lib/docx/letterhead';

// recharts loads only once the type breakdown is on screen.
const TypePie = dynamic(() => import('./TypePie'), {
  ssr: false,
  loading: () => <div className="h-full w-full rounded-full skeleton-shimmer" />,
});

// ── Types ─────────────────────────────────────────────────────────

interface Person {
  person_id: string;
  name: string;
  initials: string;
  position: string;
  active: boolean;
  role: string;
  avatar_url?: string | null;
  /** Joined the firm; breaks ties in the letterhead order. */
  start_date?: string | null;
}

interface LawyerCapacity {
  personId: string;
  position: string;
  totalMatters: number;
  pendingDeliverables: number;
  submittedThisMonth: number;
  hoursThisMonth: number;
}

interface CapacityInfo {
  score: number;
  bucket: UtilizationBucket;
  remaining: number;
}

// ── Constants ─────────────────────────────────────────────────────

const TYPE_COLORS: Record<string, string> = {
  Litigation: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  Retainer: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  Labor: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400',
  'Special Project': 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  'Intellectual Property': 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400',
  Tax: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  Immigration: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400',
  Incorporation: 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400',
  'Post-Incorporation': 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400',
  'Corporate Housekeeping': 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400',
};

const STATUS_OPTIONS = [...MATTER_STATUSES];

const OUTCOME_OPTIONS = [
  'Win',
  'Loss',
  'Settled',
  'Terminated',
  'Withdrawn',
  'Dismissed',
  '',
];

const OUTCOME_STYLES: Record<string, string> = {
  Win: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  Loss: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400',
  Settled: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  Terminated: 'bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-400',
  Withdrawn: 'bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-400',
  Dismissed: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
};

const STATUS_STYLES: Record<string, string> = {
  Ongoing: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  Done: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  Archived: 'bg-stone-100 text-stone-500 dark:bg-stone-800 dark:text-stone-400',
};

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  return Math.floor((Date.now() - then) / 86_400_000);
}

function formatIdle(days: number): string {
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());

// Anchored popover position — keeps dropdowns escape the table's overflow-clip
// by rendering in a portal with `position: fixed`.
function useAnchoredPosition(
  anchorRef: React.RefObject<HTMLElement | null>,
  open: boolean,
  align: 'left' | 'right',
  width: number,
) {
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: -9999, left: -9999 });
  useEffect(() => {
    if (!open) return;
    function update() {
      const el = anchorRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const left = align === 'right' ? Math.max(8, r.right - width) : Math.max(8, r.left);
      setPos({ top: r.bottom + 4, left });
    }
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [open, align, width, anchorRef]);
  return pos;
}

type TabKey = 'overview' | 'active' | 'done' | 'archived' | 'outcomes';

const TABS: { key: TabKey; label: string; icon: typeof LayoutGrid }[] = [
  { key: 'overview', label: 'Overview', icon: LayoutGrid },
  { key: 'active', label: 'Ongoing', icon: FolderKanban },
  { key: 'done', label: 'Done', icon: CheckCircle2 },
  { key: 'archived', label: 'Archived', icon: Archive },
  { key: 'outcomes', label: 'Outcomes', icon: Trophy },
];

// ── Main Component ────────────────────────────────────────────────

export default function MattersManagementPage() {
  const [tab, setTab] = useState<TabKey>('overview');
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const { data, mutate, isLoading } = useSWR<{
    matters: PartnerMatterManagementRow[];
    allMattersLite: PartnerMatterLite[];
  }>('/api/partner/matters', fetcher, { keepPreviousData: true });
  const { data: peopleData } = useSWR<{ people: Person[] }>('/api/people?role=lawyers', fetcher);
  const { data: lawyersData } = useSWR<{ workload: LawyerCapacity[] }>('/api/partner/lawyers', fetcher);

  const matters = data?.matters ?? [];
  const allLite = data?.allMattersLite ?? [];
  // The team picker lists lawyers as the letterhead does: by group, then seniority.
  const people = useMemo(
    () => [...(peopleData?.people ?? [])].sort((a, b) =>
      byLetterhead({ ...a, start_date: a.start_date ?? null }, { ...b, start_date: b.start_date ?? null })),
    [peopleData],
  );
  const capacityByPersonId = useMemo(() => {
    const m = new Map<string, CapacityInfo>();
    for (const w of lawyersData?.workload ?? []) {
      const u = computeUtilization(w.position, {
        hoursThisMonth: w.hoursThisMonth,
        pendingDeliverables: w.pendingDeliverables,
        submittedThisMonth: w.submittedThisMonth,
        totalMatters: w.totalMatters,
      });
      m.set(w.personId, { score: u.score, bucket: u.bucket, remaining: Math.max(0, 1 - u.score) });
    }
    return m;
  }, [lawyersData]);

  const ongoingCount = useMemo(() => matters.filter((m) => m.status === 'Ongoing').length, [matters]);

  if (!mounted || isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-5 h-5 text-gold-500 animate-spin dark:text-gold-400" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gold-50 dark:bg-gold-900/20 flex items-center justify-center">
            <Scale className="w-5 h-5 text-gold-600 dark:text-gold-400" />
          </div>
          <div>
            <h1 className="font-serif text-2xl font-bold tracking-tight text-stone-900 dark:text-stone-100">
              Matter Management
            </h1>
            <p className="text-xs text-stone-400 dark:text-stone-500 mt-0.5">
              {matters.length} total &middot; {ongoingCount} ongoing
            </p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 bg-stone-100 dark:bg-stone-800/50 rounded-lg p-1 w-fit">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md transition-all cursor-pointer ${
                active
                  ? 'bg-white dark:bg-stone-700 text-stone-900 dark:text-stone-100 shadow-sm'
                  : 'text-stone-500 dark:text-stone-400 hover:text-stone-700 dark:hover:text-stone-300'
              }`}
            >
              <Icon className="w-4 h-4" />
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === 'overview' && <OverviewTab matters={matters} />}
      {tab === 'active' && (
        <MattersTable
          matters={matters.filter((m) => m.status === 'Ongoing' || !m.status)}
          allLite={allLite}
          people={people}
          capacity={capacityByPersonId}
          onUpdate={mutate}
          emptyLabel="No ongoing matters."
          hideColumns={['outcome']}
        />
      )}
      {tab === 'done' && (
        <MattersTable
          matters={matters.filter((m) => m.status === 'Done')}
          allLite={allLite}
          people={people}
          capacity={capacityByPersonId}
          onUpdate={mutate}
          emptyLabel="No matters marked Done."
          hideColumns={['status']}
        />
      )}
      {tab === 'archived' && (
        <MattersTable
          matters={matters.filter((m) => m.status === MATTER_STATUS.ARCHIVED)}
          allLite={allLite}
          people={people}
          capacity={capacityByPersonId}
          onUpdate={mutate}
          emptyLabel="No archived matters."
          hideColumns={['status']}
          notice={<ArchivedNotice />}
        />
      )}
      {tab === 'outcomes' && <OutcomesTab matters={matters} onUpdate={mutate} />}
    </div>
  );
}

type MattersData = { matters: PartnerMatterManagementRow[]; allMattersLite: PartnerMatterLite[] };
type MatterPatch = { team_person_ids?: string[]; status?: string; outcome?: string; related_matter_ids?: string[] };

/**
 * PATCH a matter. Resolves once the change shows in every tab, without waiting
 * for the server; a refusal rolls it back with a toast.
 */
function usePatchMatter(people: Person[] = []) {
  const { mutate } = useSWRConfig();
  return useCallback(
    async (id: string, body: MatterPatch): Promise<void> => {
      const apply = (m: PartnerMatterManagementRow): PartnerMatterManagementRow => {
        const next = { ...m };
        if (body.status !== undefined) next.status = body.status;
        if (body.outcome !== undefined) next.outcome = body.outcome;
        if (body.related_matter_ids) next.relatedMatterIds = body.related_matter_ids;
        if (body.team_person_ids) {
          const known = new Map(m.teamInitials.map((t) => [t.personId, t]));
          const byId = new Map(people.map((p) => [p.person_id, p]));
          next.teamPersonIds = body.team_person_ids;
          next.teamInitials = body.team_person_ids.flatMap((pid) => {
            const existing = known.get(pid);
            if (existing) return [existing];
            const person = byId.get(pid);
            return person ? [{ personId: pid, initials: person.initials, name: person.name, avatarUrl: person.avatar_url ?? null }] : [];
          });
        }
        return next;
      };
    mutate<MattersData>(
        '/api/partner/matters',
        async (current) => {
          const res = await fetch(`/api/partner/matters/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
          if (!res.ok) throw new Error('Failed');
          return current;
        },
        {
          optimisticData: (current) =>
            current ? { ...current, matters: current.matters.map((m) => (m.id === id ? apply(m) : m)) } : current!,
          rollbackOnError: true,
          populateCache: false,
          revalidate: true,
        },
      ).catch(() => toast.error('Could not update the matter'));
    },
    [mutate, people],
  );
}

// ── Overview Tab ──────────────────────────────────────────────────

function OverviewTab({ matters }: { matters: PartnerMatterManagementRow[] }) {
  const stats = useMemo(() => {
    const ongoing = matters.filter((m) => m.status === 'Ongoing');
    const done = matters.filter((m) => m.status === 'Done');
    const archived = matters.filter((m) => m.status === MATTER_STATUS.ARCHIVED);

    // Win rate: Settled counts as a win alongside Win.
    // Denominator is the decided set (wins + settled + losses).
    const outrightWins = done.filter((m) => /^win$/i.test(m.outcome));
    const settled = done.filter((m) => /^settled$/i.test(m.outcome));
    const losses = done.filter((m) => /^loss$/i.test(m.outcome));
    const winLike = outrightWins.length + settled.length;
    const decided = winLike + losses.length;
    const winRate = decided ? (winLike / decided) * 100 : null;

    const overdue = matters.reduce((a, m) => a + m.overdueDeliverables, 0);
    const unassigned = ongoing.filter((m) => m.teamPersonIds.length === 0).length;

    const byType = new Map<string, number>();
    for (const m of ongoing) {
      const t = m.type || 'Other';
      byType.set(t, (byType.get(t) ?? 0) + 1);
    }
    const typeEntries = [...byType.entries()].sort((a, b) => b[1] - a[1]);

    return {
      totals: { ongoing: ongoing.length, done: done.length, archived: archived.length },
      wins: outrightWins.length,
      losses: losses.length,
      settled: settled.length,
      winRate,
      overdue,
      unassigned,
      typeEntries,
    };
  }, [matters]);

  return (
    <div className="space-y-6">
      {/* KPI cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <Kpi label="Ongoing" value={stats.totals.ongoing} tone="emerald" />
        <Kpi label="Done" value={stats.totals.done} tone="stone" sub={`${stats.settled} settled`} />
        <Kpi label="Archived" value={stats.totals.archived} tone="stone" />
        <Kpi
          label="Win Rate"
          value={stats.winRate !== null ? `${stats.winRate.toFixed(0)}%` : '—'}
          sub={`${stats.wins}W + ${stats.settled}S / ${stats.losses}L`}
          tone="gold"
        />
        <Kpi label="Overdue Deliverables" value={stats.overdue} tone={stats.overdue > 0 ? 'red' : 'stone'} />
        <Kpi label="No Team Assigned" value={stats.unassigned} tone={stats.unassigned > 0 ? 'amber' : 'stone'} />
      </div>

      {/* By Type pie chart */}
      <div className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-stone-700 dark:text-stone-300">Ongoing Matters by Type</h2>
          <span className="text-[11px] text-stone-400 dark:text-stone-500">{stats.totals.ongoing} total</span>
        </div>
        {stats.typeEntries.length === 0 ? (
          <div className="text-sm text-stone-400 py-6 text-center dark:text-stone-500">No ongoing matters</div>
        ) : (
          <TypePieChart entries={stats.typeEntries} total={stats.totals.ongoing} />
        )}
      </div>
    </div>
  );
}

function Kpi({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: number | string;
  sub?: string;
  tone: 'emerald' | 'stone' | 'gold' | 'red' | 'amber';
}) {
  const toneClass = {
    emerald: 'text-emerald-500 dark:text-emerald-400',
    stone: 'text-stone-400 dark:text-stone-500',
    gold: 'text-gold-500 dark:text-gold-400',
    red: 'text-red-500 dark:text-red-400',
    amber: 'text-amber-500',
  }[tone];
  return (
    <div className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-xl p-3">
      <div className={`text-[10px] uppercase tracking-wider font-semibold ${toneClass}`}>{label}</div>
      <div className="mt-1 font-serif text-2xl font-bold tabular-nums text-stone-800 dark:text-stone-100">{value}</div>
      {sub && <div className="text-[10px] text-stone-400 mt-0.5 dark:text-stone-500">{sub}</div>}
    </div>
  );
}

// ── Ongoing Matters by Type (pie) ────────────────────────────────

const PIE_COLORS: Record<string, string> = {
  Litigation: '#f97316',            // orange-500
  Retainer: '#3b82f6',              // blue-500
  Labor: '#f43f5e',                 // rose-500
  'Special Project': '#10b981',     // emerald-500
  'Intellectual Property': '#8b5cf6', // violet-500
  Tax: '#f59e0b',                   // amber-500
  Immigration: '#06b6d4',           // cyan-500
  Incorporation: '#14b8a6',         // teal-500
  'Post-Incorporation': '#0ea5e9',  // sky-500
  'Corporate Housekeeping': '#6366f1', // indigo-500
};

const PIE_FALLBACK = ['#a8a29e', '#78716c', '#57534e', '#d6d3d1'];

function TypePieChart({ entries, total }: { entries: [string, number][]; total: number }) {
  const data = entries.map(([name, value], i) => ({
    name,
    value,
    color: PIE_COLORS[name] ?? PIE_FALLBACK[i % PIE_FALLBACK.length],
  }));

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
      <div className="h-64 relative">
        <TypePie data={data} total={total} />
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="font-serif text-3xl font-bold text-stone-800 dark:text-stone-100 tabular-nums">
            {total}
          </span>
          <span className="text-[11px] text-stone-400 uppercase tracking-wider dark:text-stone-500">Ongoing</span>
        </div>
      </div>
      <div className="space-y-1.5">
        {data.map((d) => {
          const pct = total ? ((d.value / total) * 100).toFixed(0) : '0';
          return (
            <div key={d.name} className="flex items-center gap-2 text-sm">
              <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: d.color }} />
              <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold ${TYPE_COLORS[d.name] ?? 'bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-400'}`}>
                {d.name}
              </span>
              <span className="ml-auto text-xs font-semibold text-stone-700 dark:text-stone-200 tabular-nums">{d.value}</span>
              <span className="text-[10px] text-stone-400 w-9 text-right tabular-nums dark:text-stone-500">{pct}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Matters Table ─────────────────────────────────────────────────

function MattersTable({
  matters,
  allLite,
  people,
  capacity,
  onUpdate,
  emptyLabel,
  hideColumns,
  notice,
}: {
  matters: PartnerMatterManagementRow[];
  allLite: PartnerMatterLite[];
  people: Person[];
  capacity: Map<string, CapacityInfo>;
  onUpdate: () => void;
  emptyLabel: string;
  hideColumns?: ('status' | 'outcome')[];
  notice?: React.ReactNode;
}) {
  const hidden = new Set(hideColumns ?? []);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [sort, setSort] = useState<{ col: 'name' | 'client' | 'deliverables' | 'hearing' | 'status_report' | 'activity'; dir: 'asc' | 'desc' }>({ col: 'name', dir: 'asc' });

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    let out = matters.filter((m) => {
      if (typeFilter && m.type !== typeFilter) return false;
      if (!q) return true;
      return (
        m.name.toLowerCase().includes(q) ||
        m.matterCode.toLowerCase().includes(q) ||
        m.clientName.toLowerCase().includes(q) ||
        m.type.toLowerCase().includes(q)
      );
    });
    const { col, dir } = sort;
    const mul = dir === 'asc' ? 1 : -1;
    out = [...out].sort((a, b) => {
      if (col === 'name') return mul * a.name.localeCompare(b.name);
      if (col === 'client') return mul * a.clientName.localeCompare(b.clientName);
      if (col === 'deliverables') return mul * (a.pendingDeliverables - b.pendingDeliverables);
      if (col === 'hearing') {
        const ad = a.nextHearing?.date ?? '';
        const bd = b.nextHearing?.date ?? '';
        if (!ad && !bd) return 0;
        if (!ad) return 1;
        if (!bd) return -1;
        return mul * ad.localeCompare(bd);
      }
      if (col === 'status_report') {
        // Sort "no report" last regardless of direction so partners
        // naturally focus on stale reports or missing ones.
        const ad = a.lastStatusReport?.date ?? '';
        const bd = b.lastStatusReport?.date ?? '';
        if (!ad && !bd) return 0;
        if (!ad) return 1;
        if (!bd) return -1;
        return mul * ad.localeCompare(bd);
      }
      if (col === 'activity') {
        // Ascending = oldest activity first (most idle / closest to archive).
        const ad = a.lastActivityAt ?? '';
        const bd = b.lastActivityAt ?? '';
        if (!ad && !bd) return 0;
        if (!ad) return 1;
        if (!bd) return -1;
        return mul * ad.localeCompare(bd);
      }
      return 0;
    });
    return out;
  }, [matters, search, typeFilter, sort]);

  const types = useMemo(() => {
    const s = new Set<string>();
    for (const m of matters) if (m.type) s.add(m.type);
    return [...s].sort();
  }, [matters]);

  return (
    <div className="space-y-3">
      {notice}
      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400 dark:text-stone-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, code, client..."
            className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] text-stone-800 dark:text-stone-200 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-gold-500/30 focus:border-gold-400 dark:placeholder:text-stone-500"
          />
        </div>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="text-sm rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] text-stone-700 dark:text-stone-300 py-2 px-3"
        >
          <option value="">All types</option>
          {types.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <span className="text-[11px] text-stone-400 ml-auto tabular-nums dark:text-stone-500">{filtered.length} matters</span>
      </div>

      {/* Table */}
      <div className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border-color)] bg-stone-50/50 dark:bg-stone-800/20">
                <SortableTh label="Matter" col="name" sort={sort} setSort={setSort} />
                <SortableTh label="Client" col="client" sort={sort} setSort={setSort} />
                <Th>Type</Th>
                <Th>Team</Th>
                {!hidden.has('status') && <Th>Status</Th>}
                {!hidden.has('outcome') && <Th>Outcome</Th>}
                <Th>Related</Th>
                <SortableTh label="Pending" col="deliverables" sort={sort} setSort={setSort} align="right" />
                <SortableTh label="Next Hearing" col="hearing" sort={sort} setSort={setSort} />
                <SortableTh label="Last Status Report" col="status_report" sort={sort} setSort={setSort} />
                <SortableTh label="Last Activity" col="activity" sort={sort} setSort={setSort} />
              </tr>
            </thead>
            <tbody>
              {filtered.map((m) => (
                <MatterRow
                  key={m.id}
                  matter={m}
                  allLite={allLite}
                  people={people}
                  capacity={capacity}
                  onUpdate={onUpdate}
                  hidden={hidden}
                />
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <div className="text-center py-10 text-sm text-stone-400 dark:text-stone-500">{emptyLabel}</div>
          )}
        </div>
      </div>
    </div>
  );
}

function Th({ children, align }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th className={`px-3 py-3 text-[11px] font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500 ${align === 'right' ? 'text-right' : 'text-left'}`}>
      {children}
    </th>
  );
}

function SortableTh<C extends string>({
  label, col, sort, setSort, align,
}: {
  label: string;
  col: C;
  sort: { col: string; dir: 'asc' | 'desc' };
  setSort: (s: { col: C; dir: 'asc' | 'desc' }) => void;
  align?: 'left' | 'right';
}) {
  const active = sort.col === col;
  return (
    <th className={`px-3 py-3 ${align === 'right' ? 'text-right' : 'text-left'}`}>
      <button
        type="button"
        onClick={() => setSort({ col, dir: active && sort.dir === 'asc' ? 'desc' : 'asc' })}
        className={`inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider transition-colors cursor-pointer ${
          active ? 'text-stone-700 dark:text-stone-200' : 'text-stone-400 dark:text-stone-500 hover:text-stone-600 dark:hover:text-stone-300'
        }`}
      >
        {label}
        {active && <span className="text-stone-400 dark:text-stone-500">{sort.dir === 'asc' ? '↑' : '↓'}</span>}
      </button>
    </th>
  );
}

// ── Matter Row with inline edits ─────────────────────────────────

function MatterRow({
  matter,
  allLite,
  people,
  capacity,
  onUpdate,
  hidden,
}: {
  matter: PartnerMatterManagementRow;
  allLite: PartnerMatterLite[];
  people: Person[];
  capacity: Map<string, CapacityInfo>;
  onUpdate: () => void;
  hidden: Set<'status' | 'outcome'>;
}) {
  const patchMatter = usePatchMatter(people);
  const patch = useCallback((body: MatterPatch) => patchMatter(matter.id, body), [patchMatter, matter.id]);

  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const handlePreviewEngagement = useCallback(async () => {
    setPreviewLoading(true);
    try {
      const res = await fetch(`/api/finance/matter-billing/engagement?matterId=${matter.id}`);
      const json = await res.json();
      if (json.url) {
        setPreviewUrl(json.url);
        setPreviewOpen(true);
      }
    } catch { /* ignore */ }
    setPreviewLoading(false);
  }, [matter.id]);

  return (
    <tr className="border-b border-stone-100/50 dark:border-stone-800/50 hover:bg-stone-50/40 dark:hover:bg-stone-800/20 transition-colors">
      <td className="px-3 py-3 min-w-[220px]">
        <div className="flex items-center gap-1.5">
          <a
            href={`/dashboard/matters/${matter.id}`}
            className="font-medium text-stone-800 dark:text-stone-200 hover:text-gold-600 dark:hover:text-gold-400 line-clamp-1"
          >
            {matter.name || '(untitled)'}
          </a>
          {matter.engagementFilePath && (
            <button
              type="button"
              onClick={handlePreviewEngagement}
              disabled={previewLoading}
              className="p-0.5 rounded text-emerald-500 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 transition-colors cursor-pointer shrink-0 disabled:opacity-50 dark:text-emerald-400"
              title={`Preview engagement agreement: ${matter.engagementFileName ?? ''}`}
            >
              {previewLoading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <FileText className="w-3.5 h-3.5" />
              )}
            </button>
          )}
        </div>
        {matter.matterCode && (
          <div className="text-[10px] text-stone-400 mt-0.5 tabular-nums dark:text-stone-500">{matter.matterCode}</div>
        )}
        <FilePreviewModal
          open={previewOpen}
          onClose={() => setPreviewOpen(false)}
          files={
            previewUrl && matter.engagementFileName
              ? [{ name: matter.engagementFileName, url: previewUrl }]
              : []
          }
        />
      </td>
      <td className="px-3 py-3 text-stone-600 dark:text-stone-400 whitespace-nowrap">{matter.clientName}</td>
      <td className="px-3 py-3">
        {matter.type ? (
          <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold ${TYPE_COLORS[matter.type] ?? 'bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-400'}`}>
            {matter.type}
          </span>
        ) : (
          <span className="text-xs text-stone-400 dark:text-stone-500">—</span>
        )}
      </td>
      <td className="px-3 py-3">
        <TeamPicker
          selected={matter.teamPersonIds}
          teamInitials={matter.teamInitials}
          people={people}
          capacity={capacity}
          onSave={(ids) => patch({ team_person_ids: ids })}
        />
      </td>
      {!hidden.has('status') && (
        <td className="px-3 py-3">
          <InlineSelect
            value={matter.status}
            options={STATUS_OPTIONS}
            styleMap={STATUS_STYLES}
            onSave={(v) => patch({ status: v })}
          />
        </td>
      )}
      {!hidden.has('outcome') && (
        <td className="px-3 py-3">
          <InlineSelect
            value={matter.outcome}
            options={OUTCOME_OPTIONS}
            styleMap={OUTCOME_STYLES}
            placeholder="—"
            onSave={(v) => patch({ outcome: v })}
          />
        </td>
      )}
      <td className="px-3 py-3">
        <RelatedPicker
          matterId={matter.id}
          relatedIds={matter.relatedMatterIds}
          allLite={allLite}
          onSave={(ids) => patch({ related_matter_ids: ids })}
        />
      </td>
      <td className="px-3 py-3 text-right">
        {matter.pendingDeliverables > 0 ? (
          <span className={`inline-flex items-center gap-1 font-semibold tabular-nums ${matter.overdueDeliverables > 0 ? 'text-red-500 dark:text-red-400' : 'text-stone-600 dark:text-stone-400'}`}>
            {matter.overdueDeliverables > 0 && <AlertCircle className="w-3 h-3" />}
            {matter.pendingDeliverables}
            {matter.overdueDeliverables > 0 && (
              <span className="text-[10px] font-normal">({matter.overdueDeliverables} overdue)</span>
            )}
          </span>
        ) : (
          <span className="text-stone-300 dark:text-stone-600">—</span>
        )}
      </td>
      <td className="px-3 py-3 whitespace-nowrap">
        {matter.nextHearing ? (
          <div className="flex items-center gap-1.5 text-xs text-stone-600 dark:text-stone-400">
            <Calendar className="w-3 h-3 text-stone-400 dark:text-stone-500" />
            <span className="tabular-nums">{matter.nextHearing.date}</span>
          </div>
        ) : (
          <span className="text-stone-300 text-xs dark:text-stone-600">—</span>
        )}
      </td>
      <td className="px-3 py-3 whitespace-nowrap">
        <StatusReportCell matter={matter} onGenerated={onUpdate} />
      </td>
      <td className="px-3 py-3 whitespace-nowrap">
        <ActivityCell matter={matter} />
      </td>
    </tr>
  );
}

// ── Last Activity / auto-archive indicator ───────────────────────

function ActivityCell({ matter }: { matter: PartnerMatterManagementRow }) {
  const days = daysSince(matter.lastActivityAt);
  if (days === null) {
    return <span className="text-stone-300 text-xs dark:text-stone-600">—</span>;
  }
  const exact = matter.lastActivityAt
    ? new Date(matter.lastActivityAt).toLocaleDateString('en-PH', {
        year: 'numeric', month: 'short', day: 'numeric', timeZone: 'Asia/Manila',
      })
    : '';
  const nearArchive = matter.status === 'Ongoing' && days >= IDLE_WARN_DAYS;
  return (
    <div className="flex flex-col gap-0.5" title={exact}>
      <span
        className={`text-xs tabular-nums ${
          nearArchive
            ? 'text-amber-600 dark:text-amber-400 font-medium'
            : 'text-stone-500 dark:text-stone-400'
        }`}
      >
        {formatIdle(days)}
      </span>
      {nearArchive && (
        <span className="text-[9px] text-amber-500 dark:text-amber-400">
          auto-archives in {Math.max(0, IDLE_ARCHIVE_DAYS - days)}d
        </span>
      )}
    </div>
  );
}

function ArchivedNotice() {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-[var(--border-color)] bg-stone-50/60 dark:bg-stone-800/30 px-3 py-2 text-xs text-stone-500 dark:text-stone-400">
      <Archive className="w-3.5 h-3.5 mt-0.5 shrink-0 text-stone-400 dark:text-stone-500" />
      <span>
        Archived is a temporary resting state. Matters land here automatically after{' '}
        {IDLE_ARCHIVE_DAYS} days with no activity, and move back to{' '}
        <span className="font-medium text-emerald-600 dark:text-emerald-400">Ongoing</span>{' '}
        the moment new work arrives — a file, chat message, email, time or billing entry.
      </span>
    </div>
  );
}

// ── Last Status Report + Generate ────────────────────────────────

const STATUS_REPORT_STATUS_STYLES: Record<string, string> = {
  Drafting:             'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  'For Review':         'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  'For Final Review':   'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  Outbox:               'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400',
  Sent:                 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  [DELIVERABLE_STATUS.FILED_OR_SENT_OUT]:  'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  Filed:                'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  Done:                 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  Archived:             'bg-stone-100 text-stone-500 dark:bg-stone-800 dark:text-stone-400',
};

function StatusReportCell({
  matter,
  onGenerated,
}: {
  matter: PartnerMatterManagementRow;
  onGenerated: () => void;
}) {
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = useCallback(async () => {
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch('/api/status-report/adhoc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ matterId: matter.id }),
      });
      const body = await res.json();
      if (!res.ok || !body?.ok) {
        throw new Error(body?.error || 'Failed to generate report');
      }
      onGenerated();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setError(msg);
    } finally {
      setGenerating(false);
    }
  }, [matter.id, onGenerated]);

  const last = matter.lastStatusReport;
  const statusStyle = last ? STATUS_REPORT_STATUS_STYLES[last.status] ?? 'bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-400' : '';

  // Strip the leading "Status Report — " prefix so the date/subject stands out.
  const friendlyName = last
    ? last.name.replace(/^Status Report\s*[—\-:]\s*/i, '').trim() || last.name
    : '';

  return (
    <div className="flex items-center gap-2 max-w-[320px]">
      {last ? (
        <a
          href={`/dashboard/deliverables/${last.id}`}
          title={last.name}
          className="flex items-center gap-1.5 min-w-0 text-xs text-stone-600 dark:text-stone-400 hover:text-gold-600 dark:hover:text-gold-400 transition-colors"
        >
          <FileText className="w-3 h-3 text-stone-400 shrink-0 dark:text-stone-500" />
          <span className="tabular-nums shrink-0">{last.date || '—'}</span>
          {last.status && (
            <span className={`inline-flex px-1.5 py-0.5 rounded text-[9px] font-semibold shrink-0 ${statusStyle}`}>
              {last.status}
            </span>
          )}
          <span className="truncate italic text-stone-500 dark:text-stone-400" title={last.name}>
            {friendlyName}
          </span>
        </a>
      ) : (
        <span className="text-stone-300 text-xs italic dark:text-stone-600">no report yet</span>
      )}
      <button
        type="button"
        onClick={generate}
        disabled={generating}
        title={last ? 'Generate a new status report' : 'Generate the first status report'}
        className="ml-auto inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-gold-50 dark:bg-gold-900/20 text-gold-700 dark:text-gold-400 border border-gold-200/60 dark:border-gold-700/40 hover:bg-gold-100 dark:hover:bg-gold-900/30 cursor-pointer transition-colors disabled:opacity-60 disabled:cursor-wait shrink-0"
      >
        {generating ? (
          <><Loader2 className="w-3 h-3 animate-spin" /> Generating…</>
        ) : (
          <><Sparkles className="w-3 h-3" /> Generate</>
        )}
      </button>
      {error && (
        <span className="text-[10px] text-red-500 dark:text-red-400" title={error}>error</span>
      )}
    </div>
  );
}

// ── Inline edit: Team picker ─────────────────────────────────────

function TeamPicker({
  selected,
  teamInitials,
  people,
  capacity,
  onSave,
}: {
  selected: string[];
  teamInitials: { personId: string; initials: string; name: string; avatarUrl: string | null }[];
  people: Person[];
  capacity: Map<string, CapacityInfo>;
  onSave: (ids: string[]) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string[]>(selected);
  const [saving, setSaving] = useState(false);
  const [sortByCapacity, setSortByCapacity] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const pos = useAnchoredPosition(btnRef, open, 'left', 320);

  useEffect(() => {
    setDraft(selected);
  }, [selected]);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || dropdownRef.current?.contains(t)) return;
      setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const toggle = (id: string) => {
    setDraft((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const save = async () => {
    setSaving(true);
    await onSave(draft);
    setSaving(false);
    setOpen(false);
  };

  const orderedPeople = useMemo(() => {
    if (!sortByCapacity) return people;
    return [...people].sort((a, b) => {
      const ca = capacity.get(a.person_id);
      const cb = capacity.get(b.person_id);
      const ra = ca?.remaining ?? 0;
      const rb = cb?.remaining ?? 0;
      if (ra !== rb) return rb - ra; // most free first
      return (ca?.score ?? 0) - (cb?.score ?? 0); // tie-break: lower score first
    });
  }, [people, sortByCapacity, capacity]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 px-1.5 py-1 rounded-md hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors cursor-pointer"
        title="Edit team"
      >
        {teamInitials.length > 0 ? (
          <div className="flex -space-x-1.5">
            {teamInitials.slice(0, 4).map((t) => (
              <Avatar
                key={t.personId}
                avatarUrl={t.avatarUrl}
                initials={t.initials}
                name={t.name}
                title={t.name}
                size={24}
                className="ring-2 ring-[var(--card-bg)]"
                fallbackClassName="bg-navy-100 dark:bg-navy-500/20 text-navy-700 dark:text-navy-300 text-[9px] font-bold"
              />
            ))}
            {teamInitials.length > 4 && (
              <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-stone-200 dark:bg-stone-700 text-stone-600 dark:text-stone-400 text-[9px] font-bold ring-2 ring-[var(--card-bg)]">
                +{teamInitials.length - 4}
              </span>
            )}
          </div>
        ) : (
          <span className="text-xs text-stone-400 flex items-center gap-1 dark:text-stone-500">
            <Plus className="w-3 h-3" /> Assign
          </span>
        )}
      </button>

      {open && createPortal(
        <div
          ref={dropdownRef}
          style={{ top: pos.top, left: pos.left }}
          className="fixed z-[9999] w-80 bg-[var(--card-bg)] border border-[var(--border-color)] rounded-lg shadow-lg overflow-hidden"
        >
          <div className="flex items-center justify-between px-3 py-1.5 border-b border-stone-100 dark:border-stone-800 bg-stone-50/50 dark:bg-stone-800/30">
            <span className="text-[10px] uppercase tracking-wider font-semibold text-stone-400 dark:text-stone-500">Assign team</span>
            <button
              type="button"
              onClick={() => setSortByCapacity((v) => !v)}
              className={`text-[10px] font-medium px-2 py-0.5 rounded-full cursor-pointer transition-colors ${
                sortByCapacity
                  ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400'
                  : 'text-stone-500 hover:bg-stone-100 dark:hover:bg-stone-800 dark:text-stone-400'
              }`}
              title="Sort by who can take more work"
            >
              {sortByCapacity ? '✓ Who can take this?' : 'Who can take this?'}
            </button>
          </div>
          <div className="max-h-64 overflow-y-auto divide-y divide-stone-100 dark:divide-stone-800/50">
            {orderedPeople.map((p) => {
              const on = draft.includes(p.person_id);
              const cap = capacity.get(p.person_id);
              return (
                <button
                  key={p.person_id}
                  type="button"
                  onClick={() => toggle(p.person_id)}
                  className={`w-full text-left px-3 py-2 flex items-center gap-2 text-xs cursor-pointer transition-colors ${
                    on ? 'bg-gold-50 dark:bg-gold-900/20' : 'hover:bg-stone-50 dark:hover:bg-stone-800/30'
                  }`}
                >
                  <span className={`inline-flex items-center justify-center w-5 h-5 rounded border ${on ? 'bg-gold-500 border-gold-500 text-white' : 'border-stone-300 dark:border-stone-600'}`}>
                    {on && <Check className="w-3 h-3" />}
                  </span>
                  <Avatar
                    avatarUrl={p.avatar_url}
                    initials={p.initials}
                    name={p.name}
                    size={24}
                    fallbackClassName="bg-navy-100 dark:bg-navy-500/15 text-navy-700 dark:text-navy-300 text-[9px] font-bold"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-stone-800 dark:text-stone-200 truncate">{p.name}</div>
                    <div className="text-[10px] text-stone-400 dark:text-stone-500">{p.position}</div>
                  </div>
                  {cap && <CapacityBadge cap={cap} />}
                </button>
              );
            })}
          </div>
          <div className="flex items-center justify-end gap-2 px-3 py-2 border-t border-stone-100 dark:border-stone-800">
            <button
              type="button"
              onClick={() => { setDraft(selected); setOpen(false); }}
              className="text-xs text-stone-500 hover:text-stone-700 dark:hover:text-stone-300 cursor-pointer dark:text-stone-400"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="inline-flex items-center gap-1 px-3 py-1 rounded-md bg-gold-500 text-white text-xs font-medium hover:bg-gold-600 disabled:opacity-60 cursor-pointer"
            >
              {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
              Save
            </button>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

function CapacityBadge({ cap }: { cap: CapacityInfo }) {
  const styles: Record<UtilizationBucket, { pill: string; label: string }> = {
    Free:       { pill: 'bg-stone-100 text-stone-500 dark:bg-stone-800 dark:text-stone-400', label: 'free' },
    Balanced:   { pill: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400', label: 'balanced' },
    Busy:       { pill: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400', label: 'busy' },
    Overworked: { pill: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400', label: 'over' },
  };
  const s = styles[cap.bucket];
  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-semibold shrink-0 ${s.pill}`}
      title={`Utilization ${cap.score.toFixed(2)}× — ${cap.bucket.toLowerCase()}`}
    >
      {cap.score.toFixed(2)}×
    </span>
  );
}

// ── Inline edit: Select (status / outcome) ───────────────────────

function InlineSelect({
  value,
  options,
  styleMap,
  placeholder,
  onSave,
}: {
  value: string;
  options: string[];
  styleMap: Record<string, string>;
  placeholder?: string;
  onSave: (v: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const pos = useAnchoredPosition(btnRef, open, 'left', 160);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || dropdownRef.current?.contains(t)) return;
      setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const display = value || placeholder || '—';
  const style = styleMap[value] ?? 'bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-400';

  const pick = async (v: string) => {
    if (v === value) { setOpen(false); return; }
    setSaving(true);
    await onSave(v);
    setSaving(false);
    setOpen(false);
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={saving}
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold cursor-pointer hover:ring-2 hover:ring-gold-300/30 transition-shadow ${value ? style : 'text-stone-400 hover:bg-stone-100 dark:hover:bg-stone-800 dark:text-stone-500'}`}
      >
        {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
        {display}
        <ChevronDown className="w-3 h-3 opacity-60" />
      </button>
      {open && createPortal(
        <div
          ref={dropdownRef}
          style={{ top: pos.top, left: pos.left }}
          className="fixed z-[9999] min-w-[140px] bg-[var(--card-bg)] border border-[var(--border-color)] rounded-lg shadow-lg overflow-hidden"
        >
          {options.map((opt) => (
            <button
              key={opt || '__empty'}
              type="button"
              onClick={() => pick(opt)}
              className={`w-full text-left px-3 py-1.5 text-xs cursor-pointer transition-colors ${
                opt === value
                  ? 'bg-gold-50 dark:bg-gold-900/20 text-gold-700 dark:text-gold-400 font-semibold'
                  : 'text-stone-700 dark:text-stone-300 hover:bg-stone-50 dark:hover:bg-stone-800/30'
              }`}
            >
              {opt || <span className="italic text-stone-400 dark:text-stone-500">(clear)</span>}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}

// ── Inline edit: Related-matter picker ───────────────────────────

function RelatedPicker({
  matterId,
  relatedIds,
  allLite,
  onSave,
}: {
  matterId: string;
  relatedIds: string[];
  allLite: PartnerMatterLite[];
  onSave: (ids: string[]) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string[]>(relatedIds);
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const pos = useAnchoredPosition(btnRef, open, 'right', 320);

  useEffect(() => { setDraft(relatedIds); }, [relatedIds]);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || dropdownRef.current?.contains(t)) return;
      setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const liteById = useMemo(() => {
    const m = new Map<string, PartnerMatterLite>();
    for (const x of allLite) m.set(x.id, x);
    return m;
  }, [allLite]);

  const candidates = useMemo(() => {
    const q = search.toLowerCase();
    return allLite
      .filter((x) => x.id !== matterId)
      .filter((x) =>
        !q ||
        x.name.toLowerCase().includes(q) ||
        x.matterCode.toLowerCase().includes(q) ||
        x.clientName.toLowerCase().includes(q),
      )
      .slice(0, 40);
  }, [allLite, matterId, search]);

  const toggle = (id: string) => {
    setDraft((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const save = async () => {
    setSaving(true);
    await onSave(draft);
    setSaving(false);
    setOpen(false);
  };

  const chips = relatedIds
    .map((id) => liteById.get(id))
    .filter((x): x is PartnerMatterLite => !!x);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 px-1.5 py-1 rounded-md hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors cursor-pointer min-w-[56px]"
        title="Edit related matters"
      >
        {chips.length > 0 ? (
          <div className="flex items-center gap-1 flex-wrap max-w-[180px]">
            {chips.slice(0, 2).map((c) => (
              <span
                key={c.id}
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 text-[10px] font-semibold"
                title={c.name}
              >
                <Link2 className="w-2.5 h-2.5" />
                {c.matterCode || c.name.slice(0, 12)}
              </span>
            ))}
            {chips.length > 2 && (
              <span className="text-[10px] text-stone-500 dark:text-stone-400">+{chips.length - 2}</span>
            )}
          </div>
        ) : (
          <span className="text-xs text-stone-400 flex items-center gap-1 dark:text-stone-500">
            <Plus className="w-3 h-3" /> Link
          </span>
        )}
      </button>

      {open && createPortal(
        <div
          ref={dropdownRef}
          style={{ top: pos.top, left: pos.left }}
          className="fixed z-[9999] w-80 bg-[var(--card-bg)] border border-[var(--border-color)] rounded-lg shadow-lg overflow-hidden"
        >
          <div className="p-2 border-b border-stone-100 dark:border-stone-800">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-stone-400 dark:text-stone-500" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search matters to link..."
                className="w-full pl-7 pr-2 py-1.5 text-xs rounded-md border border-[var(--border-color)] bg-transparent text-stone-800 dark:text-stone-200 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-gold-500/30 dark:placeholder:text-stone-500"
              />
            </div>
          </div>
          <div className="max-h-64 overflow-y-auto divide-y divide-stone-100 dark:divide-stone-800/50">
            {candidates.length === 0 ? (
              <div className="text-center py-4 text-xs text-stone-400 dark:text-stone-500">No matches</div>
            ) : candidates.map((c) => {
              const on = draft.includes(c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => toggle(c.id)}
                  className={`w-full text-left px-3 py-2 flex items-start gap-2 text-xs cursor-pointer transition-colors ${
                    on ? 'bg-violet-50 dark:bg-violet-900/20' : 'hover:bg-stone-50 dark:hover:bg-stone-800/30'
                  }`}
                >
                  <span className={`inline-flex items-center justify-center w-4 h-4 rounded border shrink-0 mt-0.5 ${on ? 'bg-violet-500 border-violet-500 text-white' : 'border-stone-300 dark:border-stone-600'}`}>
                    {on && <Check className="w-2.5 h-2.5" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-stone-800 dark:text-stone-200 truncate">{c.name}</div>
                    <div className="text-[10px] text-stone-400 flex items-center gap-1.5 dark:text-stone-500">
                      {c.matterCode && <span className="tabular-nums">{c.matterCode}</span>}
                      {c.clientName && <span>&middot; {c.clientName}</span>}
                      {c.status && <span>&middot; {c.status}</span>}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
          <div className="flex items-center justify-end gap-2 px-3 py-2 border-t border-stone-100 dark:border-stone-800">
            <button
              type="button"
              onClick={() => { setDraft(relatedIds); setOpen(false); }}
              className="text-xs text-stone-500 hover:text-stone-700 dark:hover:text-stone-300 cursor-pointer dark:text-stone-400"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="inline-flex items-center gap-1 px-3 py-1 rounded-md bg-gold-500 text-white text-xs font-medium hover:bg-gold-600 disabled:opacity-60 cursor-pointer"
            >
              {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
              Save
            </button>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

// ── Outcomes Tab ─────────────────────────────────────────────────

function OutcomesTab({
  matters,
  onUpdate,
}: {
  matters: PartnerMatterManagementRow[];
  onUpdate: () => void;
}) {
  const groups = useMemo(() => {
    // Only matters marked Done carry real outcomes. Archived is a separate lifecycle state.
    const done = matters.filter((m) => m.status === 'Done');
    const by = new Map<string, PartnerMatterManagementRow[]>();
    for (const m of done) {
      const label = classifyOutcome(m.outcome);
      if (!by.has(label)) by.set(label, []);
      by.get(label)!.push(m);
    }

    // For "No Outcome": only show cases (have case_title or case_number).
    // Retainers / admin matters don't need an outcome set.
    const noOutcome = by.get('No Outcome') ?? [];
    const caseOnly = noOutcome.filter((m) => m.caseTitle.trim() || m.caseNumber.trim());
    if (caseOnly.length > 0) by.set('No Outcome', caseOnly);
    else by.delete('No Outcome');

    return [...by.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [matters]);

  if (groups.length === 0) {
    return (
      <div className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-xl p-10 text-center">
        <Trophy className="w-8 h-8 mx-auto text-stone-300 dark:text-stone-600 mb-3" />
        <p className="text-sm text-stone-500 dark:text-stone-400">No matters marked Done yet.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {groups.map(([label, rows]) => (
        <OutcomeGroup key={label} label={label} rows={rows} onUpdate={onUpdate} />
      ))}
    </div>
  );
}

function OutcomeGroup({
  label,
  rows,
  onUpdate,
}: {
  label: string;
  rows: PartnerMatterManagementRow[];
  onUpdate: () => void;
}) {
  const [open, setOpen] = useState(true);
  const isNoOutcome = label === 'No Outcome';
  return (
    <div className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-stone-50/50 dark:hover:bg-stone-800/20 cursor-pointer"
      >
        <div className="flex items-center gap-2">
          <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold ${OUTCOME_STYLES[label] ?? 'bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-400'}`}>
            {label}
          </span>
          <span className="text-[11px] text-stone-400 tabular-nums dark:text-stone-500">{rows.length}</span>
          {isNoOutcome && (
            <span className="text-[11px] text-stone-400 italic dark:text-stone-500">cases awaiting outcome</span>
          )}
        </div>
        {open ? <ChevronDown className="w-4 h-4 text-stone-400 dark:text-stone-500" /> : <ChevronRight className="w-4 h-4 text-stone-400 dark:text-stone-500" />}
      </button>
      {open && (
        <div className="divide-y divide-stone-100 dark:divide-stone-800/50">
          {rows.map((m) => (
            <OutcomeRow
              key={m.id}
              matter={m}
              label={label}
              isNoOutcome={isNoOutcome}
              onUpdate={onUpdate}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function OutcomeRow({
  matter,
  label,
  isNoOutcome,
}: {
  matter: PartnerMatterManagementRow;
  label: string;
  isNoOutcome: boolean;
  onUpdate: () => void;
}) {
  const patchMatter = usePatchMatter();
  const saveOutcome = useCallback((v: string) => patchMatter(matter.id, { outcome: v }), [patchMatter, matter.id]);

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 hover:bg-stone-50/50 dark:hover:bg-stone-800/20 transition-colors">
      <a
        href={`/dashboard/matters/${matter.id}`}
        className="flex-1 min-w-0"
      >
        <span className="text-sm font-medium text-stone-800 dark:text-stone-200 line-clamp-1">{matter.name}</span>
        <span className="ml-2 text-xs text-stone-400 dark:text-stone-500">{matter.clientName}</span>
        {isNoOutcome && matter.caseNumber && (
          <span className="ml-2 text-[10px] text-stone-400 tabular-nums dark:text-stone-500">{matter.caseNumber}</span>
        )}
      </a>
      {matter.type && (
        <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold shrink-0 ${TYPE_COLORS[matter.type] ?? 'bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-400'}`}>
          {matter.type}
        </span>
      )}
      <InlineSelect
        value={isNoOutcome ? '' : matter.outcome ?? ''}
        options={isNoOutcome ? OUTCOME_OPTIONS.filter((o) => o !== '') : OUTCOME_OPTIONS}
        styleMap={OUTCOME_STYLES}
        placeholder="Set outcome"
        onSave={saveOutcome}
      />
    </div>
  );
}

function classifyOutcome(outcome: string): string {
  if (!outcome) return 'No Outcome';
  const lc = outcome.toLowerCase();
  if (/^win$|won|favorable|granted/.test(lc)) return 'Win';
  if (/^loss$|lost|denied|unfavorable/.test(lc)) return 'Loss';
  if (/settle/.test(lc)) return 'Settled';
  if (/terminat/.test(lc)) return 'Terminated';
  if (/withdraw/.test(lc)) return 'Withdrawn';
  if (/dismiss/.test(lc)) return 'Dismissed';
  return outcome;
}
