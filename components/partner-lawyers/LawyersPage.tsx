'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import { toast } from 'sonner';
import {
  LayoutGrid, Users2, Search, Loader2, Gauge, AlertTriangle, Scale,
  Briefcase, FileText, Clock, X, Check, ChevronDown, Plus, Minus, User,
  TrendingUp, ArrowRightLeft,
} from 'lucide-react';
import dynamic from 'next/dynamic';
import UtilizationTab from './UtilizationTab';
import FinancialUtilizationTab from './FinancialUtilizationTab';
import OverdueTab, { type OverdueItem } from './OverdueTab';
import BenchTab from './BenchTab';

const LawyerDetailTab = dynamic(() => import('./LawyerDetailTab'), {
  ssr: false,
  loading: () => <div className="h-[600px] rounded-xl skeleton-shimmer" aria-busy aria-label="Loading" />,
});

// ── Types ─────────────────────────────────────────────────────────

interface LawyerWorkload {
  id: string;
  personId: string;
  name: string;
  initials: string;
  position: string;
  active: boolean;
  totalMatters: number;
  typeBreakdown: Record<string, number>;
  pendingDeliverables: number;
  submittedThisMonth: number;
  hoursThisMonth: number;
}

interface Matter {
  notion_id: string;
  name: string;
  client_name: string;
  type: string;
  status: string;
  team_person_ids: string[];
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

const POSITION_ORDER: Record<string, number> = {
  'Founding Partner': 0, 'Managing Partner': 1, 'Monitoring Partner': 2, 'Partner': 3,
  'Of Counsel': 4, 'Senior Associate': 5, 'Mid-level Associate': 6,
  'Junior Associate': 7, 'Underbar Associate': 8,
};

const BASE_TABS = [
  { key: 'summary', label: 'Summary', icon: LayoutGrid },
  { key: 'utilization', label: 'Workload', icon: Gauge },
  { key: 'financial', label: 'Financial', icon: TrendingUp },
  { key: 'overdue', label: 'Overdue', icon: AlertTriangle },
  { key: 'bench', label: 'Bench', icon: Scale },
  { key: 'assign', label: 'Team Assignment', icon: Users2 },
] as const;

type TabKey = 'summary' | 'utilization' | 'financial' | 'overdue' | 'bench' | 'assign' | 'detail';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

// ── Main Component ────────────────────────────────────────────────

export default function LawyersPage({
  canEditSalary = false,
}: {
  canEditSalary?: boolean;
}) {
  const [tab, setTab] = useState<TabKey>('summary');
  const [selectedLawyer, setSelectedLawyer] = useState<{ personId: string; initials: string } | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const { data, isLoading } = useSWR('/api/partner/lawyers', fetcher, { keepPreviousData: true });
  const { data: peopleData } = useSWR('/api/people', fetcher);
  const workload: LawyerWorkload[] = data?.workload ?? [];
  const allMatters: Matter[] = data?.allMatters ?? [];
  const overdueItems: OverdueItem[] = data?.overdueItems ?? [];

  // The workload/financial/overdue/bench tabs only ever deal with active
  // lawyers. The Summary roster, the detail switcher, and the Team Assignment
  // selector reveal inactive members when the header toggle is on — the latter
  // so matters can be transferred off a resigned lawyer.
  const activeWorkload = useMemo(() => workload.filter((l) => l.active), [workload]);
  const inactiveCount = workload.length - activeWorkload.length;
  const visibleWorkload = showInactive ? workload : activeWorkload;

  // Map all people (active + inactive) for resolving initials
  const allPeopleMap = useMemo(() => {
    const map = new Map<string, { name: string; initials: string }>();
    for (const p of peopleData?.people ?? []) {
      map.set(p.person_id, { name: p.name, initials: p.initials });
    }
    return map;
  }, [peopleData]);

  const openLawyerDetail = useCallback((personId: string, initials: string) => {
    setSelectedLawyer({ personId, initials });
    setTab('detail');
  }, []);

  if (!mounted || isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-5 h-5 text-gold-500 animate-spin dark:text-gold-400" />
      </div>
    );
  }

