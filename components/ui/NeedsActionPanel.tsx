'use client';

import { useState } from 'react';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { CARD } from './tone';

const COLLAPSED_COUNT = 5;

/**
 * What needs doing now across the book, above a list — each row carrying the
 * one action that clears it, so the urgent work can be done without opening
 * each record. Rows are the caller's; this is the frame they sit in.
 */
export default function NeedsActionPanel<T>({
  entries,
  overdue,
  withinDays,
  waiting = 0,
  waitingLabel = 'waiting',
  rowKey,
  renderRow,
}: {
  entries: T[];
  overdue: number;
  withinDays: number;
  /** Entries shown for another reason than falling due soon, counted apart. */
  waiting?: number;
  waitingLabel?: string;
  rowKey: (entry: T) => string;
  renderRow: (entry: T) => React.ReactNode;
}) {
  const [showAll, setShowAll] = useState(false);

  if (entries.length === 0) {
    return (
      <div className={`${CARD} flex items-center gap-2 px-4 py-2.5 text-sm text-stone-600 dark:text-stone-300`}>
        <CheckCircle2 className="pop w-4 h-4 text-emerald-500 shrink-0" />
        Nothing due in the next {withinDays} days.
      </div>
    );
  }

  const visible = showAll ? entries : entries.slice(0, COLLAPSED_COUNT);
  const soon = entries.length - overdue - waiting;

  return (
    <section className={`${CARD} overflow-hidden`}>
      <header
        className={`px-5 py-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-stone-100 dark:border-white/[0.06] ${
          overdue ? 'bg-rose-50/60 dark:bg-rose-500/[0.06]' : ''
        }`}
      >
        <AlertTriangle className={`w-4 h-4 shrink-0 ${overdue ? 'text-rose-500' : 'text-amber-500'}`} />
        <h2 className="font-serif text-base text-stone-900 dark:text-stone-50">Needs action</h2>
        <span className="text-[11px] text-stone-500 dark:text-stone-400">
          {overdue > 0 && <span className="text-rose-600 dark:text-rose-400 font-medium">{overdue} overdue</span>}
          {overdue > 0 && soon > 0 && ' · '}
          {soon > 0 && `${soon} due within ${withinDays} days`}
          {(overdue > 0 || soon > 0) && waiting > 0 && ' · '}
          {waiting > 0 && `${waiting} ${waitingLabel}`}
        </span>
      </header>
      <ul className="divide-y divide-stone-100 dark:divide-white/[0.06]">
        {visible.map((e, i) => (
          <li
            key={rowKey(e)}
            style={{ '--i': Math.min(i, 8) } as React.CSSProperties}
            className="rise-in px-5 py-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 hover:bg-stone-50/70 dark:hover:bg-white/[0.02] transition-colors"
          >
            {renderRow(e)}
          </li>
        ))}
      </ul>
      {entries.length > COLLAPSED_COUNT && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="w-full px-5 py-2 text-xs font-medium text-navy-700 dark:text-navy-300 hover:bg-stone-50 dark:hover:bg-white/5 border-t border-stone-100 dark:border-white/[0.06] cursor-pointer transition-colors"
        >
          {showAll ? 'Show fewer' : `Show all ${entries.length}`}
        </button>
      )}
    </section>
  );
}
