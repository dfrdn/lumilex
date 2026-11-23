'use client';

import { useMemo } from 'react';
import { CheckCircle2, AlertCircle, Clock, XCircle } from 'lucide-react';
import { SOURCES, SOURCE_KEYS, type SourceKey } from '@/lib/issuances/sources';
import { useScrapeRuns, type ScrapeRun } from '@/hooks/use-issuances';

/**
 * Admin-only strip showing the most recent scrape run per source. Rendered
 * above the issuances list. A glance tells partners
 * which sources are healthy and which need manual intervention.
 */
export default function ScrapeRunStrip() {
  const { data: runs } = useScrapeRuns(80);

  const latestPerSource = useMemo(() => {
    const map = new Map<SourceKey, ScrapeRun>();
    for (const r of runs ?? []) {
      if (!map.has(r.source)) map.set(r.source, r);
    }
    return map;
  }, [runs]);

  return (
    <div className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-xl p-3">
      <div className="flex items-center justify-between mb-2.5">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500">
          Scraper status — last run per source
        </p>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
        {SOURCE_KEYS.map((key) => {
          const meta = SOURCES[key];
          const run = latestPerSource.get(key);
          return <SourceTile key={key} label={meta.shortLabel} run={run} />;
        })}
      </div>
    </div>
  );
}

function SourceTile({ label, run }: { label: string; run: ScrapeRun | undefined }) {
  if (!run) {
    return (
      <div className="px-2.5 py-2 rounded-lg border border-stone-200 dark:border-stone-700 bg-stone-50/40 dark:bg-stone-900/40">
        <p className="text-[11px] font-bold text-stone-500 dark:text-stone-400">{label}</p>
        <p className="text-[10px] text-stone-400 dark:text-stone-500 mt-0.5">Never run</p>
      </div>
    );
  }

  const status = run.status ?? 'running';
  const tone =
    status === 'success'
      ? 'border-emerald-200 bg-emerald-50/60 dark:bg-emerald-900/10 dark:border-emerald-800/40'
      : status === 'partial'
        ? 'border-amber-200 bg-amber-50/60 dark:bg-amber-900/10 dark:border-amber-800/40'
        : status === 'failed'
          ? 'border-rose-200 bg-rose-50/60 dark:bg-rose-900/10 dark:border-rose-800/40'
          : 'border-stone-200 bg-stone-50/60 dark:bg-stone-900/40 dark:border-stone-700';

  const Icon =
    status === 'success'
      ? CheckCircle2
      : status === 'partial'
        ? AlertCircle
        : status === 'failed'
          ? XCircle
          : Clock;
  const iconColor =
    status === 'success'
      ? 'text-emerald-500 dark:text-emerald-400'
      : status === 'partial'
        ? 'text-amber-500 dark:text-amber-400'
        : status === 'failed'
          ? 'text-rose-500 dark:text-rose-400'
          : 'text-stone-400 dark:text-stone-500';

  return (
    <div className={`px-2.5 py-2 rounded-lg border ${tone}`} title={run.error_log ?? ''}>
      <div className="flex items-center justify-between gap-1.5">
        <p className="text-[11px] font-bold text-stone-700 dark:text-stone-200">{label}</p>
        <Icon className={`w-3.5 h-3.5 shrink-0 ${iconColor}`} />
      </div>
      <p className="text-[10px] text-stone-500 dark:text-stone-400 mt-1">
        {run.items_new} new / {run.items_found} found
        {run.items_low_conf > 0 && (
          <span className="text-amber-600 dark:text-amber-400"> · {run.items_low_conf} low</span>
        )}
      </p>
      <p className="text-[10px] text-stone-400 dark:text-stone-500 mt-0.5">
        {timeAgo(run.started_at)}
      </p>
    </div>
  );
}

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const mins = Math.round((now - then) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}