  const tabs: { key: TabKey; label: string; icon: typeof LayoutGrid }[] = [
    ...BASE_TABS,
    ...(selectedLawyer
      ? [{ key: 'detail' as TabKey, label: selectedLawyer.initials, icon: User }]
      : []),
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gold-50 dark:bg-gold-900/20 flex items-center justify-center">
            <Users2 className="w-5 h-5 text-gold-600 dark:text-gold-400" />
          </div>
          <div>
            <h1 className="font-serif text-2xl font-bold tracking-tight text-stone-900 dark:text-stone-100">
              Lawyers
            </h1>
            <p className="text-xs text-stone-400 dark:text-stone-500 mt-0.5">
              {activeWorkload.length} active team members
              {showInactive && inactiveCount > 0 && ` · ${inactiveCount} inactive`}
            </p>
          </div>
        </div>

        {(tab === 'summary' || tab === 'assign') && inactiveCount > 0 && (
          <button
            type="button"
            role="switch"
            aria-checked={showInactive}
            onClick={() => setShowInactive((v) => !v)}
            className="inline-flex items-center gap-2 text-xs font-medium text-stone-600 dark:text-stone-300 cursor-pointer select-none"
          >
            <span
              className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                showInactive ? 'bg-gold-500 dark:bg-gold-600' : 'bg-stone-300 dark:bg-stone-700'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${
                  showInactive ? 'translate-x-4' : 'translate-x-0.5'
                }`}
              />
            </span>
            Show inactive
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 bg-stone-100 dark:bg-stone-800/50 rounded-lg p-1 w-fit">
        {tabs.map((t) => {
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

      {/* Tab Content */}
      {tab === 'summary' && <SummaryTab workload={visibleWorkload} onSelectLawyer={openLawyerDetail} />}
      {tab === 'utilization' && <UtilizationTab workload={activeWorkload} onSelectLawyer={openLawyerDetail} />}
      {tab === 'financial' && <FinancialUtilizationTab />}
      {tab === 'overdue' && <OverdueTab items={overdueItems} lawyers={activeWorkload} onSelectLawyer={openLawyerDetail} />}
      {tab === 'bench' && <BenchTab workload={activeWorkload} onSelectLawyer={openLawyerDetail} />}
      {tab === 'assign' && <TeamAssignmentTab workload={visibleWorkload} activeLawyers={activeWorkload} allMatters={allMatters} allPeopleMap={allPeopleMap} />}
      {tab === 'detail' && selectedLawyer && (
        <LawyerDetailTab
          personId={selectedLawyer.personId}
          lawyers={workload}
          onSwitchLawyer={openLawyerDetail}
          canEditSalary={canEditSalary}
        />
      )}
    </div>
  );
}

// ── Summary Tab ───────────────────────────────────────────────────

function SummaryTab({ workload, onSelectLawyer }: { workload: LawyerWorkload[]; onSelectLawyer: (personId: string, initials: string) => void }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {workload.map((lawyer) => (
        <LawyerCard key={lawyer.id} lawyer={lawyer} onSelect={() => onSelectLawyer(lawyer.personId, lawyer.initials)} />
      ))}
    </div>
  );
}

function LawyerCard({ lawyer, onSelect }: { lawyer: LawyerWorkload; onSelect: () => void }) {
  const typeEntries = Object.entries(lawyer.typeBreakdown).sort(([, a], [, b]) => b - a);

  return (
    <div
      className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-xl overflow-hidden hover:border-gold-300/50 dark:hover:border-gold-700/50 transition-colors cursor-pointer active:scale-[0.98]"
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(); } }}
    >
      {/* Color header bar */}
      <div
        className={`h-2 ${
          lawyer.active
            ? 'bg-gradient-to-r from-gold-400 to-gold-600 dark:from-gold-600 dark:to-gold-800'
            : 'bg-stone-200 dark:bg-stone-700'
        }`}
      />

      <div className={`p-4 space-y-3 ${lawyer.active ? '' : 'opacity-70'}`}>
        {/* Name + position */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="font-bold text-stone-900 dark:text-stone-100 text-sm">{lawyer.initials}</h3>
            <p className="text-[11px] text-stone-400 dark:text-stone-500">{lawyer.position}</p>
          </div>
          {!lawyer.active && (
            <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold bg-stone-100 text-stone-500 dark:bg-stone-800 dark:text-stone-400 shrink-0">
              Inactive
            </span>
          )}
        </div>

        {/* Stats */}
        <div className="flex items-center gap-1.5 text-xs">
          <Briefcase className="w-3.5 h-3.5 text-stone-400 dark:text-stone-500" />
          <span className="font-semibold text-stone-800 dark:text-stone-200">{lawyer.totalMatters} Matters</span>
        </div>

        {/* Type breakdown */}
        {typeEntries.length > 0 && (
          <div className="space-y-1">
            {typeEntries.map(([type, count]) => (
              <div key={type} className="flex items-center justify-between text-xs">
                <span className="text-stone-500 dark:text-stone-400">{type}</span>
                <span className="font-medium text-stone-700 dark:text-stone-300">{count}</span>
              </div>
            ))}
          </div>
        )}

        {/* Deliverables + Hours */}
        <div className="pt-2 border-t border-stone-100 dark:border-stone-800 space-y-1.5">
          <div className="flex items-center gap-1.5 text-xs">
            <FileText className="w-3.5 h-3.5 text-stone-400 dark:text-stone-500" />
            <span className="text-stone-600 dark:text-stone-400">
              {lawyer.pendingDeliverables} Pending &middot; {lawyer.submittedThisMonth} Submitted
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-xs">
            <Clock className="w-3.5 h-3.5 text-stone-400 dark:text-stone-500" />
            <span className="text-stone-600 dark:text-stone-400">
              {lawyer.hoursThisMonth} Hours This Month
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Team Assignment Tab ───────────────────────────────────────────

function TeamAssignmentTab({
  workload,
  activeLawyers,
  allMatters,
}: {
  workload: LawyerWorkload[];
  activeLawyers: LawyerWorkload[];
  allMatters: Matter[];
  allPeopleMap: Map<string, { name: string; initials: string }>;
}) {
  return <AssignByLawyer workload={workload} activeLawyers={activeLawyers} allMatters={allMatters} />;
}

// ── Assign By Lawyer (assign matters → lawyer) ───────────────────

function AssignByLawyer({
  workload,
  activeLawyers,
  allMatters,
}: {
  workload: LawyerWorkload[];
  activeLawyers: LawyerWorkload[];
  allMatters: Matter[];
}) {
  const { mutate } = useSWRConfig();
  const [selectedLawyer, setSelectedLawyer] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [transferFor, setTransferFor] = useState<string | null>(null);

  const sortedLawyers = useMemo(
    () => [...workload].sort((a, b) => (POSITION_ORDER[a.position] ?? 99) - (POSITION_ORDER[b.position] ?? 99)),
    [workload],
  );

  const selected = sortedLawyers.find((l) => l.personId === selectedLawyer);

  // Active lawyers a matter can be transferred to (never the current holder).
  const transferTargets = useMemo(
    () =>
      [...activeLawyers]
        .filter((l) => l.personId !== selectedLawyer)
        .sort((a, b) => (POSITION_ORDER[a.position] ?? 99) - (POSITION_ORDER[b.position] ?? 99)),
    [activeLawyers, selectedLawyer],
  );

  // Matters assigned to this lawyer and unassigned
  const { assigned, unassigned } = useMemo(() => {
    if (!selectedLawyer) return { assigned: [], unassigned: [] };
    const a: Matter[] = [];
    const u: Matter[] = [];
    for (const m of allMatters) {
      if (m.team_person_ids.includes(selectedLawyer)) a.push(m);
      else u.push(m);
    }
    return { assigned: a, unassigned: u };
  }, [selectedLawyer, allMatters]);

  const filteredUnassigned = useMemo(() => {
    if (!search) return unassigned;
    const q = search.toLowerCase();
    return unassigned.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        m.client_name.toLowerCase().includes(q) ||
        m.type.toLowerCase().includes(q),
    );
  }, [unassigned, search]);

  // Moves the matter between lists at once; the counts catch up on revalidation.
  const setTeam = useCallback((matterId: string, teamPersonIds: string[]) => {
    mutate<{ allMatters: Matter[] }>(
      '/api/partner/lawyers',
      async (current) => {
        const res = await fetch('/api/partner/lawyers', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ matterId, teamPersonIds }),
        });
        if (!res.ok) throw new Error('Failed');
        return current;
      },
      {
        optimisticData: (current) =>
          current
            ? { ...current, allMatters: current.allMatters.map((m) => (m.notion_id === matterId ? { ...m, team_person_ids: teamPersonIds } : m)) }
            : current!,
        rollbackOnError: true,
        populateCache: false,
        revalidate: true,
      },
    ).catch(() => toast.error('Could not update the team'));
  }, [mutate]);

  const toggleMatter = useCallback((matter: Matter, add: boolean) => {
    if (!selectedLawyer) return;
    const newIds = add
      ? [...matter.team_person_ids, selectedLawyer]
      : matter.team_person_ids.filter((id) => id !== selectedLawyer);
    setTeam(matter.notion_id, newIds);
  }, [selectedLawyer, setTeam]);

  // Reassign in one step: drop the current holder, add the target. Avoids the
  // remove-then-re-add dance and keeps the matter's other team members intact.
  const transferMatter = useCallback((matter: Matter, targetPersonId: string) => {
    if (!selectedLawyer) return;
    const newIds = matter.team_person_ids.filter((id) => id !== selectedLawyer);
    if (!newIds.includes(targetPersonId)) newIds.push(targetPersonId);
    setTransferFor(null);
    setTeam(matter.notion_id, newIds);
  }, [selectedLawyer, setTeam]);

  return (
    <div className="flex gap-6 items-start">
      {/* Lawyer selector panel */}
      <div className="w-52 shrink-0 bg-[var(--card-bg)] border border-[var(--border-color)] rounded-xl overflow-hidden">
        <div className="px-3 py-2.5 border-b border-[var(--border-color)]">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500">Select Lawyer</span>
        </div>
        <div className="max-h-[calc(100vh-280px)] overflow-y-auto">
          {sortedLawyers.map((l) => (
            <button
              key={l.personId}
              type="button"
              onClick={() => { setSelectedLawyer(l.personId); setSearch(''); setTransferFor(null); }}
              className={`w-full text-left px-3 py-2.5 flex items-center gap-2.5 transition-colors cursor-pointer border-b border-stone-50 dark:border-stone-800/50 ${
                selectedLawyer === l.personId
                  ? 'bg-gold-50 dark:bg-gold-900/20 text-gold-700 dark:text-gold-400'
                  : 'hover:bg-stone-50 dark:hover:bg-stone-800/30 text-stone-700 dark:text-stone-300'
              }`}
            >
              <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full bg-navy-100 dark:bg-navy-500/15 text-navy-700 dark:text-navy-300 text-[10px] font-bold shrink-0 ${l.active ? '' : 'opacity-60'}`}>
                {l.initials}
              </span>
              <div className="min-w-0">
                <div className="text-sm font-medium truncate flex items-center gap-1.5">
                  {l.initials}
                  {!l.active && (
                    <span className="inline-flex px-1.5 py-px rounded-full text-[9px] font-semibold bg-stone-100 text-stone-500 dark:bg-stone-800 dark:text-stone-400">
                      Inactive
                    </span>
                  )}
                </div>
                <div className="text-[10px] text-stone-400 dark:text-stone-500 truncate">{l.position}</div>
              </div>
              <span className="ml-auto text-xs font-semibold text-stone-400 dark:text-stone-500 tabular-nums">
                {l.totalMatters}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Matter assignment area */}
      <div className="flex-1 min-w-0 space-y-4">
        {!selected ? (
          <div className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-xl p-10 text-center">
            <Users2 className="w-8 h-8 mx-auto text-stone-300 dark:text-stone-600 mb-3" />
            <p className="text-sm text-stone-500 dark:text-stone-400">Select a lawyer to manage their matter assignments</p>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="flex items-center gap-3">
              <span className="inline-flex items-center justify-center w-9 h-9 rounded-full bg-navy-100 dark:bg-navy-500/15 text-navy-700 dark:text-navy-300 text-xs font-bold">
                {selected.initials}
              </span>
              <div>
                <h3 className="font-semibold text-stone-900 dark:text-stone-100 text-sm flex items-center gap-2">
                  {selected.name}
                  {!selected.active && (
                    <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold bg-stone-100 text-stone-500 dark:bg-stone-800 dark:text-stone-400">
                      Inactive
                    </span>
                  )}
                </h3>
                <p className="text-[11px] text-stone-400 dark:text-stone-500">{selected.position} &middot; {assigned.length} matters assigned</p>
              </div>
            </div>

            {!selected.active && assigned.length > 0 && (
              <div className="flex items-center gap-2 rounded-lg border border-gold-200 dark:border-gold-900/40 bg-gold-50/60 dark:bg-gold-900/10 px-3 py-2 text-xs text-stone-600 dark:text-stone-300">
                <ArrowRightLeft className="w-3.5 h-3.5 text-gold-600 dark:text-gold-400 shrink-0" />
                This lawyer is inactive. Use <span className="font-semibold">Transfer</span> to hand each matter to an active lawyer.
              </div>
            )}

            {/* Assigned matters */}
            <div>
              <h4 className="text-[11px] font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500 mb-2">
                Assigned Matters ({assigned.length})
              </h4>
              <div className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-xl">
                {assigned.length === 0 ? (
                  <div className="text-center py-6 text-xs text-stone-400 dark:text-stone-500">No matters assigned</div>
                ) : (
                  <div className="divide-y divide-stone-100 dark:divide-stone-800/50">
                    {assigned.map((m) => {
                      const menuOpen = transferFor === m.notion_id;
                      return (
                      <div key={m.notion_id} className="relative flex items-center gap-2 px-4 py-2.5 hover:bg-stone-50/50 dark:hover:bg-stone-800/20 transition-colors">
                        <div className="flex-1 min-w-0">
                          <span className="text-sm font-medium text-stone-800 dark:text-stone-200 line-clamp-1">{m.name}</span>
                          <span className="ml-2 text-xs text-stone-400 dark:text-stone-500">{m.client_name}</span>
                        </div>
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold shrink-0 ${TYPE_COLORS[m.type] ?? 'bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-400'}`}>
                          {m.type}
                        </span>

                        {/* Transfer to another lawyer */}
                        <div className="relative shrink-0">
                          <button
                            type="button"
                            disabled={transferTargets.length === 0}
                            onClick={() => setTransferFor(menuOpen ? null : m.notion_id)}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium text-stone-500 hover:text-gold-600 hover:bg-gold-50 dark:text-stone-400 dark:hover:text-gold-400 dark:hover:bg-gold-900/10 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                            title="Transfer to another lawyer"
                          >
                            <ArrowRightLeft className="w-3.5 h-3.5" />
                            Transfer
                          </button>
                          {menuOpen && (
                            <>
                              <div className="fixed inset-0 z-10" onClick={() => setTransferFor(null)} />
                              <div className="absolute right-0 top-full mt-1 z-20 w-56 max-h-64 overflow-y-auto rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] shadow-lg py-1">
                                <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500">
                                  Transfer to
                                </div>
                                {transferTargets.map((t) => (
                                  <button
                                    key={t.personId}
                                    type="button"
                                    onClick={() => transferMatter(m, t.personId)}
                                    className="w-full text-left px-3 py-2 flex items-center gap-2.5 hover:bg-stone-50 dark:hover:bg-stone-800/40 transition-colors cursor-pointer"
                                  >
                                    <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-navy-100 dark:bg-navy-500/15 text-navy-700 dark:text-navy-300 text-[9px] font-bold shrink-0">
                                      {t.initials}
                                    </span>
                                    <div className="min-w-0">
                                      <div className="text-xs font-medium text-stone-700 dark:text-stone-300 truncate">{t.initials}</div>
                                      <div className="text-[10px] text-stone-400 dark:text-stone-500 truncate">{t.position}</div>
                                    </div>
                                  </button>
                                ))}
                              </div>
                            </>
                          )}
                        </div>

                        <button
                          type="button"
                          onClick={() => toggleMatter(m, false)}
                          className="p-1 rounded-md text-stone-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/10 transition-colors cursor-pointer disabled:opacity-50 shrink-0 dark:text-stone-500 dark:hover:text-red-400"
                          title="Remove from team"
                        >
                          <Minus className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Add matters — hidden for inactive lawyers; transfer is the intended off-ramp */}
            {selected.active && (
            <div>
              <h4 className="text-[11px] font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500 mb-2">
                Add Matters
              </h4>
              <div className="relative max-w-md mb-2">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400 dark:text-stone-500" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search matters to add..."
                  className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] text-stone-800 dark:text-stone-200 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-gold-500/30 focus:border-gold-400 dark:placeholder:text-stone-500"
                />
              </div>
              <div className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-xl overflow-hidden max-h-80 overflow-y-auto">
                {filteredUnassigned.length === 0 ? (
                  <div className="text-center py-6 text-xs text-stone-400 dark:text-stone-500">
                    {search ? 'No matching matters found' : 'All matters are assigned to this lawyer'}
                  </div>
                ) : (
                  <div className="divide-y divide-stone-100 dark:divide-stone-800/50">
                    {filteredUnassigned.map((m) => (
                      <div key={m.notion_id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-stone-50/50 dark:hover:bg-stone-800/20 transition-colors">
                        <div className="flex-1 min-w-0">
                          <span className="text-sm font-medium text-stone-800 dark:text-stone-200 line-clamp-1">{m.name}</span>
                          <span className="ml-2 text-xs text-stone-400 dark:text-stone-500">{m.client_name}</span>
                        </div>
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold shrink-0 ${TYPE_COLORS[m.type] ?? 'bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-400'}`}>
                          {m.type}
                        </span>
                        <button
                          type="button"
                          onClick={() => toggleMatter(m, true)}
                          className="p-1 rounded-md text-stone-400 hover:text-gold-600 dark:hover:text-gold-400 hover:bg-gold-50 dark:hover:bg-gold-900/10 transition-colors cursor-pointer disabled:opacity-50 shrink-0 dark:text-stone-500"
                          title="Add to team"
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
