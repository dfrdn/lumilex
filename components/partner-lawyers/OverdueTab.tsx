'use client';

import { useMemo, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, Calendar, ExternalLink } from 'lucide-react';
import { manilaToday } from '@/lib/dates';
import { FORMER_MEMBER } from '@/lib/former-member';

export interface OverdueItem {
  id: string;
  name: string;
  matterId: string | null;
  matterName: string;
  dueDate: string;
  status: string;
  currentlyWithIds: string[];
}

export interface LawyerWorkload {
  id: string;
  personId: string;
  name: string;
  initials: string;
  position: string;
}

interface Props {
  items: OverdueItem[];
  lawyers: LawyerWorkload[];
  onSelectLawyer: (personId: string, initials: string) => void;
}

export default function OverdueTab({ items, lawyers, onSelectLawyer }: Props) {
  const lawyerMap = useMemo(() => {
    const m = new Map<string, LawyerWorkload>();
    for (const l of lawyers) m.set(l.personId, l);
    return m;
  }, [lawyers]);

  const groups = useMemo(() => {
    const by = new Map<string, OverdueItem[]>();
    const unassigned: OverdueItem[] = [];
    for (const item of items) {
      if (item.currentlyWithIds.length === 0) {
        unassigned.push(item);
        continue;
      }
      for (const pid of item.currentlyWithIds) {
        if (!by.has(pid)) by.set(pid, []);
        by.get(pid)!.push(item);
      }
    }
    // Sort each group's items by oldest first
    for (const arr of by.values()) {
      arr.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    }
    unassigned.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    // Build sorted array by most-overdue count
    const sorted = [...by.entries()].sort((a, b) => b[1].length - a[1].length);
    return { sorted, unassigned };
  }, [items]);

  const totalUnique = items.length;
  const totalPeopleAffected = groups.sorted.length;
  const oldestDate = useMemo(
    () =>
      items.reduce<string | null>((acc, i) => (acc === null || i.dueDate < acc ? i.dueDate : acc), null),
    [items],
  );
  const today = manilaToday();
  const oldestDays = oldestDate ? daysBetween(oldestDate, today) : 0;

  return (
    <div className="space-y-6">
      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Overdue items" value={totalUnique} tone={totalUnique > 0 ? 'red' : 'stone'} />
        <Kpi label="Lawyers affected" value={totalPeopleAffected} tone={totalPeopleAffected > 0 ? 'amber' : 'stone'} />
        <Kpi label="Unassigned" value={groups.unassigned.length} tone={groups.unassigned.length > 0 ? 'red' : 'stone'} />
        <Kpi label="Oldest overdue" value={oldestDate ? `${oldestDays}d` : '—'} sub={oldestDate ?? undefined} tone={oldestDays > 30 ? 'red' : 'amber'} />
      </div>

      {totalUnique === 0 && (
        <div className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-xl p-10 text-center">
          <AlertTriangle className="w-8 h-8 mx-auto text-stone-300 dark:text-stone-600 mb-3" />
          <p className="text-sm text-stone-500 dark:text-stone-400">No overdue deliverables. Nice.</p>
        </div>
      )}

      {/* Unassigned group */}
      {groups.unassigned.length > 0 && (
        <UnassignedGroup items={groups.unassigned} />
      )}

      {/* Lawyer groups */}
      <div className="space-y-3">
        {groups.sorted.map(([personId, group]) => {
          const lawyer = lawyerMap.get(personId);
          return (
            <LawyerGroup
              key={personId}
              lawyer={lawyer}
              personId={personId}
              items={group}
              today={today}
              onSelect={lawyer ? () => onSelectLawyer(lawyer.personId, lawyer.initials) : undefined}
            />
          );
        })}
      </div>
    </div>
  );
}

