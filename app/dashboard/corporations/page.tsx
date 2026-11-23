import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Building2, CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { getSession } from '@/lib/session';
import PageHeader from '@/components/ui/PageHeader';
import { manilaToday } from '@/lib/corporations/status';
import {
  REGISTRY_PAGE_SIZE,
  getRegistryCompanies,
  getRegistrySummary,
  getRegistryUpcoming,
  getRegistryNeedsAction,
  NEEDS_ACTION_DAYS,
  countMine,
  type RegistryFilter,
  type RegistryScope,
} from '@/lib/queries/registry';
import { CompanyRows, SummaryStrip, UpcomingList, hrefWith } from '@/components/corporations/Registry';
import RegistryToolbar from '@/components/RegistryToolbar';
import RowDensity from '@/components/RowDensity';
import CompanyNeedsAction from '@/components/corporations/NeedsAction';
import ListEmpty from '@/components/ui/ListEmpty';

export const metadata: Metadata = { title: 'Corporations' };
export const dynamic = 'force-dynamic';

const FILTERS: RegistryFilter[] = ['overdue', 'soon', 'waiting', 'setup'];
const FILTER_LABEL: Record<RegistryFilter, string> = {
  overdue: 'with overdue items',
  soon: 'with items due in 30 days',
  waiting: 'waiting on the client',
  setup: 'in set-up',
  all: '',
};

