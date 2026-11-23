import PrefetchLink from '@/components/PrefetchLink';
import { AlertTriangle, Clock3, FileWarning, Hourglass } from 'lucide-react';
import type { TrademarkFilter, TrademarkRow, TrademarkSummary } from '@/lib/queries/trademark-registry';
import { formatDate, formatDateShort } from '@/lib/format-date';
import { countryName } from '@/lib/trademarks/countries';
import { TrademarkStatusPill } from './ui';
import { DueChip, RowThumb } from '@/components/ui/primitives';
import SummaryCards, { type SummaryCard } from '@/components/ui/SummaryCards';

export function trademarksHref(params: Record<string, string | undefined>, patch: Record<string, string | undefined>): string {
  const next = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...params, ...patch })) if (v) next.set(k, v);
  const qs = next.toString();
  return `/dashboard/trademarks${qs ? `?${qs}` : ''}`;
}

/** The book at a glance; each card filters the list to the marks behind its number. */
export function TrademarkSummaryStrip({
  summary,
  active,
  params,
}: {
  summary: TrademarkSummary;
  active: TrademarkFilter;
  params: Record<string, string | undefined>;
}) {
  const cards: SummaryCard[] = [
    {
      key: 'overdue',
      label: 'Overdue',
      active: active === 'overdue',
      value: summary.overdueMarks,
      sub: 'marks with a bar date passed',
      icon: <AlertTriangle className="w-4 h-4" />,
      accent: 'rose',
      href: trademarksHref(params, { f: active === 'overdue' ? undefined : 'overdue', page: undefined }),
    },
    {
      key: 'soon',
      label: 'Due in 30 days',
      active: active === 'soon',
      value: summary.dueSoonItems,
      sub: 'fees, responses, DAUs, renewals',
      icon: <Clock3 className="w-4 h-4" />,
      accent: 'amber',
      href: trademarksHref(params, { f: active === 'soon' ? undefined : 'soon', page: undefined }),
    },
    {
      key: 'oa',
      label: 'Office Actions',
      active: params.view === 'Pending - OA',
      value: summary.officeActions,
      sub: 'awaiting a response',
      icon: <FileWarning className="w-4 h-4" />,
      accent: 'violet',
      href: trademarksHref(params, { view: params.view === 'Pending - OA' ? undefined : 'Pending - OA', f: undefined, page: undefined }),
    },
    {
      key: 'waiting',
      label: 'Waiting on client',
      active: active === 'waiting',
      value: summary.waiting,
      sub: 'open file requests',
      icon: <Hourglass className="w-4 h-4" />,
      accent: 'gold',
      href: trademarksHref(params, { f: active === 'waiting' ? undefined : 'waiting', page: undefined }),
    },
  ];
  return <SummaryCards cards={cards} />;
}

const COLS = 'lg:grid-cols-[minmax(0,2.6fr)_minmax(0,0.9fr)_minmax(0,1.9fr)_minmax(0,0.9fr)_minmax(0,1fr)]';

/** When the mark entered IPOPHL: filed, or for a Madrid designation, designated. */
function datedLine(t: TrademarkRow): string | null {
  if (t.designatedOn) return `Designated ${formatDate(t.designatedOn)}`;
  return t.filingDate ? `Filed ${formatDate(t.filingDate)}` : null;
}

function Classes({ classes }: { classes: number[] }) {
  if (!classes.length) return <span className="text-stone-400 dark:text-stone-500">—</span>;
  return (
    <span className="inline-flex flex-wrap gap-0.5">
      {classes.map((c) => (
        <span key={c} className="px-1 rounded bg-stone-100 dark:bg-white/[0.06] font-mono text-[10px] text-stone-600 dark:text-stone-300">
          {c}
        </span>
      ))}
    </span>
  );
}

