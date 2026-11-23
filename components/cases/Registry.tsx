import PrefetchLink from '@/components/PrefetchLink';
import { CalendarClock, FileText, Gavel, SearchCheck } from 'lucide-react';
import type { CaseListRow, CaseSummary } from '@/lib/queries/cases';
import { DueChip, RowThumb } from '@/components/ui/primitives';
import SummaryCards, { type SummaryCard } from '@/components/ui/SummaryCards';
import { CaseStatusPill, casesHref, manilaDay } from './ui';

/** The book at a glance; each card opens the cases behind its number. */
export function CaseSummaryStrip({ summary, params }: { summary: CaseSummary; params: Record<string, string | undefined> }) {
  const cards: SummaryCard[] = [
    {
      key: 'active',
      label: 'Active',
      active: (params.view ?? 'active') === 'active',
      value: summary.active,
      sub: 'with a proceeding open',
      icon: <Gavel className="w-4 h-4" />,
      accent: 'navy',
      href: casesHref(params, { view: undefined, page: undefined }),
    },
    {
      key: 'week',
      label: 'Hearings this week',
      value: summary.hearingsThisWeek,
      sub: summary.unrecorded
        ? `${summary.unrecorded} past with no outcome`
        : summary.hearingsThisWeek
          ? `on ${summary.casesWithHearings} case${summary.casesWithHearings === 1 ? '' : 's'}`
          : 'none in the next 7 days',
      icon: <CalendarClock className="w-4 h-4" />,
      accent: 'amber',
      href: '#needs-action',
    },
    {
      key: 'filings',
      label: 'To file',
      value: summary.filingsDue + summary.filingsOverdue,
      sub: summary.filingsOverdue ? `${summary.filingsOverdue} past due` : 'due in the next 14 days',
      icon: <FileText className="w-4 h-4" />,
      accent: summary.filingsOverdue ? 'rose' : 'violet',
      href: '#needs-action',
    },
    {
      key: 'evaluation',
      label: 'In evaluation',
      active: params.view === 'evaluation',
      value: summary.evaluation,
      sub: 'studied, not yet filed',
      icon: <SearchCheck className="w-4 h-4" />,
      accent: 'gold',
      href: casesHref(params, { view: params.view === 'evaluation' ? undefined : 'evaluation', page: undefined }),
    },
  ];
  return <SummaryCards cards={cards} />;
}

const COLS = 'lg:grid-cols-[minmax(0,2.6fr)_minmax(0,0.8fr)_minmax(0,1.6fr)_minmax(0,1.5fr)]';

/** One row per case: its title and what it is about, where it stands, and the next hearing. */
export function CaseRows({ rows }: { rows: CaseListRow[] }) {
  return (
    <section className="rounded-2xl border border-stone-200 dark:border-white/10 bg-white dark:bg-card overflow-hidden">
      <div className={`hidden lg:grid ${COLS} gap-x-4 px-4 py-2 text-[10.5px] font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500 border-b border-stone-100 dark:border-white/[0.06]`}>
        <span>Case</span>
        <span>Status</span>
        <span>Where it stands</span>
        <span>Next hearing</span>
      </div>
      <ul className="divide-y divide-stone-100 dark:divide-white/[0.06]">
        {rows.map((c, i) => (
          <li key={c.id} className="rise-in" style={{ '--i': i } as React.CSSProperties}>
            <PrefetchLink
              href={`/dashboard/cases/${c.id}`}
              className={`group grid grid-cols-[minmax(0,1fr)_auto] ${COLS} gap-x-4 items-center px-4 py-2 group-data-[density=comfortable]/rows:py-3.5 hover:bg-stone-50/70 dark:hover:bg-white/[0.03] transition-colors`}
            >
              <span className="flex items-center gap-2.5 min-w-0">
                <RowThumb name={c.title || '?'} health={c.branchPending ? 'amber' : null} />
                <span className="min-w-0">
                  <span
                    className="block text-[13px] group-data-[density=comfortable]/rows:text-sm font-medium leading-tight text-stone-900 dark:text-stone-50 truncate group-hover:text-navy-700 dark:group-hover:text-navy-300 transition-colors"
                    title={c.title}
                  >
                    {c.title}
                  </span>
                  <span className="flex items-center gap-1.5 mt-0.5 text-[11px] leading-tight text-stone-500 dark:text-stone-400 min-w-0">
                    <span className="lg:hidden shrink-0">
                      <CaseStatusPill status={c.status} size="sm" />
                    </span>
                    <span className="truncate" title={c.nature ?? undefined}>
                      {[c.clients.join(', '), c.nature].filter(Boolean).join(' · ') || '—'}
                    </span>
                  </span>
                </span>
              </span>
              <span className="hidden lg:block">
                <CaseStatusPill status={c.status} />
              </span>
              <span className="hidden lg:block min-w-0 text-[11px] leading-tight">
                {c.forum ? (
                  <>
                    <span className="block font-medium text-stone-700 dark:text-stone-200 truncate" title={c.office ?? undefined}>
                      {c.office || c.forum}
                      {c.proceedings > 1 && <span className="font-normal text-stone-400 dark:text-stone-500"> · {c.proceedings} proceedings</span>}
                    </span>
                    {c.stage && <span className="block mt-0.5 text-navy-700 dark:text-navy-300 truncate">{c.stage}</span>}
                    {c.docket && <span className="block mt-0.5 font-mono text-stone-500 dark:text-stone-400 truncate">{c.docket}</span>}
                    {c.branchPending && <span className="block mt-0.5 text-amber-700 dark:text-amber-300">Rule 65 petition pending</span>}
                  </>
                ) : (
                  <span className="text-stone-400 dark:text-stone-500">Not yet filed</span>
                )}
              </span>
              <span className="min-w-0 text-right lg:text-left">
                {c.next ? (
                  <span className="block">
                    <span className="block text-[12px] font-medium leading-tight text-stone-800 dark:text-stone-100 truncate">
                      {c.next.name || 'Hearing'}
                      {c.next.forum && <span className="font-normal text-stone-500 dark:text-stone-400"> · {c.next.forum}</span>}
                    </span>
                    <span className="block mt-0.5">
                      <DueChip due={manilaDay(c.next.date)} />
                    </span>
                  </span>
                ) : (
                  <span className="text-xs text-stone-400 dark:text-stone-500">—</span>
                )}
              </span>
            </PrefetchLink>
          </li>
        ))}
      </ul>
    </section>
  );
}
