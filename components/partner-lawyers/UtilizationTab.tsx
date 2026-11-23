'use client';

import { useMemo } from 'react';
import { Flame, Scale, Users2, Leaf, ChevronRight } from 'lucide-react';
import {
  BUCKET_ORDER,
  BUCKET_STYLES,
  computeUtilization,
  type UtilizationBucket,
} from '@/lib/partner-lawyers/utilization';

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

const BUCKET_ICONS: Record<UtilizationBucket, typeof Flame> = {
  Overworked: Flame,
  Busy: Scale,
  Balanced: Users2,
  Free: Leaf,
};

interface Props {
  workload: LawyerWorkload[];
  onSelectLawyer: (personId: string, initials: string) => void;
}

export default function UtilizationTab({ workload, onSelectLawyer }: Props) {
  const enriched = useMemo(
    () =>
      workload.map((l) => ({
        ...l,
        utilization: computeUtilization(l.position, {
          hoursThisMonth: l.hoursThisMonth,
          pendingDeliverables: l.pendingDeliverables,
          submittedThisMonth: l.submittedThisMonth,
          totalMatters: l.totalMatters,
        }),
      })),
    [workload],
  );

  const grouped = useMemo(() => {
    const map = new Map<UtilizationBucket, typeof enriched>();
    for (const b of BUCKET_ORDER) map.set(b, []);
    for (const l of enriched) map.get(l.utilization.bucket)!.push(l);
    // Within each bucket sort by score desc (highest load first)
    for (const b of BUCKET_ORDER) {
      map.get(b)!.sort((a, b2) => b2.utilization.score - a.utilization.score);
    }
    return map;
  }, [enriched]);

  const totalCount = enriched.length;
  const avgScore = totalCount
    ? enriched.reduce((a, l) => a + l.utilization.score, 0) / totalCount
    : 0;

  return (
    <div className="space-y-6">
      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <KpiCard label="Total Lawyers" value={totalCount} tone="stone" />
        {BUCKET_ORDER.map((bucket) => (
          <KpiCard
            key={bucket}
            label={bucket}
            value={grouped.get(bucket)!.length}
            tone={bucket}
          />
        ))}
      </div>

      <div className="text-[11px] text-stone-400 dark:text-stone-500">
        Average utilization: <span className="font-semibold text-stone-600 dark:text-stone-300">{avgScore.toFixed(2)}×</span> baseline &middot;
        Score blends 50% hours + 30% deliverable activity (pending + submitted this month) + 20% matter count against per-position targets
      </div>

      {/* Groups */}
      <div className="space-y-6">
        {BUCKET_ORDER.map((bucket) => {
          const group = grouped.get(bucket)!;
          if (group.length === 0) return null;
          const Icon = BUCKET_ICONS[bucket];
          const styles = BUCKET_STYLES[bucket];
          return (
            <section key={bucket} className="space-y-3">
              <header className="flex items-center gap-2">
                <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold ${styles.pill}`}>
                  <Icon className="w-3.5 h-3.5" /> {bucket}
                </span>
                <span className="text-[11px] text-stone-400 dark:text-stone-500">{styles.description}</span>
                <span className="ml-auto text-[11px] text-stone-400 tabular-nums dark:text-stone-500">{group.length}</span>
              </header>

              <div className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-xl overflow-hidden">
                <div className="divide-y divide-stone-100 dark:divide-stone-800/50">
                  {group.map((l) => {
                    const u = l.utilization;
                    const pct = Math.min(u.score, 2) / 2 * 100; // clamp for display
                    return (
                      <button
                        type="button"
                        key={l.id}
                        onClick={() => onSelectLawyer(l.personId, l.initials)}
                        className="w-full text-left px-4 py-3 flex items-center gap-4 hover:bg-stone-50/70 dark:hover:bg-stone-800/30 transition-colors cursor-pointer"
                      >
                        <span className="inline-flex items-center justify-center w-9 h-9 rounded-full bg-navy-100 dark:bg-navy-500/15 text-navy-700 dark:text-navy-300 text-[11px] font-bold shrink-0">
                          {l.initials}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-stone-800 dark:text-stone-200 text-sm truncate">{l.name}</span>
                            <span className="text-[11px] text-stone-400 dark:text-stone-500">{l.position}</span>
                          </div>
                          <div className="mt-1.5 flex items-center gap-3">
                            <div className="flex-1 max-w-xs h-1.5 rounded-full bg-stone-100 dark:bg-stone-800 overflow-hidden">
                              <div
                                className={`h-full ${styles.bar} transition-all`}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            <span className="text-[11px] font-semibold text-stone-500 dark:text-stone-400 tabular-nums">
                              {u.score.toFixed(2)}×
                            </span>
                          </div>
                        </div>
                        <div className="hidden md:flex items-center gap-4 text-[11px] text-stone-500 dark:text-stone-400 shrink-0">
                          <Tally label="Hours" value={`${l.hoursThisMonth.toFixed(0)} / ${u.baseline.hours}`} ratio={u.hoursRatio} />
                          <Tally label="Pending" value={`${l.pendingDeliverables} / ${u.baseline.deliverables}`} ratio={u.pendingRatio} />
                          <Tally label="Submitted" value={`${l.submittedThisMonth} / ${u.baseline.submittedPerMonth}`} ratio={u.submittedRatio} />
                          <Tally label="Matters" value={`${l.totalMatters} / ${u.baseline.matters}`} ratio={u.mattersRatio} />
                        </div>
                        <ChevronRight className="w-4 h-4 text-stone-300 dark:text-stone-600 shrink-0" />
                      </button>
                    );
                  })}
                </div>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function KpiCard({ label, value, tone }: { label: string; value: number; tone: UtilizationBucket | 'stone' }) {
  const palette = tone === 'stone'
    ? { text: 'text-stone-700 dark:text-stone-200', accent: 'text-stone-400 dark:text-stone-500' }
    : { text: 'text-stone-800 dark:text-stone-100', accent: tone === 'Overworked' ? 'text-red-500 dark:text-red-400' : tone === 'Busy' ? 'text-amber-500' : tone === 'Balanced' ? 'text-emerald-500 dark:text-emerald-400' : 'text-stone-400 dark:text-stone-500' };
  return (
    <div className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-xl p-3">
      <div className={`text-[10px] uppercase tracking-wider font-semibold ${palette.accent}`}>{label}</div>
      <div className={`mt-1 font-serif text-2xl font-bold tabular-nums ${palette.text}`}>{value}</div>
    </div>
  );
}

function Tally({ label, value, ratio }: { label: string; value: string; ratio: number }) {
  const color = ratio > 1.2 ? 'text-red-500 dark:text-red-400' : ratio > 0.9 ? 'text-amber-500' : ratio > 0.5 ? 'text-emerald-500 dark:text-emerald-400' : 'text-stone-400 dark:text-stone-500';
  return (
    <div className="text-right min-w-[90px]">
      <div className="text-[10px] uppercase tracking-wider text-stone-400 font-semibold dark:text-stone-500">{label}</div>
      <div className={`text-[11px] font-semibold tabular-nums ${color}`}>{value}</div>
    </div>
  );
}
