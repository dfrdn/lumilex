'use client';

import { ArrowUpRight } from 'lucide-react';
import type { Health } from '@/lib/corporations/status';
import { HEALTH_STYLE } from './tone';

export interface TrackCard {
  key: string;
  label: string;
  icon: React.ReactNode;
  health: Health;
  /** Items finished, of those the firm carries. No bar when `total` is 0. */
  done: number;
  total: number;
  summary: string;
  /** The footer line — what to do next. */
  next?: string;
  waitingOnClient?: boolean;
  /** Overrides the derived state label ("Window opens 2027"). */
  stateLabel?: string;
}

/**
 * A subject's tracks of work: what state each is in, how far along it is, and
 * what to do next. Each opens the place that work lives.
 */
export default function TrackCards({
  cards,
  activeKey,
  onOpen,
}: {
  cards: TrackCard[];
  activeKey?: string | null;
  onOpen?: (key: string) => void;
}) {
  if (!cards.length) return null;
  const cols = cards.length === 1 ? 'grid-cols-1' : cards.length === 2 ? 'grid-cols-2' : 'grid-cols-2 lg:grid-cols-3';
  return (
    <div className={`grid ${cols} gap-2 sm:gap-3`}>
      {cards.map((t, i) => {
        const h = HEALTH_STYLE[t.health];
        const pct = t.total ? Math.round((t.done / t.total) * 100) : 0;
        const active = activeKey === t.key;
        // Green means nothing is late. With work still open that is "in
        // progress", not "on track" — a checklist at 2 of 13 isn't done.
        const inProgress = t.health === 'green' && t.done < t.total;
        const label =
          t.stateLabel ??
          (t.waitingOnClient && t.health !== 'red' ? 'Waiting on client' : inProgress ? 'In progress' : t.health === 'green' ? 'Complete' : h.label);
        const Tag = onOpen ? 'button' : 'div';
        return (
          <Tag
            key={t.key}
            {...(onOpen ? { type: 'button' as const, onClick: () => onOpen(t.key) } : {})}
            style={{ '--i': i } as React.CSSProperties}
            className={`rise-in ${onOpen ? 'press hover:-translate-y-px hover:shadow-[0_6px_20px_-12px_rgba(0,0,0,0.25)]' : ''} group relative overflow-hidden text-left rounded-2xl border bg-gradient-to-br ${h.tint} to-transparent bg-white dark:bg-card px-3 py-3 sm:px-4 sm:py-3.5 transition-all ${
              active
                ? 'border-navy-300 ring-1 ring-navy-200 dark:border-navy-400/40 dark:ring-navy-400/20'
                : 'border-stone-200 dark:border-white/10'
            }`}
          >
            <div className="flex items-center gap-2">
              <span className="hidden sm:inline-flex items-center justify-center w-7 h-7 rounded-lg bg-stone-100 text-stone-600 dark:bg-white/10 dark:text-stone-300">
                {t.icon}
              </span>
              <span className="text-[13px] font-semibold text-stone-800 dark:text-stone-100">{t.label}</span>
              <span className={`ml-auto inline-flex items-center gap-1.5 text-[11px] font-medium min-w-0 ${inProgress ? 'text-navy-700 dark:text-navy-300' : h.text}`}>
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${inProgress ? 'bg-navy-500 dark:bg-navy-300' : h.dot}`} />
                <span className="hidden sm:inline truncate">{label}</span>
              </span>
            </div>

            <p className="mt-2 sm:mt-3 text-[13px] sm:text-sm font-medium text-stone-800 dark:text-stone-100 line-clamp-1" title={t.summary}>
              {t.summary}
            </p>

            {t.total > 0 ? (
              <div className="mt-2.5 flex items-center gap-2">
                <div className="flex-1 h-1.5 rounded-full bg-stone-100 dark:bg-white/10 overflow-hidden">
                  <div className={`grow-x h-full rounded-full ${inProgress ? 'bg-navy-500 dark:bg-navy-300' : h.bar}`} style={{ width: `${pct}%`, '--i': i } as React.CSSProperties} />
                </div>
                <span className="text-[11px] tabular-nums text-stone-500 dark:text-stone-400">
                  {t.done}/{t.total}
                </span>
              </div>
            ) : (
              <div className="mt-2.5 h-1.5" />
            )}

            <div className="hidden sm:flex mt-2.5 items-center justify-between gap-2 text-[11px] text-stone-500 dark:text-stone-400 min-h-[16px]">
              <span className="truncate">{t.next ?? ''}</span>
              {onOpen && <ArrowUpRight className="w-3.5 h-3.5 shrink-0 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all" />}
            </div>
          </Tag>
        );
      })}
    </div>
  );
}
