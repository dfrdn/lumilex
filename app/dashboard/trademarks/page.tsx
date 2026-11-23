import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { CalendarClock, ChevronLeft, ChevronRight, FileText, Stamp } from 'lucide-react';
import { getSession } from '@/lib/session';
import PageHeader from '@/components/ui/PageHeader';
import RegistryToolbar from '@/components/RegistryToolbar';
import NeedsActionLive from '@/components/trademarks/NeedsActionLive';
import ListEmpty from '@/components/ui/ListEmpty';
import { TrademarkRows, TrademarkSummaryStrip, trademarksHref } from '@/components/trademarks/Registry';
import { TRADEMARK_STATUS_HINTS } from '@/components/trademarks/ui';
import RowDensity from '@/components/RowDensity';
import {
  TRADEMARK_PAGE_SIZE,
  TRADEMARK_VIEWS,
  countMyMarks,
  getTrademarkNeedsAction,
  getTrademarkRows,
  getTrademarkSummary,
  getTrademarkViewCounts,
  type TrademarkFilter,
  type TrademarkScope,
  type TrademarkView,
} from '@/lib/queries/trademark-registry';

const HEADER_LINK =
  'press inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-stone-300 dark:border-white/15 text-stone-700 dark:text-stone-200 hover:bg-stone-50 dark:hover:bg-white/5';

export const metadata: Metadata = { title: 'Trademarks' };

export const dynamic = 'force-dynamic';

const FILTERS: TrademarkFilter[] = ['overdue', 'soon', 'waiting'];
const VIEW_LABEL: Record<TrademarkView, string> = {
  active: 'Active',
  Prelim: 'Prelim',
  'For Filing': 'For Filing',
  Pending: 'Pending',
  'Pending - OA': 'Office Action',
  Registered: 'Registered',
  Abandoned: 'Abandoned',
  all: 'All',
};
const VIEW_HINT: Record<TrademarkView, string> = {
  ...TRADEMARK_STATUS_HINTS,
  active: 'Everything still being prosecuted',
  all: 'Every trademark, abandoned included',
} as Record<TrademarkView, string>;

