import Link from 'next/link';
import { Hourglass } from 'lucide-react';
import SectionCard from '@/components/ui/SectionCard';
import LoadError from '@/components/ui/LoadError';
import DeadlineRow from '@/components/dashboard/DeadlineRow';
import { DEADLINE_DAYS, getMyDeadlinesOnce, type MyDeadlines, type UpcomingDeadline } from '@/lib/queries/dashboard';
import { dayCountdown, formatManila, manilaToday } from '@/lib/dates';
import { PILL_TONE, type PillTone } from '@/components/ui/tone';

const KIND: Record<UpcomingDeadline['kind'], { label: string; tone: PillTone }> = {
  case: { label: 'Case', tone: 'violet' },
  company: { label: 'Company', tone: 'teal' },
  mark: { label: 'Mark', tone: 'sky' },
};

const SHOWN = 5;

function Rows({ rows, today, overdue = false }: { rows: UpcomingDeadline[]; today: string; overdue?: boolean }) {
  return (
    <ul className="divide-y divide-stone-100 dark:divide-white/[0.06]">
      {rows.slice(0, SHOWN).map((d) => {
        const c = dayCountdown(d.date, today);
        return (
          <li key={d.key}>
            <DeadlineRow href={d.href} pane={d.pane}>
              <span className="flex-1 min-w-0 max-sm:basis-full">
                <span className="block sm:truncate max-sm:break-words text-sm font-medium text-foreground group-hover:text-navy-800 dark:group-hover:text-navy-200">{d.label}</span>
                {d.context && <span className="block truncate text-xs text-[var(--text-secondary)]">{d.context}</span>}
              </span>
              <span className={`shrink-0 rounded-full border px-2 py-px text-[11px] font-medium ${PILL_TONE[KIND[d.kind].tone]}`}>{KIND[d.kind].label}</span>
              <span
                title={formatManila(`${d.date}T00:00:00+08:00`, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
                className={`w-[5.5rem] max-sm:w-auto max-sm:ml-auto shrink-0 text-right text-xs tabular-nums ${
                  c.tone === 'late' ? 'text-red-600 dark:text-red-400' : c.tone === 'today' || c.tone === 'soon' ? 'text-amber-700 dark:text-amber-300' : 'text-[var(--text-secondary)]'
                }`}
              >
                {/* A hearing isn't late, it's unrecorded: say how long ago it was. */}
                {overdue && d.pane?.entity === 'hearings' && c.tone === 'late' ? `${c.label.replace(' late', '')} ago` : c.label}
              </span>
            </DeadlineRow>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Deadlines on the person's cases, companies and marks that My deliverables
 * doesn't already list: what is past and still open, then the next fortnight.
 */
export default async function Deadlines({ userId, withMe }: { userId: string; withMe: string }) {
  const today = manilaToday();
  let d: MyDeadlines;
  try {
    d = await getMyDeadlinesOnce(userId, today, withMe);
  } catch (err) {
    console.error(`[dashboard] deadlines failed for ${userId}:`, err);
    return (
      <SectionCard id="deadlines" title="Deadlines" icon={<Hourglass className="w-5 h-5" />}>
        <LoadError />
      </SectionCard>
    );
  }

  const hidden = Math.max(0, d.overdue.length - SHOWN) + Math.max(0, d.upcoming.length - SHOWN);
  return (
    <SectionCard
      id="deadlines"
      title="Deadlines"
      icon={<Hourglass className="w-5 h-5" />}
      count={d.overdue.length + d.upcoming.length}
      className={d.overdue.length > 0 ? 'border-rose-200 dark:border-rose-500/25' : ''}
    >
      <div className="space-y-4">
        {d.overdue.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-1 px-1">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-red-600 dark:text-red-400">Overdue</span>
              <span className="text-[11px] font-mono text-[var(--text-muted)] tabular-nums">{d.overdue.length}</span>
            </div>
            <Rows rows={d.overdue} today={today} overdue />
          </div>
        )}
        <div>
          <div className="flex items-center gap-2 mb-1 px-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">Next {DEADLINE_DAYS} days</span>
            <span className="text-[11px] font-mono text-[var(--text-muted)] tabular-nums">{d.upcoming.length}</span>
          </div>
          {d.upcoming.length === 0 ? (
            <p className="py-1.5 px-1 text-sm text-[var(--text-secondary)]">Nothing due on your cases, companies or marks.</p>
          ) : (
            <Rows rows={d.upcoming} today={today} />
          )}
        </div>
      </div>
      {hidden > 0 && (
        <p className="pt-2 px-1 text-xs text-[var(--text-secondary)]">
          {hidden} more —{' '}
          <Link href="/dashboard/cases" className="underline-offset-2 hover:underline max-sm:inline-block max-sm:py-2.5">cases</Link>,{' '}
          <Link href="/dashboard/corporations" className="underline-offset-2 hover:underline max-sm:inline-block max-sm:py-2.5">companies</Link>,{' '}
          <Link href="/dashboard/trademarks/deadlines" className="underline-offset-2 hover:underline max-sm:inline-block max-sm:py-2.5">marks</Link>
        </p>
      )}
    </SectionCard>
  );
}
