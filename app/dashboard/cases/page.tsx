import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ChevronLeft, ChevronRight, Landmark } from 'lucide-react';
import { getSession } from '@/lib/session';
import PageHeader from '@/components/ui/PageHeader';
import RowDensity from '@/components/RowDensity';
import CaseSearch from '@/components/cases/CaseSearch';
import NewCaseButton from '@/components/cases/NewCaseButton';
import { CASE_EDITORS } from '@/lib/cases/api';
import CaseNeedsAction from '@/components/cases/NeedsAction';
import { CaseRows, CaseSummaryStrip } from '@/components/cases/Registry';
import { casesHref } from '@/components/cases/ui';
import {
  CASES_PAGE_SIZE,
  CASE_VIEWS,
  countMyCases,
  getCaseNeedsAction,
  getCaseRows,
  getCaseSummary,
  type CaseScope,
  type CaseView,
} from '@/lib/queries/cases';

export const metadata: Metadata = { title: 'Cases' };
export const dynamic = 'force-dynamic';

const VIEW_LABEL: Record<CaseView, string> = { active: 'Active', evaluation: 'Evaluation', closed: 'Closed', all: 'All' };
const VIEW_HINT: Record<CaseView, string> = {
  active: 'A proceeding is still open',
  evaluation: 'Being studied — nothing filed yet',
  closed: 'Resolved, settled or not pursued',
  all: 'Every case',
};

export default async function CasesPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; q?: string; page?: string; scope?: string }>;
}) {
  const session = await getSession();
  if (!session?.user?.notionUserId) redirect('/login');
  const role = session.user.role ?? 'lawyer';

  const sp = await searchParams;
  const view: CaseView = CASE_VIEWS.includes(sp.view as CaseView) ? (sp.view as CaseView) : 'active';
  const q = (sp.q ?? '').slice(0, 100);
  const page = Math.max(1, Number(sp.page) || 1);
  const params = { view: sp.view, q: sp.q, page: sp.page, scope: sp.scope };

  // Opens on the cases whose matters you're on; someone on no case's team sees them all.
  const me = session.user.notionUserId;
  const mineCount = await countMyCases(me);
  const showAll = sp.scope === 'all' || mineCount === 0;
  const scope: CaseScope = showAll ? 'all' : { mine: me };

  const needsP = getCaseNeedsAction(scope);
  const [needs, list, summary] = await Promise.all([
    needsP,
    getCaseRows({ view, q, page, scope }),
    needsP.then((n) => getCaseSummary(scope, n)),
  ]);
  const counts: Record<CaseView, number> = {
    active: summary.active,
    evaluation: summary.evaluation,
    closed: summary.closed,
    all: summary.active + summary.evaluation + summary.closed,
  };
  const pages = Math.max(1, Math.ceil(list.total / CASES_PAGE_SIZE));

  return (
    <>
      <PageHeader
        icon={<Landmark className="w-5 h-5" />}
        title="Cases"
        subtitle="Every dispute the firm handles — from study, through each forum, to the end"
        action={CASE_EDITORS.includes(role) ? <NewCaseButton /> : undefined}
      />

      <div className="space-y-5">
        <CaseSummaryStrip summary={summary} params={params} />

        <CaseNeedsAction needs={needs} />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none]" role="tablist" aria-label="Filter cases">
            {CASE_VIEWS.map((v) => {
              const on = v === view;
              return (
                <Link
                  key={v}
                  href={casesHref(params, { view: v === 'active' ? undefined : v, page: undefined })}
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
          {mineCount > 0 ? (
            <div className="inline-flex p-0.5 rounded-lg bg-stone-100 dark:bg-white/[0.06] text-[12px]">
              <Link
                href={casesHref(params, { scope: undefined, page: undefined })}
                className={`px-2.5 py-1 rounded-md transition-all ${!showAll ? 'bg-white dark:bg-card shadow-sm text-stone-900 dark:text-stone-50 font-medium' : 'text-stone-500 dark:text-stone-400 hover:text-stone-800 dark:hover:text-stone-100'}`}
              >
                My cases · {mineCount}
              </Link>
              <Link
                href={casesHref(params, { scope: 'all', page: undefined })}
                className={`px-2.5 py-1 rounded-md transition-all ${showAll ? 'bg-white dark:bg-card shadow-sm text-stone-900 dark:text-stone-50 font-medium' : 'text-stone-500 dark:text-stone-400 hover:text-stone-800 dark:hover:text-stone-100'}`}
              >
                All cases
              </Link>
            </div>
          ) : (
            <span className="text-[11px] text-stone-400 dark:text-stone-500">You aren&apos;t on any case&apos;s matter team — showing all</span>
          )}
        </div>

        <CaseSearch placeholder="Search captions, dockets, courts or what it's about…" />

        {q && (
          <p className="text-[13px] text-stone-600 dark:text-stone-300">
            {list.total} case{list.total === 1 ? '' : 's'} matching “{q}” · {' '}
            <Link href={casesHref({}, { view: sp.view, scope: sp.scope })} className="text-navy-700 dark:text-navy-300 hover:underline">
              Clear
            </Link>
          </p>
        )}

        {list.rows.length ? (
          <RowDensity storageKey="rows:cases">
            <CaseRows rows={list.rows} />
          </RowDensity>
        ) : (
          <div className="reveal rounded-2xl border border-dashed border-stone-200 dark:border-white/10 px-6 py-12 text-center">
            <Landmark className="w-6 h-6 mx-auto text-stone-300 dark:text-stone-600" />
            <p className="mt-2 text-sm text-stone-600 dark:text-stone-300">{q || view !== 'all' ? 'No cases match.' : 'No cases yet.'}</p>
            {(q || view !== 'all') && (
              <Link
                href={casesHref(params, { q: undefined, view: 'all', page: undefined })}
                className="press mt-4 inline-flex items-center px-3 py-1.5 text-xs font-medium rounded-lg border border-stone-300 dark:border-white/15 hover:bg-stone-50 dark:hover:bg-white/5"
              >
                Clear filters
              </Link>
            )}
          </div>
        )}

        {pages > 1 && (
          <nav className="flex items-center justify-between text-[13px] text-stone-600 dark:text-stone-300">
            <span>
              Page {page} of {pages} · {list.total} cases
            </span>
            <span className="flex gap-2">
              {page > 1 && (
                <Link href={casesHref(params, { page: String(page - 1) })} className="press inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-stone-200 dark:border-white/10 hover:bg-stone-50 dark:hover:bg-white/5">
                  <ChevronLeft className="w-4 h-4" /> Previous
                </Link>
              )}
              {page < pages && (
                <Link href={casesHref(params, { page: String(page + 1) })} className="press inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-stone-200 dark:border-white/10 hover:bg-stone-50 dark:hover:bg-white/5">
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
