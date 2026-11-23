'use client';

import { useMemo, useState } from 'react';
import DeadlineRow from '@/components/dashboard/DeadlineRow';
import { addDays, formatManila, manilaDayOfWeek } from '@/lib/dates';
import { PILL_TONE, type PillTone } from '@/components/ui/tone';
import type { LoadItem } from '@/lib/queries/dashboard';

const KIND: Record<LoadItem['kind'], { label: string; tone: PillTone }> = {
  deliverable: { label: 'Deliverable', tone: 'navy' },
  hearing: { label: 'Hearing', tone: 'rose' },
  case: { label: 'Case', tone: 'violet' },
  company: { label: 'Company', tone: 'teal' },
  mark: { label: 'Mark', tone: 'sky' },
};

function barTone(n: number): string {
  if (n >= 4) return 'bg-rose-200 text-rose-800 dark:bg-rose-500/35 dark:text-rose-100';
  if (n >= 2) return 'bg-amber-200 text-amber-900 dark:bg-amber-500/35 dark:text-amber-100';
  if (n === 1) return 'bg-stone-200 text-stone-700 dark:bg-white/15 dark:text-stone-200';
  return 'bg-stone-100 dark:bg-white/[0.05]';
}

/** One bar per day for the next two weeks; a day opens to what falls on it. */
export default function LoadStrip({ items, today, days }: { items: LoadItem[]; today: string; days: number }) {
  const [selected, setSelected] = useState<string | null>(null);
  const byDay = useMemo(() => {
    const m = new Map<string, LoadItem[]>();
    for (const i of items) m.set(i.date, [...(m.get(i.date) ?? []), i]);
    return m;
  }, [items]);
  const dates = Array.from({ length: days }, (_, n) => addDays(today, n));
  const peak = Math.max(4, ...dates.map((d) => byDay.get(d)?.length ?? 0));
  const picked = selected ? byDay.get(selected) ?? [] : [];

  return (
    <div>
      <div className="flex items-end gap-1 h-20 px-1" role="group" aria-label="Deadlines and hearings per day, next two weeks">
        {dates.map((d) => {
          const n = byDay.get(d)?.length ?? 0;
          const dow = manilaDayOfWeek(d);
          const weekend = dow === 0 || dow === 6;
          const isSel = selected === d;
          return (
            <button
              key={d}
              type="button"
              onClick={() => setSelected(isSel ? null : d)}
              aria-pressed={isSel}
              aria-label={`${formatManila(`${d}T00:00:00+08:00`, { weekday: 'long', month: 'short', day: 'numeric' })}: ${n} ${n === 1 ? 'item' : 'items'}`}
              className={`flex h-full flex-col items-center justify-end gap-1 cursor-pointer ${weekend ? 'flex-[0.6]' : 'flex-1'}`}
            >
              <span
                className={`flex w-full items-end justify-center rounded-md text-[10px] font-semibold tabular-nums transition-all ${barTone(n)} ${
                  isSel ? 'ring-2 ring-navy-400 ring-offset-1 ring-offset-white dark:ring-offset-transparent' : ''
                }`}
                style={{ height: `${Math.max(6, (n / peak) * 52)}px` }}
              >
                {n > 0 ? n : ''}
              </span>
              <span className={`text-[10px] leading-none ${d === today ? 'font-semibold text-foreground' : 'text-[var(--text-muted)]'}`}>
                {formatManila(`${d}T00:00:00+08:00`, { weekday: 'narrow' })}
              </span>
            </button>
          );
        })}
      </div>
      {selected ? (
        <div className="mt-3 border-t border-stone-100 dark:border-white/[0.06] pt-2">
          <p className="px-1 pb-1 text-xs font-medium text-[var(--text-secondary)]">
            {formatManila(`${selected}T00:00:00+08:00`, { weekday: 'long', month: 'short', day: 'numeric' })}
          </p>
          {picked.length === 0 ? (
            <p className="px-1 py-1 text-sm text-[var(--text-secondary)]">Nothing due.</p>
          ) : (
            <ul className="divide-y divide-stone-100 dark:divide-white/[0.06]">
              {picked.map((i) => (
                <li key={i.key}>
                  <DeadlineRow href={i.href} pane={i.pane}>
                    <span className="flex-1 min-w-0 max-sm:basis-full">
                      <span className="block sm:truncate max-sm:break-words text-sm font-medium text-foreground">{i.label}</span>
                      {i.context && <span className="block truncate text-xs text-[var(--text-secondary)]">{i.context}</span>}
                    </span>
                    <span className={`shrink-0 rounded-full border px-2 py-px text-[11px] font-medium ${PILL_TONE[KIND[i.kind].tone]}`}>{KIND[i.kind].label}</span>
                  </DeadlineRow>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <p className="mt-2 px-1 text-xs text-[var(--text-muted)]">Your deliverables, hearings and deadlines. Pick a day to see it.</p>
      )}
    </div>
  );
}
