import Link from 'next/link';
import { ArrowRight, Clock } from 'lucide-react';
import SectionCard from '@/components/ui/SectionCard';
import LoadError from '@/components/ui/LoadError';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { getMyTime, type MyTime as MyTimeData } from '@/lib/queries/dashboard';
import { formatManila, manilaToday, weekRange } from '@/lib/dates';

const hrs = (n: number) => Number(n.toFixed(1)).toString();
const dayLabel = (d: string, opts: Intl.DateTimeFormatOptions) => formatManila(`${d}T00:00:00+08:00`, opts);

/** Hours logged this week, by day, and this month — with no target, and the past weekdays with nothing logged. */
export default async function MyTime({ userId, userName }: { userId: string; userName: string | null }) {
  const today = manilaToday();
  let t: MyTimeData;
  try {
    t = await getMyTime(userId, userName, weekRange(), today, await getSupabaseServerAuthClient());
  } catch (err) {
    console.error(`[dashboard] my time failed for ${userId}:`, err);
    return (
      <SectionCard id="time" title="My time" icon={<Clock className="w-5 h-5" />}>
        <LoadError />
      </SectionCard>
    );
  }

  const peak = Math.max(8, ...t.weekDays.map((d) => t.hoursByDay[d] ?? 0));
  const month = dayLabel(today, { month: 'long' });

  return (
    <SectionCard
      id="time"
      title="My time"
      icon={<Clock className="w-5 h-5" />}
      actions={
        <span className="text-xs text-[var(--text-secondary)] tabular-nums">
          This week {hrs(t.weekTotal)} h · {month} {hrs(t.monthTotal)} h
        </span>
      }
    >
      <div className="grid grid-cols-5 gap-2 items-end h-24 px-1" role="img" aria-label="Hours logged each weekday this week">
        {t.weekDays.map((d) => {
          const h = t.hoursByDay[d] ?? 0;
          const missing = t.missing.includes(d);
          return (
            <div key={d} className="flex flex-col items-center justify-end h-full">
              <span className={`text-[11px] tabular-nums mb-1 ${missing ? 'text-amber-700 dark:text-amber-300' : 'text-[var(--text-secondary)]'}`}>
                {h > 0 ? hrs(h) : missing ? '—' : ''}
              </span>
              <div
                className={`w-3/5 rounded-t-md ${d === today ? 'bg-navy-500 dark:bg-navy-300' : 'bg-navy-300/80 dark:bg-navy-500/70'}`}
                style={{ height: `${(h / peak) * 64}px` }}
              />
              <div className={`w-3/5 border-t ${missing ? 'border-dashed border-amber-400' : 'border-stone-200 dark:border-white/10'}`} />
            </div>
          );
        })}
      </div>
      <div className="grid grid-cols-5 gap-2 mt-1 px-1 text-center text-[11px] text-[var(--text-secondary)]">
        {t.weekDays.map((d) => (
          <span key={d} className={d === today ? 'font-semibold text-foreground' : ''}>{dayLabel(d, { weekday: 'short' })}</span>
        ))}
      </div>
      {t.missing.length > 0 && (
        <Link
          href="/dashboard/my-dtr"
          className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 hover:border-amber-300 dark:hover:border-amber-500/50 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-300"
        >
          <span>
            No time logged for{' '}
            {t.missing.map((d) => dayLabel(d, { weekday: 'long', month: 'short', day: 'numeric' })).join(', ')}
          </span>
          <span className="inline-flex items-center gap-1 shrink-0 font-medium">
            Open My DTR <ArrowRight className="w-3.5 h-3.5" />
          </span>
        </Link>
      )}
    </SectionCard>
  );
}