function LawyerGroup({
  lawyer,
  personId,
  items,
  today,
  onSelect,
}: {
  lawyer: LawyerWorkload | undefined;
  personId: string;
  items: OverdueItem[];
  today: string;
  onSelect?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const label = lawyer ? lawyer.name : FORMER_MEMBER;
  const initials = lawyer?.initials ?? '–';
  const position = lawyer?.position ?? '';
  const worstDays = daysBetween(items[0].dueDate, today);

  return (
    <div className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-stone-50/50 dark:hover:bg-stone-800/20 cursor-pointer transition-colors"
      >
        <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-navy-100 dark:bg-navy-500/15 text-navy-700 dark:text-navy-300 text-[10px] font-bold shrink-0">
          {initials}
        </span>
        <div className="min-w-0 flex-1 text-left">
          <div className="text-sm font-semibold text-stone-800 dark:text-stone-200 truncate">{label}</div>
          <div className="text-[11px] text-stone-400 dark:text-stone-500">{position}</div>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span className="inline-flex items-center gap-1 text-red-500 font-semibold tabular-nums dark:text-red-400">
            <AlertTriangle className="w-3 h-3" />
            {items.length} overdue
          </span>
          <span className="text-stone-400 tabular-nums dark:text-stone-500">oldest: {worstDays}d</span>
        </div>
        {onSelect && (
          <span
            onClick={(e) => { e.stopPropagation(); onSelect(); }}
            role="button"
            className="text-[11px] text-gold-600 dark:text-gold-400 hover:underline cursor-pointer inline-flex items-center gap-1"
          >
            Open detail <ExternalLink className="w-3 h-3" />
          </span>
        )}
        {open ? <ChevronDown className="w-4 h-4 text-stone-400 shrink-0 dark:text-stone-500" /> : <ChevronRight className="w-4 h-4 text-stone-400 shrink-0 dark:text-stone-500" />}
      </button>
      {open && (
        <div className="divide-y divide-stone-100 dark:divide-stone-800/50 border-t border-stone-100 dark:border-stone-800/50">
          {items.map((item) => (
            <OverdueRow key={item.id} item={item} today={today} />
          ))}
        </div>
      )}
    </div>
  );
}

function UnassignedGroup({ items }: { items: OverdueItem[] }) {
  const [open, setOpen] = useState(true);
  const today = manilaToday();
  return (
    <div className="bg-red-50/50 dark:bg-red-900/10 border border-red-200 dark:border-red-900/30 rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 cursor-pointer"
      >
        <AlertTriangle className="w-5 h-5 text-red-500 shrink-0 dark:text-red-400" />
        <div className="flex-1 text-left">
          <div className="text-sm font-semibold text-red-700 dark:text-red-400">Unassigned overdue</div>
          <div className="text-[11px] text-red-500/70">No lawyer currently holds these</div>
        </div>
        <span className="text-xs text-red-500 font-semibold tabular-nums dark:text-red-400">{items.length}</span>
        {open ? <ChevronDown className="w-4 h-4 text-red-500 shrink-0 dark:text-red-400" /> : <ChevronRight className="w-4 h-4 text-red-500 shrink-0 dark:text-red-400" />}
      </button>
      {open && (
        <div className="divide-y divide-red-100 dark:divide-red-900/20 border-t border-red-200 dark:border-red-900/30 bg-[var(--card-bg)]">
          {items.map((item) => (
            <OverdueRow key={item.id} item={item} today={today} />
          ))}
        </div>
      )}
    </div>
  );
}

function OverdueRow({ item, today }: { item: OverdueItem; today: string }) {
  const days = daysBetween(item.dueDate, today);
  return (
    <a
      href={item.matterId ? `/dashboard/matters/${item.matterId}` : '#'}
      className="flex items-center gap-3 px-4 py-2.5 hover:bg-stone-50/50 dark:hover:bg-stone-800/20 transition-colors"
    >
      <div className="flex-1 min-w-0">
        <span className="text-sm font-medium text-stone-800 dark:text-stone-200 line-clamp-1">{item.name}</span>
        <span className="ml-2 text-xs text-stone-400 dark:text-stone-500">{item.matterName}</span>
      </div>
      <span className={`inline-flex px-2 py-0.5 rounded text-[10px] font-semibold shrink-0 ${item.status ? 'bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-400' : ''}`}>
        {item.status || 'Pending'}
      </span>
      <span className="inline-flex items-center gap-1 text-[11px] text-red-500 font-semibold tabular-nums shrink-0 dark:text-red-400">
        <Calendar className="w-3 h-3" />
        {item.dueDate}
        <span className="text-red-400">({days}d)</span>
      </span>
    </a>
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
  tone: 'red' | 'amber' | 'stone';
}) {
  const accent = { red: 'text-red-500 dark:text-red-400', amber: 'text-amber-500', stone: 'text-stone-400 dark:text-stone-500' }[tone];
  return (
    <div className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-xl p-3">
      <div className={`text-[10px] uppercase tracking-wider font-semibold ${accent}`}>{label}</div>
      <div className="mt-1 font-serif text-2xl font-bold tabular-nums text-stone-800 dark:text-stone-100">{value}</div>
      {sub && <div className="text-[10px] text-stone-400 mt-0.5 tabular-nums dark:text-stone-500">{sub}</div>}
    </div>
  );
}

function daysBetween(a: string, b: string): number {
  const ad = new Date(a + 'T00:00:00').getTime();
  const bd = new Date(b + 'T00:00:00').getTime();
  return Math.round((bd - ad) / 86400000);
}