/** One compact row per mark, worst news first: two lines at any width. */
export function TrademarkRows({ rows }: { rows: TrademarkRow[] }) {
  return (
    <section className="rounded-2xl border border-stone-200 dark:border-white/10 bg-white dark:bg-card overflow-hidden">
      <div className={`hidden lg:grid ${COLS} gap-x-4 px-4 py-2 text-[10.5px] font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500 border-b border-stone-100 dark:border-white/[0.06]`}>
        <span>Mark</span>
        <span>Status</span>
        <span>Next deadline</span>
        <span>Classes</span>
        <span>Reg/IR No.</span>
      </div>
      <ul className="divide-y divide-stone-100 dark:divide-white/[0.06]">
        {rows.map((t, i) => (
          <li key={t.id} className="rise-in" style={{ '--i': i } as React.CSSProperties}>
            <PrefetchLink
              href={`/dashboard/trademarks/${t.id}`}
              className={`group grid grid-cols-[minmax(0,1fr)_auto] ${COLS} gap-x-4 items-center px-4 py-2 group-data-[density=comfortable]/rows:py-3.5 hover:bg-stone-50/70 dark:hover:bg-white/[0.03] transition-colors`}
            >
              <span className="flex items-center gap-2.5 min-w-0">
                <RowThumb name={t.mark || '?'} imageUrl={t.imageUrl} health={t.health} />
                <span className="min-w-0">
                  <span className="block text-[13px] group-data-[density=comfortable]/rows:text-sm font-medium leading-tight text-stone-900 dark:text-stone-50 truncate group-hover:text-navy-700 dark:group-hover:text-navy-300 transition-colors" title={t.mark}>
                    {t.mark}
                    {t.abroadIn && <span className="ml-1.5 font-normal text-stone-500 dark:text-stone-400">· {countryName(t.abroadIn)}</span>}
                  </span>
                  {/* Wide: client and type. Narrow: status, classes and number too, on the same line. */}
                  <span className="flex items-center gap-1.5 mt-0.5 text-[11px] leading-tight text-stone-500 dark:text-stone-400 min-w-0">
                    <span className="lg:hidden shrink-0">
                      <TrademarkStatusPill status={t.status} size="sm" />
                    </span>
                    <span className="truncate">{[t.clientName, t.type].filter(Boolean).join(' · ') || '—'}</span>
                    {t.regIrNo && <span className="lg:hidden font-mono shrink-0 hidden sm:inline">· {t.regIrNo}</span>}
                  </span>
                  {/* Comfortable, narrow: classes and filing date get their own line. */}
                  <span className="hidden group-data-[density=comfortable]/rows:max-lg:flex items-center gap-2 mt-1.5 text-[11px] text-stone-500 dark:text-stone-400">
                    <Classes classes={t.classes} />
                    {datedLine(t) && <span>{datedLine(t)}</span>}
                  </span>
                </span>
              </span>
              <span className="hidden lg:block">
                <TrademarkStatusPill status={t.status} />
              </span>
              <span className="min-w-0 text-right lg:text-left">
                {t.status === 'Abandoned' || !t.next ? (
                  <span className="text-xs text-stone-400 dark:text-stone-500">—</span>
                ) : (
                  <span className="block">
                    <span className="block text-[12px] font-medium leading-tight text-stone-800 dark:text-stone-100 truncate">
                      {t.next.label}
                      {t.overdue > 1 && <span className="ml-1 font-normal text-rose-600 dark:text-rose-400">+{t.overdue - 1} overdue</span>}
                    </span>
                    <span className="block mt-0.5">
                      <DueChip due={t.next.due} />
                    </span>
                  </span>
                )}
              </span>
              <span className="hidden lg:block text-[11px]">
                <Classes classes={t.classes} />
              </span>
              <span className="hidden lg:block min-w-0 text-[11px] leading-tight text-stone-500 dark:text-stone-400" title={datedLine(t) ?? undefined}>
                <span className="block font-mono truncate">{t.regIrNo ? `${t.designatedOn ? 'IR ' : ''}${t.regIrNo}` : '—'}</span>
                {datedLine(t) && <span className="block mt-0.5">{datedLine(t)}</span>}
              </span>
            </PrefetchLink>
          </li>
        ))}
      </ul>
    </section>
  );
}

