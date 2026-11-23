import { Check } from 'lucide-react';
import type { StageStep } from '@/lib/cases/stages';

/**
 * A proceeding's stages as dots on one line, every label in full beneath —
 * a trial has seven or eight, more than the subject Stepper's side-by-side
 * labels can hold. The current stage carries what's next.
 */
export default function StageTrack({
  steps,
  currentNote,
  onPick,
}: {
  steps: StageStep[];
  currentNote?: string | null;
  /** Given, each stage is a button that moves the proceeding there. */
  onPick?: (key: string, label: string) => void;
}) {
  return (
    <ol className="rounded-2xl border border-stone-200 dark:border-white/10 bg-white dark:bg-card px-3 sm:px-5 pt-4 pb-3 grid gap-x-1 overflow-x-auto scrollbar-hide" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(4.5rem, 1fr))` }}>
      {steps.map((s, i) => {
        const done = s.state === 'done';
        const current = s.state === 'current';
        return (
          <li key={s.key} className="relative min-w-0">
            <Tag s={s} onPick={onPick}>
            {i > 0 && (
              <span
                aria-hidden
                className={`absolute top-3 right-1/2 w-full h-px -translate-y-1/2 ${
                  done || current || s.state === 'skipped' ? 'bg-emerald-300 dark:bg-emerald-500/40' : 'bg-stone-200 dark:bg-white/10'
                }`}
              />
            )}
            <span
              className={`relative z-10 w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-semibold ${
                done
                  ? 'bg-emerald-500 text-white'
                  : current
                    ? 'bg-navy-700 text-white ring-4 ring-navy-100 dark:bg-navy-600 dark:text-white dark:ring-navy-500/20'
                    : s.state === 'skipped'
                      ? 'bg-stone-100 text-stone-400 dark:bg-white/10 dark:text-stone-500'
                      : 'bg-white dark:bg-card border border-stone-300 text-stone-400 dark:border-white/20 dark:text-stone-500'
              }`}
              title={s.state === 'skipped' ? 'Skipped' : undefined}
            >
              {done ? <Check className="w-3.5 h-3.5" strokeWidth={3} /> : i + 1}
            </span>
            <span
              className={`mt-1.5 text-[11.5px] leading-tight px-0.5 ${
                current
                  ? 'font-semibold text-stone-900 dark:text-stone-50'
                  : done
                    ? 'text-stone-600 dark:text-stone-300'
                    : s.state === 'skipped'
                      ? 'text-stone-400 dark:text-stone-500 line-through decoration-stone-300 dark:decoration-stone-600'
                      : 'text-stone-400 dark:text-stone-500'
              }`}
            >
              {s.label}
            </span>
            {current && currentNote && <span className="mt-0.5 text-[10.5px] leading-tight text-navy-700 dark:text-navy-300">{currentNote}</span>}
            </Tag>
          </li>
        );
      })}
    </ol>
  );
}

function Tag({ s, onPick, children }: { s: StageStep; onPick?: (key: string, label: string) => void; children: React.ReactNode }) {
  const cls = 'w-full flex flex-col items-center text-center rounded-lg pb-1';
  if (!onPick || s.state === 'current') return <div className={cls}>{children}</div>;
  return (
    <button type="button" onClick={() => onPick(s.key, s.label)} title={`Move to ${s.label}`} className={`${cls} hover:bg-stone-50 dark:hover:bg-white/5 transition-colors`}>
      {children}
    </button>
  );
}

