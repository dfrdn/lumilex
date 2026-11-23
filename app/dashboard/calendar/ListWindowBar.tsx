'use client';

import { useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import DatePickerInput from '@/components/DatePickerInput';
import TabLabel from '@/components/ui/TabLabel';
import {
  WINDOW_PRESETS,
  calendarHref,
  datesQuery,
  windowQuery,
  type ListTab,
  type ListWindow,
} from '@/lib/calendar/views';

const GROUP = 'inline-flex p-0.5 rounded-lg bg-stone-100 dark:bg-white/[0.06] text-xs';
const SEGMENT = 'press shrink-0 px-3 py-1 rounded-md transition-all whitespace-nowrap';
const SEGMENT_ON = 'bg-white dark:bg-card shadow-sm text-stone-900 dark:text-stone-50 font-medium';
const SEGMENT_OFF = 'text-stone-500 dark:text-stone-400 hover:text-stone-800 dark:hover:text-stone-100';

/**
 * The days a list reads: a preset, or From / To set by hand. Each choice is a
 * URL, so the server reads only that window.
 */
export default function ListWindowBar({ tab, win: w }: { tab: ListTab; win: ListWindow }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const setDays = (from: string | null, to: string | null) => {
    const href = calendarHref(tab, datesQuery(from, to));
    startTransition(() => router.push(href, { scroll: false }));
  };

  return (
    <div className="mb-4 flex flex-wrap items-center gap-3">
      <nav className={GROUP} aria-label="Dates shown">
        {WINDOW_PRESETS.map((p) => (
          <Link
            key={p.key}
            href={calendarHref(tab, windowQuery({ preset: p.key, from: null, to: null }))}
            scroll={false}
            aria-current={w.preset === p.key ? 'page' : undefined}
            className={`${SEGMENT} ${w.preset === p.key ? SEGMENT_ON : SEGMENT_OFF}`}
          >
            <TabLabel label={p.label} />
          </Link>
        ))}
      </nav>
      <div className="flex items-center gap-2 text-xs text-stone-500 dark:text-stone-400">
        <span>From</span>
        <DatePickerInput value={w.from} onChange={(v) => setDays(v, w.to)} placeholder="Any date" variant="filter" className="w-36" />
        <span>to</span>
        <DatePickerInput value={w.to} onChange={(v) => setDays(w.from, v)} placeholder="Any date" variant="filter" className="w-36" />
        {pending && <Loader2 className="w-3.5 h-3.5 animate-spin text-stone-400 dark:text-stone-500" aria-hidden />}
      </div>
    </div>
  );
}
