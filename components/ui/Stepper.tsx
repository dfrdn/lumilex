'use client';

import { Check } from 'lucide-react';

export interface Step {
  key: string;
  label: string;
  sub: string;
  state: 'done' | 'current' | 'upcoming' | 'skipped';
  /** Colour the sub-line as a warning ("2 overdue"). */
  warn?: boolean;
  onOpen?: () => void;
}

/**
 * A subject's life in phases, with where it is now. Finished phases tick
 * off; a step that has somewhere to go opens it.
 */
export default function Stepper({ steps }: { steps: Step[] }) {
  return (
    <ol className="flex items-stretch rounded-2xl border border-stone-200 dark:border-white/10 bg-white dark:bg-card px-2 sm:px-4 py-3 overflow-x-auto scrollbar-hide">
      {steps.map((s, i) => {
        const inner = (
          <>
            <span
              className={`shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-semibold transition-colors ${
                s.state === 'done'
                  ? 'bg-emerald-500 text-white'
                  : s.state === 'current'
                    ? 'bg-navy-700 text-white ring-4 ring-navy-100 dark:bg-navy-600 dark:text-white dark:ring-navy-500/20'
                    : s.state === 'skipped'
                      ? 'bg-stone-100 text-stone-400 dark:bg-white/10 dark:text-stone-500'
                      : 'border border-stone-300 text-stone-400 dark:border-white/20 dark:text-stone-500'
              }`}
            >
              {s.state === 'done' ? <Check className="w-3.5 h-3.5" strokeWidth={3} /> : i + 1}
            </span>
            <span className="min-w-0">
              <span
                className={`block text-[13px] font-medium truncate ${
                  s.state === 'current'
                    ? 'text-stone-900 dark:text-stone-50'
                    : s.state === 'done'
                      ? 'text-stone-700 dark:text-stone-200'
                      : 'text-stone-400 dark:text-stone-500'
                }`}
              >
                {s.label}
              </span>
              <span className={`block text-[11px] truncate ${s.warn ? 'text-rose-600 dark:text-rose-400' : 'text-stone-500 dark:text-stone-400'}`}>
                {s.sub}
              </span>
            </span>
          </>
        );
        const cls = 'group flex items-center gap-2.5 min-w-0 px-2 py-1 rounded-xl text-left';
        return (
          <li key={s.key} className="flex items-center min-w-0 flex-1">
            {s.onOpen ? (
              <button type="button" onClick={s.onOpen} className={`${cls} hover:bg-stone-50 dark:hover:bg-white/5 transition-colors`}>
                {inner}
              </button>
            ) : (
              <div className={cls}>{inner}</div>
            )}
            {i < steps.length - 1 && (
              <span
                className={`hidden sm:block flex-1 h-px mx-2 min-w-[24px] transition-colors ${
                  s.state === 'done' || s.state === 'skipped' ? 'bg-emerald-300 dark:bg-emerald-500/40' : 'bg-stone-200 dark:bg-white/10'
                }`}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}
