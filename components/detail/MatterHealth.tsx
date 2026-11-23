'use client';

import useSWR from 'swr';
import { Activity, AlertCircle, AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';

interface HealthSignals {
  overdueDeliverableCount?: number;
  pendingDeliverableCount?: number;
  daysSinceActivity?: number | null;
  upcomingDeadlineCount?: number;
  missedHearingCount?: number;
  matterAgeDays?: number;
  overdueDeliverableSamples?: { name: string; type: string | null; dueDate: string | null; daysOverdue: number }[];
}

interface HealthRow {
  matter_id: string;
  score: number | null;
  tier: 'green' | 'yellow' | 'red' | null;
  signals: HealthSignals | null;
  narrative: string | null;
  generated_at: string | null;
  needs_refresh: boolean;
}

interface ApiResponse {
  health: HealthRow | null;
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());

const TIER_STYLES = {
  green: {
    pill: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
    ring: 'border-emerald-200/60 dark:border-emerald-800/40',
    icon: CheckCircle2,
    label: 'Healthy',
  },
  yellow: {
    pill: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    ring: 'border-amber-200/60 dark:border-amber-800/40',
    icon: AlertTriangle,
    label: 'Needs attention',
  },
  red: {
    pill: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    ring: 'border-red-200/60 dark:border-red-800/40',
    icon: AlertCircle,
    label: 'At risk',
  },
} as const;

function formatGeneratedAt(iso: string | null): string {
  if (!iso) return 'never';
  const diff = Date.now() - new Date(iso).getTime();
  const hours = Math.floor(diff / 3_600_000);
  if (hours < 1) return 'just now';
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function MatterHealth({ matterId }: { matterId: string }) {
  const { data, isLoading, error } = useSWR<ApiResponse>(
    `/api/matter-health/${matterId}`,
    fetcher,
  );

  if (isLoading) {
    return (
      <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] p-4 mb-6">
        <div className="flex items-center gap-2 text-stone-400 dark:text-stone-500">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-xs">Loading matter health…</span>
        </div>
      </div>
    );
  }
  if (error) return null;

  const health = data?.health;
  if (!health || health.tier == null) {
    // No row yet — cron hasn't reached this matter. Hide the card silently;
    // a flagged "needs_refresh" row will appear once generated.
    return null;
  }

  const tier = health.tier;
  const style = TIER_STYLES[tier];
  const Icon = style.icon;
  const signals = health.signals ?? {};

  return (
    <div className={`bg-[var(--card-bg)] rounded-xl border ${style.ring} shadow-[var(--shadow-card)] overflow-hidden mb-6 animate-fade-up`}>
      <div className="px-5 py-3 flex items-center justify-between border-b border-[var(--border-color)]">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-stone-400 dark:text-stone-500" />
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">
            Matter Risk
          </h2>
          {health.needs_refresh && (
            <span className="text-[10px] uppercase tracking-wider text-stone-400 dark:text-stone-500" title="A refresh is queued; the next cron tick will regenerate this.">
              · refreshing
            </span>
          )}
        </div>
        <span className="text-[10px] text-stone-400 dark:text-stone-500">
          updated {formatGeneratedAt(health.generated_at)}
        </span>
      </div>

      <div className="p-5 space-y-4">
        {/* Header row: tier pill + score */}
        <div className="flex items-center gap-3">
          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold ${style.pill}`}>
            <Icon className="w-3.5 h-3.5" />
            {style.label}
          </span>
          <span className="font-serif text-3xl font-bold tabular-nums text-stone-800 dark:text-stone-100">
            {health.score ?? '—'}
          </span>
          <span className="text-[11px] text-stone-400 dark:text-stone-500">/ 100</span>
        </div>

        {/* Narrative */}
        {health.narrative && (
          <p className="text-sm text-stone-700 dark:text-stone-300 leading-relaxed">
            {health.narrative}
          </p>
        )}

        {/* Signal chips */}
        <div className="flex flex-wrap gap-2 text-[11px]">
          {signals.overdueDeliverableCount ? (
            <SignalChip
              tone="red"
              label="Overdue"
              value={String(signals.overdueDeliverableCount)}
            />
          ) : null}
          {signals.daysSinceActivity != null && signals.daysSinceActivity > 7 ? (
            <SignalChip
              tone="amber"
              label="Idle"
              value={`${signals.daysSinceActivity}d`}
            />
          ) : null}
          {signals.upcomingDeadlineCount ? (
            <SignalChip
              tone="navy"
              label="Upcoming (14d)"
              value={String(signals.upcomingDeadlineCount)}
            />
          ) : null}
          {signals.missedHearingCount ? (
            <SignalChip
              tone="red"
              label="Missed hearings (90d)"
              value={String(signals.missedHearingCount)}
            />
          ) : null}
          {signals.pendingDeliverableCount ? (
            <SignalChip
              tone="stone"
              label="Pending"
              value={String(signals.pendingDeliverableCount)}
            />
          ) : null}
        </div>

        {/* Overdue samples */}
        {signals.overdueDeliverableSamples && signals.overdueDeliverableSamples.length > 0 && (
          <div className="border-t border-stone-100 dark:border-stone-800/50 pt-3">
            <div className="text-[10px] uppercase tracking-wider font-semibold text-stone-400 dark:text-stone-500 mb-1.5">
              Most overdue
            </div>
            <ul className="space-y-1">
              {signals.overdueDeliverableSamples.slice(0, 3).map((d, i) => (
                <li key={i} className="flex items-baseline justify-between gap-2 text-xs">
                  <span className="truncate text-stone-700 dark:text-stone-300">
                    {d.name}
                    {d.type && <span className="text-stone-400 dark:text-stone-500"> · {d.type}</span>}
                  </span>
                  <span className="shrink-0 text-red-600 dark:text-red-400 font-semibold tabular-nums">
                    {d.daysOverdue}d
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

function SignalChip({ tone, label, value }: { tone: 'red' | 'amber' | 'navy' | 'stone'; label: string; value: string }) {
  const styles: Record<typeof tone, string> = {
    red: 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 ring-red-200/50 dark:ring-red-800/30',
    amber: 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 ring-amber-200/50 dark:ring-amber-800/30',
    navy: 'bg-navy-50 dark:bg-navy-900/20 text-navy-700 dark:text-navy-400 ring-navy-200/50 dark:ring-navy-800/30',
    stone: 'bg-stone-100 dark:bg-stone-800/50 text-stone-600 dark:text-stone-400 ring-stone-200/50 dark:ring-stone-700/30',
  };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md font-medium ring-1 ring-inset ${styles[tone]}`}>
      <span className="text-[10px] uppercase tracking-wider opacity-70">{label}</span>
      <span className="tabular-nums">{value}</span>
    </span>
  );
}
