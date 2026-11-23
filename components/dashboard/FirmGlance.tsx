import Link from 'next/link';
import { ArrowRight, Building, TrendingDown, TrendingUp } from 'lucide-react';
import SectionCard from '@/components/ui/SectionCard';
import LoadError from '@/components/ui/LoadError';
import { CLEARING_WINDOW_DAYS, getFirmGlance, type FirmGlance as FirmGlanceData } from '@/lib/queries/dashboard';
import { TONE_TEXT, type PillTone } from '@/components/ui/tone';
import { manilaToday } from '@/lib/dates';
import { calendarHref } from '@/lib/calendar/views';
import { deliverablesHref } from '@/lib/deliverables/views';

interface Delta {
  text: string;
  tone: PillTone;
  /** Arrow direction; none for a plain note. */
  up?: boolean;
  title: string;
}

const hrs = (n: number) => Math.round(n).toLocaleString('en-PH');

/** Hours so far against the same days of last month. */
function hoursDelta(now: number, then: number): Delta | undefined {
  if (then <= 0) return undefined;
  const pct = Math.round(((now - then) / then) * 100);
  return {
    text: `${Math.abs(pct)}% vs last month`,
    tone: pct >= 0 ? 'emerald' : 'rose',
    up: pct >= 0,
    title: `${hrs(now)} h this month against ${hrs(then)} h by the same date last month`,
  };
}

/** Change in points against last month's whole-month average. */
function utilizationDelta(now: number, then: number): Delta | undefined {
  if (then <= 0) return undefined;
  const pts = Math.round((now - then) * 10) / 10;
  return {
    text: `${Math.abs(pts)} pts vs last month`,
    tone: pts >= 0 ? 'emerald' : 'rose',
    up: pts >= 0,
    title: `${now}% month to date against ${then}% for all of last month`,
  };
}

/** How fast late work is cleared, against how fast new work falls late. */
function clearingDelta(cleared: number, fell: number): Delta {
  return {
    text: `${cleared} cleared in ${CLEARING_WINDOW_DAYS}d`,
    tone: cleared >= fell ? 'emerald' : 'amber',
    up: cleared >= fell,
    title: `In the last ${CLEARING_WINDOW_DAYS} days ${cleared} overdue deliverables were filed or sent out, and ${fell} passed their due date undone`,
  };
}

/** Partner-only: the firm's month so far, and what it has overdue. Hearings come from the page's firm week. */
export default async function FirmGlance({ firmId, hearingsThisWeek }: { firmId: string; hearingsThisWeek: number | null }) {
  let f: FirmGlanceData;
  try {
    f = await getFirmGlance(firmId, manilaToday());
  } catch (err) {
    console.error('[dashboard] firm glance failed:', err);
    return (
      <SectionCard id="firm" title="Firm at a glance" icon={<Building className="w-5 h-5" />}>
        <LoadError />
      </SectionCard>
    );
  }

  const tiles: { key: string; href: string; label: string; value: string | number; sub: string; valueClass?: string; delta?: Delta }[] = [
    { key: 'hours', href: '/dashboard/partner#month', label: 'Firm hours this month', value: hrs(f.monthHours), sub: `${hrs(f.billedHours)} billed`, delta: hoursDelta(f.monthHours, f.lastMonthHoursToDate) },
    {
      key: 'util',
      href: '/dashboard/partner#utilization',
      label: 'Average utilization',
      value: `${f.utilization}%`,
      sub: 'month to date',
      delta: utilizationDelta(f.utilization, f.lastMonthUtilization),
    },
    {
      key: 'overdue',
      href: deliverablesHref('all', { card: 'overdue' }),
      label: 'Overdue deliverables',
      value: f.overdueDeliverables.toLocaleString('en-PH'),
      sub: `${f.newlyOverdue} fell overdue in ${CLEARING_WINDOW_DAYS}d`,
      valueClass: f.overdueDeliverables > 0 ? 'text-rose-700 dark:text-rose-300' : undefined,
      delta: clearingDelta(f.overdueCleared, f.newlyOverdue),
    },
    {
      key: 'hearings',
      href: calendarHref('hearings', { card: 'upcoming' }),
      label: 'Hearings this week',
      value: hearingsThisWeek ?? '—',
      sub: 'across the firm',
      delta: { text: `${f.hearingsNextWeek} next week`, tone: 'neutral', title: `${f.hearingsNextWeek} hearings set for next week across the firm` },
    },
  ];

  return (
    <SectionCard
      id="firm"
      title="Firm at a glance"
      icon={<Building className="w-5 h-5" />}
      actions={
        <Link href="/dashboard/partner" className="inline-flex items-center gap-1 max-sm:min-h-9 text-xs font-medium text-navy-700 hover:text-navy-900 dark:text-navy-200 dark:hover:text-navy-100">
          Partner overview <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      }
    >
      {/* Two by two in the side rail; one row when the card spans the page. */}
      <div className="@container">
        <div className="grid grid-cols-2 @xl:grid-cols-4 gap-2.5">
          {tiles.map((t) => (
            <Link
              key={t.key}
              href={t.href}
              className="block rounded-xl bg-stone-50 dark:bg-white/[0.03] px-3.5 py-3 transition-colors hover:bg-stone-100 dark:hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy-200 dark:focus-visible:ring-navy-500/30"
            >
              <div className="text-xs text-[var(--text-secondary)]">{t.label}</div>
              <div className={`mt-1 font-serif text-2xl tabular-nums ${t.valueClass ?? 'text-foreground'}`}>{t.value}</div>
              {t.delta && (
                <div title={t.delta.title} className={`mt-0.5 inline-flex items-center gap-1 text-[11px] font-medium tabular-nums ${TONE_TEXT[t.delta.tone]}`}>
                  {t.delta.up === true && <TrendingUp className="w-3 h-3" />}
                  {t.delta.up === false && <TrendingDown className="w-3 h-3" />}
                  {t.delta.text}
                </div>
              )}
              <div className="text-[11px] text-[var(--text-muted)]">{t.sub}</div>
            </Link>
          ))}
        </div>
      </div>
    </SectionCard>
  );
}