export default async function TrademarksPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; f?: string; q?: string; page?: string; scope?: string }>;
}) {
  const session = await getSession();
  if (!session?.user?.notionUserId) redirect('/login');

  const sp = await searchParams;
  const view: TrademarkView = TRADEMARK_VIEWS.includes(sp.view as TrademarkView) ? (sp.view as TrademarkView) : 'active';
  const filter: TrademarkFilter = FILTERS.includes(sp.f as TrademarkFilter) ? (sp.f as TrademarkFilter) : 'all';
  const q = (sp.q ?? '').slice(0, 100);
  const page = Math.max(1, Number(sp.page) || 1);
  const params = { view: sp.view, f: sp.f, q: sp.q, page: sp.page, scope: sp.scope };

  // Opens on the marks whose matters you're on; "All" is one click away.
  // Someone on no mark's matter team sees every mark.
  const me = session.user.notionUserId;
  const mineCount = await countMyMarks(me);
  const showAll = sp.scope === 'all' || mineCount === 0;
  const scope: TrademarkScope = showAll ? 'all' : { mine: me };

  const [summary, counts, needs, list] = await Promise.all([
    getTrademarkSummary(scope),
    getTrademarkViewCounts(scope),
    getTrademarkNeedsAction(scope),
    getTrademarkRows(session.firmId, { view, filter, q, page, scope }),
  ]);
  const pages = Math.max(1, Math.ceil(list.total / TRADEMARK_PAGE_SIZE));

  return (
    <>
      <PageHeader
        icon={<Stamp className="w-5 h-5" />}
        title="Trademarks"
        subtitle="Filing pipeline, Office Actions, and the DAU and renewal cadence"
        action={
          <div className="flex flex-wrap gap-2">
            <Link href="/dashboard/trademarks/report-wording" className={HEADER_LINK}>
              <FileText className="w-3.5 h-3.5" /> Report wording
            </Link>
            <Link href="/dashboard/trademarks/deadlines" className={HEADER_LINK}>
              <CalendarClock className="w-3.5 h-3.5" /> Deadlines &amp; client reports
            </Link>
          </div>
        }
      />

      <div className="space-y-5">
        <TrademarkSummaryStrip summary={summary} active={filter} params={params} />

        <NeedsActionLive entries={needs.entries} />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none]" role="tablist" aria-label="Filter trademarks">
            {TRADEMARK_VIEWS.map((v) => {
              const on = v === view;
              return (
                <Link
                  key={v}
                  href={trademarksHref(params, { view: v === 'active' ? undefined : v, page: undefined })}
                  role="tab"
                  aria-selected={on}
                  title={VIEW_HINT[v]}
                  className={`press shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-full border whitespace-nowrap transition-colors ${
                    on
                      ? 'bg-navy-800 text-white border-navy-800 dark:bg-gold-400/15 dark:text-gold-300 dark:border-gold-400/40'
                      : 'bg-white dark:bg-card text-stone-600 dark:text-stone-300 border-stone-200 dark:border-white/10 hover:text-stone-900 dark:hover:text-stone-50'
                  }`}
                >
                  {VIEW_LABEL[v]}
                  <span className={`min-w-[1.25rem] px-1 rounded-full text-[10px] leading-4 text-center tabular-nums ${on ? 'bg-white/20 dark:bg-gold-400/20' : 'bg-stone-100 dark:bg-white/10'}`}>
                    {counts[v]}
                  </span>
                </Link>
              );
            })}
          </div>
          <div className="flex items-center gap-3">
            {mineCount > 0 ? (
              <div className="inline-flex p-0.5 rounded-lg bg-stone-100 dark:bg-white/[0.06] text-[12px]">
                <Link
                  href={trademarksHref(params, { scope: undefined, page: undefined })}
                  className={`px-2.5 py-1 rounded-md transition-all ${!showAll ? 'bg-white dark:bg-card shadow-sm text-stone-900 dark:text-stone-50 font-medium' : 'text-stone-500 dark:text-stone-400 hover:text-stone-800 dark:hover:text-stone-100'}`}
                >
                  My marks · {mineCount}
                </Link>
                <Link
                  href={trademarksHref(params, { scope: 'all', page: undefined })}
                  className={`px-2.5 py-1 rounded-md transition-all ${showAll ? 'bg-white dark:bg-card shadow-sm text-stone-900 dark:text-stone-50 font-medium' : 'text-stone-500 dark:text-stone-400 hover:text-stone-800 dark:hover:text-stone-100'}`}
                >
                  All marks
                </Link>
              </div>
            ) : (
              <span className="text-[11px] text-stone-400 dark:text-stone-500">You aren&apos;t on any mark&apos;s matter team — showing all</span>
            )}
            {summary.pending > 0 && (
              <span className="text-[11px] text-stone-400 dark:text-stone-500" title="Recent changes are folded in every few minutes">
                Updating {summary.pending} mark{summary.pending === 1 ? '' : 's'}…
              </span>
            )}
          </div>
        </div>

        <RegistryToolbar kind="trademark" placeholder="Search marks, clients or registration numbers…" />

        {(filter !== 'all' || q) && (
          <p className="text-[13px] text-stone-600 dark:text-stone-300">
            {list.total} mark{list.total === 1 ? '' : 's'}
            {filter === 'overdue' ? ' with a deadline overdue' : filter === 'soon' ? ' with something due in 30 days' : filter === 'waiting' ? ' waiting on the client' : ''}
            {q ? ` matching “${q}”` : ''}
            {' · '}
            <Link href={trademarksHref({}, { view: sp.view, scope: sp.scope })} className="text-navy-700 dark:text-navy-300 hover:underline">
              Clear
            </Link>
          </p>
        )}

        {list.rows.length ? (
          <RowDensity storageKey="rows:trademarks">
            <TrademarkRows rows={list.rows} />
          </RowDensity>
        ) : (
          <ListEmpty
            icon={<Stamp className="w-6 h-6" />}
            filtered={filter !== 'all' || !!q || view !== 'all'}
            matchNone="No marks match."
            none="No marks yet."
            clearHref={trademarksHref(params, { f: undefined, q: undefined, view: 'all', page: undefined })}
            newHref={trademarksHref(params, { new: '1' })}
            newLabel="New trademark"
          />
        )}

        {pages > 1 && (
          <nav className="flex items-center justify-between text-[13px] text-stone-600 dark:text-stone-300">
            <span>
              Page {page} of {pages} · {list.total} marks
            </span>
            <span className="flex gap-2">
              {page > 1 && (
                <Link href={trademarksHref(params, { page: String(page - 1) })} className="press inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-stone-200 dark:border-white/10 hover:bg-stone-50 dark:hover:bg-white/5">
                  <ChevronLeft className="w-4 h-4" /> Previous
                </Link>
              )}
              {page < pages && (
                <Link href={trademarksHref(params, { page: String(page + 1) })} className="press inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-stone-200 dark:border-white/10 hover:bg-stone-50 dark:hover:bg-white/5">
                  Next <ChevronRight className="w-4 h-4" />
                </Link>
              )}
            </span>
          </nav>
        )}
      </div>
    </>
  );
}