export default async function CorporationsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; f?: string; q?: string; page?: string; scope?: string }>;
}) {
  const session = await getSession();
  if (!session?.user?.notionUserId) redirect('/login');

  const sp = await searchParams;
  const view = sp.view === 'upcoming' ? 'upcoming' : 'companies';
  const filter: RegistryFilter = FILTERS.includes(sp.f as RegistryFilter) ? (sp.f as RegistryFilter) : 'all';
  const q = (sp.q ?? '').slice(0, 100);
  const page = Math.max(1, Number(sp.page) || 1);
  const params = { view: sp.view, f: sp.f, q: sp.q, page: sp.page, scope: sp.scope };
  const today = manilaToday();

  // Opens on the companies whose matters you're on; "All" is one click away.
  // Someone on no company's team (an admin, finance) sees the whole book.
  const me = session.user.notionUserId;
  const mineCount = await countMine(me);
  const showAll = sp.scope === 'all' || mineCount === 0;
  const scope: RegistryScope = showAll ? 'all' : { mine: me };

  const [summary, companies, upcoming, needs] = await Promise.all([
    getRegistrySummary(scope),
    view === 'companies' ? getRegistryCompanies({ filter, q, page, scope }) : Promise.resolve(null),
    view === 'upcoming' ? getRegistryUpcoming({ q, scope }) : Promise.resolve(null),
    // The Upcoming view already lists every one of these; the panel is for the companies view.
    view === 'companies' ? getRegistryNeedsAction(scope) : Promise.resolve(null),
  ]);
  const pages = companies ? Math.max(1, Math.ceil(companies.total / REGISTRY_PAGE_SIZE)) : 1;

  const tab = (key: 'companies' | 'upcoming', label: string, count?: number) => {
    const on = view === key;
    return (
      <Link
        href={hrefWith(params, { view: key === 'companies' ? undefined : key, page: undefined, f: key === 'upcoming' ? undefined : sp.f })}
        className={`relative inline-flex items-center gap-1.5 px-1 pb-2.5 text-sm font-medium transition-colors ${
          on ? 'text-stone-900 dark:text-stone-50' : 'text-stone-500 dark:text-stone-400 hover:text-stone-800 dark:hover:text-stone-100'
        }`}
      >
        {label}
        {count !== undefined && (
          <span className="px-1.5 py-px rounded-full text-[10px] tabular-nums bg-stone-100 text-stone-500 dark:bg-white/10 dark:text-stone-400">{count}</span>
        )}
        <span className={`absolute left-0 right-0 -bottom-px h-0.5 rounded-full ${on ? 'bg-navy-600 dark:bg-navy-300' : 'bg-transparent'}`} />
      </Link>
    );
  };

  return (
    <>
      <PageHeader
        icon={<Building2 className="w-5 h-5" />}
        title="Corporations"
        subtitle="Every company the firm looks after — where each stands, and what falls due next"
        action={
          <Link
            href="/dashboard/corporations/calendar"
            className="press inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-stone-300 dark:border-white/15 text-stone-700 dark:text-stone-200 hover:bg-stone-50 dark:hover:bg-white/5"
          >
            <CalendarDays className="w-3.5 h-3.5" /> Filing calendar
          </Link>
        }
      />

      <div className="space-y-5">
        <SummaryStrip summary={summary} active={filter} params={params} />

        {needs && <CompanyNeedsAction items={needs.items} withinDays={NEEDS_ACTION_DAYS} />}

        <div className="flex items-end justify-between gap-4 border-b border-stone-200 dark:border-white/10">
          <div className="flex items-center gap-5">
            {tab('companies', 'Companies', summary.companies)}
            {tab('upcoming', 'Upcoming')}
          </div>
          <div className="flex items-center gap-3 pb-2">
          {mineCount > 0 ? (
            <div className="inline-flex p-0.5 rounded-lg bg-stone-100 dark:bg-white/[0.06] text-[12px]">
              <Link
                href={hrefWith(params, { scope: undefined, page: undefined })}
                className={`px-2.5 py-1 rounded-md transition-all ${!showAll ? 'bg-white dark:bg-card shadow-sm text-stone-900 dark:text-stone-50 font-medium' : 'text-stone-500 dark:text-stone-400 hover:text-stone-800 dark:hover:text-stone-100'}`}
              >
                Mine · {mineCount}
              </Link>
              <Link
                href={hrefWith(params, { scope: 'all', page: undefined })}
                className={`px-2.5 py-1 rounded-md transition-all ${showAll ? 'bg-white dark:bg-card shadow-sm text-stone-900 dark:text-stone-50 font-medium' : 'text-stone-500 dark:text-stone-400 hover:text-stone-800 dark:hover:text-stone-100'}`}
              >
                All
              </Link>
            </div>
          ) : (
            <span className="text-[11px] text-stone-400 dark:text-stone-500">You aren&apos;t on any company&apos;s matter team — showing all</span>
          )}
          {summary.pending > 0 && (
            <span className="text-[11px] text-stone-400 dark:text-stone-500" title="Recent changes are folded in every few minutes">
              Updating {summary.pending} compan{summary.pending === 1 ? 'y' : 'ies'}…
            </span>
          )}
          </div>
        </div>

        <RegistryToolbar placeholder={view === 'upcoming' ? 'Search by company…' : 'Search companies, clients or SEC numbers…'} />

        {companies && (
          <>
            {(filter !== 'all' || q) && (
              <p className="text-[13px] text-stone-600 dark:text-stone-300">
                {companies.total} compan{companies.total === 1 ? 'y' : 'ies'}
                {filter !== 'all' ? ` ${FILTER_LABEL[filter]}` : ''}
                {q ? ` matching “${q}”` : ''}
                {' · '}
                <Link href={hrefWith({}, { view: sp.view, scope: sp.scope })} className="text-navy-700 dark:text-navy-300 hover:underline">
                  Clear
                </Link>
              </p>
            )}
            {companies.rows.length ? (
              <RowDensity storageKey="rows:corporations">
                <CompanyRows rows={companies.rows} today={today} />
              </RowDensity>
            ) : (
              <ListEmpty
                icon={<Building2 className="w-6 h-6" />}
                filtered={filter !== 'all' || !!q}
                matchNone="No companies match."
                none="No companies yet."
                clearHref={hrefWith(params, { f: undefined, q: undefined, page: undefined })}
                newHref={hrefWith(params, { new: '1' })}
                newLabel="New corporation"
              />
            )}
            {pages > 1 && (
              <nav className="flex items-center justify-between text-[13px] text-stone-600 dark:text-stone-300">
                <span>
                  Page {page} of {pages} · {companies.total} companies
                </span>
                <span className="flex gap-2">
                  {page > 1 && (
                    <Link href={hrefWith(params, { page: String(page - 1) })} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-stone-200 dark:border-white/10 hover:bg-stone-50 dark:hover:bg-white/5">
                      <ChevronLeft className="w-4 h-4" /> Previous
                    </Link>
                  )}
                  {page < pages && (
                    <Link href={hrefWith(params, { page: String(page + 1) })} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-stone-200 dark:border-white/10 hover:bg-stone-50 dark:hover:bg-white/5">
                      Next <ChevronRight className="w-4 h-4" />
                    </Link>
                  )}
                </span>
              </nav>
            )}
          </>
        )}

        {upcoming && <UpcomingList {...upcoming} today={today} />}
      </div>
    </>
  );
}
