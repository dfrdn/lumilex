'use client';

import { useMemo } from 'react';
import { Scale, TrendingUp, Flame, Leaf } from 'lucide-react';
import { computeUtilization } from '@/lib/partner-lawyers/utilization';

export interface LawyerWorkload {
  id: string;
  personId: string;
  name: string;
  initials: string;
  position: string;
  totalMatters: number;
  typeBreakdown: Record<string, number>;
  pendingDeliverables: number;
  submittedThisMonth: number;
  hoursThisMonth: number;
}

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

interface Props {
  workload: LawyerWorkload[];
  onSelectLawyer: (personId: string, initials: string) => void;
}

export default function BenchTab({ workload, onSelectLawyer }: Props) {
  const enriched = useMemo(
    () =>
      workload.map((l) => {
        const u = computeUtilization(l.position, {
          hoursThisMonth: l.hoursThisMonth,
          pendingDeliverables: l.pendingDeliverables,
          submittedThisMonth: l.submittedThisMonth,
          totalMatters: l.totalMatters,
        });
        // Remaining capacity: how much room until the lawyer reaches baseline (1.0).
        // Negative for the overworked — clamp to 0 for firm-capacity sums.
        const remaining = Math.max(0, 1 - u.score);
        return { ...l, utilization: u, remaining };
      }),
    [workload],
  );

  // Group lawyers by matter type they already work on (proxy for practice area)
  const byType = useMemo(() => {
    const map = new Map<
      string,
      { matters: number; lawyers: typeof enriched }
    >();
    for (const l of enriched) {
      for (const [type, count] of Object.entries(l.typeBreakdown)) {
        if (count <= 0) continue;
        if (!map.has(type)) map.set(type, { matters: 0, lawyers: [] });
        const g = map.get(type)!;
        g.matters += count;
        g.lawyers.push(l);
      }
    }
    // Sort each group's lawyers by remaining capacity desc (most free first)
    for (const g of map.values()) {
      g.lawyers.sort((a, b) => b.remaining - a.remaining);
    }
    return [...map.entries()].sort((a, b) => b[1].matters - a[1].matters);
  }, [enriched]);

  // Firm-wide totals
  const totalRemaining = enriched.reduce((a, l) => a + l.remaining, 0);
  const totalOverworked = enriched.filter((l) => l.utilization.score > 1.2).length;
  const totalFree = enriched.filter((l) => l.utilization.score < 0.5).length;

  return (
    <div className="space-y-6">
      {/* Firm KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Firm Remaining" value={totalRemaining.toFixed(1)} sub="sum of free capacity" tone="emerald" />
        <Kpi label="Free Lawyers" value={totalFree} tone="emerald" />
        <Kpi label="Overworked" value={totalOverworked} tone="red" />
        <Kpi label="Matter Types" value={byType.length} tone="stone" />
      </div>

      <div className="text-[11px] text-stone-400 dark:text-stone-500">
        Capacity per lawyer = max(0, 1 − utilization score). Lawyers with &gt;0 matters in a type are treated as "on the bench" for that type.
      </div>

      {byType.length === 0 && (
        <div className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-xl p-10 text-center">
          <Scale className="w-8 h-8 mx-auto text-stone-300 dark:text-stone-600 mb-3" />
          <p className="text-sm text-stone-500 dark:text-stone-400">No ongoing matter assignments.</p>
        </div>
      )}

      <div className="space-y-4">
        {byType.map(([type, g]) => {
          const remainingForType = g.lawyers.reduce((a, l) => a + l.remaining, 0);
          const overworkedForType = g.lawyers.filter((l) => l.utilization.score > 1.2).length;
          const freeForType = g.lawyers.filter((l) => l.utilization.score < 0.5).length;
          return (
            <TypeCard
              key={type}
              type={type}
              matters={g.matters}
              lawyers={g.lawyers}
              remaining={remainingForType}
              overworked={overworkedForType}
              free={freeForType}
              onSelect={onSelectLawyer}
            />
          );
        })}
      </div>
    </div>
  );
}

function TypeCard({
  type,
  matters,
  lawyers,
  remaining,
  overworked,
  free,
  onSelect,
}: {
  type: string;
  matters: number;
  lawyers: {
    personId: string;
    initials: string;
    name: string;
    position: string;
    remaining: number;
    utilization: ReturnType<typeof computeUtilization>;
  }[];
  remaining: number;
  overworked: number;
  free: number;
  onSelect: (personId: string, initials: string) => void;
}) {
  // top 3 most-free
  const mostFree = lawyers.slice(0, 3);
  const avgMattersPerLawyer = matters / Math.max(1, lawyers.length);

  return (
    <div className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-stone-100 dark:border-stone-800/50 flex items-center gap-3">
        <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold ${TYPE_COLORS[type] ?? 'bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-400'}`}>
          {type}
        </span>
        <span className="text-xs text-stone-500 dark:text-stone-400 tabular-nums">
          {matters} matters &middot; {lawyers.length} lawyers &middot; avg {avgMattersPerLawyer.toFixed(1)}/lawyer
        </span>
        <div className="ml-auto flex items-center gap-3 text-[11px]">
          <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-semibold">
            <TrendingUp className="w-3 h-3" />
            {remaining.toFixed(1)} free
          </span>
          {overworked > 0 && (
            <span className="inline-flex items-center gap-1 text-red-500 font-semibold dark:text-red-400">
              <Flame className="w-3 h-3" /> {overworked} overworked
            </span>
          )}
          {free > 0 && (
            <span className="inline-flex items-center gap-1 text-stone-500 font-semibold dark:text-stone-400">
              <Leaf className="w-3 h-3" /> {free} free
            </span>
          )}
        </div>
      </div>

      {/* Stacked capacity bar */}
      <div className="px-4 py-3">
        <CapacityBar lawyers={lawyers} />
      </div>

      {/* Most available lawyers for this type */}
      <div className="px-4 pb-3 pt-1">
        <div className="text-[10px] uppercase tracking-wider font-semibold text-stone-400 mb-1.5 dark:text-stone-500">
          Most available on the bench
        </div>
        {mostFree.length === 0 || mostFree.every((l) => l.remaining === 0) ? (
          <div className="text-xs text-stone-400 italic dark:text-stone-500">No free capacity — everyone is at or above baseline.</div>
        ) : (
          <div className="flex items-center gap-2 flex-wrap">
            {mostFree
              .filter((l) => l.remaining > 0)
              .map((l) => (
                <button
                  key={l.personId}
                  type="button"
                  onClick={() => onSelect(l.personId, l.initials)}
                  className="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-emerald-50 dark:bg-emerald-900/20 hover:bg-emerald-100 dark:hover:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-900/40 cursor-pointer transition-colors"
                  title={l.name}
                >
                  <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-white dark:bg-stone-800 text-emerald-700 dark:text-emerald-400 text-[9px] font-bold">
                    {l.initials}
                  </span>
                  <span className="text-[11px] font-medium text-stone-700 dark:text-stone-200">{l.name.split(' ')[0]}</span>
                  <span className="text-[10px] text-emerald-700 dark:text-emerald-400 font-semibold tabular-nums">
                    {l.remaining.toFixed(2)} free
                  </span>
                </button>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}

function CapacityBar({
  lawyers,
}: {
  lawyers: { personId: string; initials: string; utilization: ReturnType<typeof computeUtilization> }[];
}) {
  // Stack segments where width = 1 per lawyer; color encodes their bucket.
  const n = lawyers.length;
  if (n === 0) return null;
  return (
    <div className="flex gap-0.5 h-3 rounded-full overflow-hidden">
      {lawyers.map((l) => {
        const bucket = l.utilization.bucket;
        const color =
          bucket === 'Overworked' ? 'bg-red-500'
          : bucket === 'Busy' ? 'bg-amber-500'
          : bucket === 'Balanced' ? 'bg-emerald-500'
          : 'bg-stone-300 dark:bg-stone-600';
        return (
          <div
            key={l.personId}
            className={`${color} flex-1`}
            title={`${l.initials}: ${l.utilization.score.toFixed(2)}× (${bucket})`}
          />
        );
      })}
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
  tone: 'emerald' | 'red' | 'stone' | 'amber';
}) {
  const accent = {
    emerald: 'text-emerald-500 dark:text-emerald-400',
    red: 'text-red-500 dark:text-red-400',
    stone: 'text-stone-400 dark:text-stone-500',
    amber: 'text-amber-500',
  }[tone];
  return (
    <div className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-xl p-3">
      <div className={`text-[10px] uppercase tracking-wider font-semibold ${accent}`}>{label}</div>
      <div className="mt-1 font-serif text-2xl font-bold tabular-nums text-stone-800 dark:text-stone-100">{value}</div>
      {sub && <div className="text-[10px] text-stone-400 mt-0.5 dark:text-stone-500">{sub}</div>}
    </div>
  );
}
