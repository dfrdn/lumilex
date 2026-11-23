'use client';

import { useFeatures } from '@/components/FeatureProvider';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import { Eye, EyeOff, Pin, PinOff, RotateCcw, Search } from 'lucide-react';
import type { UserRole } from '@/lib/queries/team';
import { isRecentlyAdded, searchPages, type NavArea, type NavPage } from '@/lib/nav/pages';
import {
  filterMore, moreContext, moreEntries, moreForRole, moreItems, type MoreArea, type MoreItem,
} from '@/lib/nav/more';
import { customSidebar, type CustomSidebar } from '@/lib/nav/custom-sidebar';
import { usePageVisits, useHydrated } from '@/hooks/use-page-visits';
import { useChatContext } from '@/components/chat/ChatProvider';
import Button from '@/components/ui/Button';
import { MetaChip } from '@/components/ui/primitives';
import { CountPill } from '@/components/nav/SidebarNav';
import { useSidebarChoices } from '@/components/nav/SidebarChoicesProvider';
import type { NavCounts } from '@/app/api/me/nav-counts/route';

const countsKey = (areas: MoreArea[], area: NavArea) =>
  areas.some((a) => a.area === area) ? `/api/me/nav-counts?area=${area}` : null;

/** The badge counts of every area More lists, from the same requests the sidebars make. */
function useMoreCounts(areas: MoreArea[]): NavCounts {
  const dashboard = useSWR<{ counts: NavCounts }>(countsKey(areas, 'dashboard'));
  const admin = useSWR<{ counts: NavCounts }>(countsKey(areas, 'admin'));
  const finance = useSWR<{ counts: NavCounts }>(countsKey(areas, 'finance'));
  const { totalUnread } = useChatContext();
  // As in the sidebar: badges wait for mount, so hydration matches the server.
  const mounted = useHydrated();
  if (!mounted) return {};
  return { ...dashboard.data?.counts, ...admin.data?.counts, ...finance.data?.counts, '/chat': totalUnread };
}

const has = (pages: NavPage[], href: string) => pages.some((p) => p.href === href);

/**
 * More: every page the role can open, under the sidebar's headings in the
 * sidebar's order, then the role's other areas under their names. Sidebar
 * pages come first in each heading, tagged, so the list doubles as a map.
 * Each card can be pinned to this area's sidebar, or hidden from it; cards
 * keep their place when that changes, so a click doesn't move what's under it.
 */
export default function AllTools({ role, area }: { role: UserRole; area: NavArea }) {
  const router = useRouter();
  const visits = usePageVisits();
  const [query, setQuery] = useState('');
  const [unopenedOnly, setUnopenedOnly] = useState(false);

  const flags = useFeatures();
  const all = useMemo(() => moreForRole(role, area, flags), [role, area, flags]);
  const counts = useMoreCounts(all);
  const { saved, customized, togglePin, toggleHide, reset } = useSidebarChoices(area);
  const sidebars = useMemo(
    () => new Map<NavArea, CustomSidebar>(all.map((a) => [a.area, customSidebar(role, a.area, flags, saved[a.area])])),
    [all, role, flags, saved],
  );
  const own = sidebars.get(area) ?? customSidebar(role, area, flags, saved[area]);

  const keep = (page: NavPage) => !unopenedOnly || (visits.loaded && !visits.hasVisited(page.href));
  const searching = query.trim() !== '';

  // While searching, the hits show as one list in rank order, so Enter opens the first card shown.
  const hits = useMemo(() => {
    if (!searching) return [];
    const where = new Map(moreEntries(all).map((e) => [e.item.page.href, e]));
    return searchPages(moreItems(all).map((i) => i.page), query).map((p) => where.get(p.href)!);
  }, [all, query, searching]);
  const shownHits = hits.filter((e) => keep(e.item.page));
  const shown = searching ? [] : filterMore(all, keep);
  const multiArea = all.length > 1;

  function openFirstMatch() {
    const first = shownHits[0];
    if (first) router.push(first.item.page.href);
  }

  /** What a card says about where the page sits: this area's sidebar first, else the sidebar of the area it's listed under. */
  function placeChip(href: string, listedIn: NavArea, areaLabel: string): string | null {
    if (has(own.pinned, href)) return 'Pinned to your sidebar';
    if (listedIn === area) {
      if (has(own.hidden, href)) return 'Hidden from your sidebar';
      return has(own.links, href) ? 'In your sidebar' : null;
    }
    const there = sidebars.get(listedIn);
    return there && (has(there.pinned, href) || has(there.links, href)) ? `In the ${areaLabel} sidebar` : null;
  }

  function renderCard({ page, inSidebar }: MoreItem, listedIn: NavArea, areaLabel: string, context?: string) {
    const opened = visits.hasVisited(page.href);
    const isNew = visits.loaded && !opened && isRecentlyAdded(page);
    const count = counts[page.href] ?? 0;
    const chip = placeChip(page.href, listedIn, areaLabel);
    const pinned = has(own.pinned, page.href);
    const hidden = has(own.hidden, page.href);
    return (
      <div key={page.href} className="relative">
        <Link
          href={page.href}
          prefetch={false}
          className="group flex h-full gap-3 p-4 pr-[4.75rem] bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] shadow-[var(--shadow-card)] hover:shadow-[var(--shadow-card-hover)] hover:border-gold-400/50 transition-all duration-150"
        >
          <page.icon className="w-5 h-5 mt-0.5 shrink-0 text-[var(--text-muted)] group-hover:text-gold-500" />
          <div className="min-w-0 flex-1">
            {context && <p className="mb-0.5 text-[11px] text-[var(--text-muted)]">{context}</p>}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-[var(--text-primary)]">{page.label}</span>
              {isNew ? (
                <span className="px-1.5 py-px rounded-full text-[9px] font-bold uppercase tracking-wider text-gold-700 dark:text-gold-300 ring-1 ring-inset ring-gold-400/60">
                  New
                </span>
              ) : visits.loaded && !opened ? (
                <span className="text-[11px] text-[var(--text-muted)]">Not opened yet</span>
              ) : null}
              {count > 0 && <CountPill count={count} />}
            </div>
            <p className="mt-0.5 text-sm text-[var(--text-secondary)] leading-snug">{page.description}</p>
            {chip && (
              <div className="mt-2">
                <MetaChip>{chip}</MetaChip>
              </div>
            )}
          </div>
        </Link>
        <div className="absolute top-2 right-2 flex items-center">
          <Button
            variant="ghost"
            size="sm"
            className="!p-1.5"
            aria-label={`${pinned ? 'Unpin' : 'Pin'} ${page.label}`}
            aria-pressed={pinned}
            title={pinned ? 'Unpin from your sidebar' : 'Pin to your sidebar'}
            onClick={() => togglePin(page.href)}
          >
            {pinned ? <PinOff className="w-4 h-4 text-gold-600 dark:text-gold-400" /> : <Pin className="w-4 h-4" />}
          </Button>
          {listedIn === area && inSidebar && !pinned && (
            <Button
              variant="ghost"
              size="sm"
              className="!p-1.5"
              aria-label={`${hidden ? 'Show' : 'Hide'} ${page.label}`}
              aria-pressed={hidden}
              title={hidden ? 'Show in your sidebar' : 'Hide from your sidebar'}
              onClick={() => toggleHide(page.href)}
            >
              {hidden ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
            </Button>
          )}
        </div>
      </div>
    );
  }

  const GRID = 'grid gap-3 sm:grid-cols-2 xl:grid-cols-3';

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full sm:w-80">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                openFirstMatch();
              }
            }}
            placeholder="Find a page"
            aria-label="Find a page"
            autoFocus
            className="w-full pl-9 pr-3 py-2 text-sm text-[var(--text-primary)] bg-[var(--card-bg)] border border-[var(--border-color)] rounded-lg placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-gold-400/30 focus:border-gold-400"
          />
        </div>
        <label className="inline-flex items-center gap-2 text-sm text-[var(--text-secondary)] cursor-pointer select-none">
          <input
            type="checkbox"
            checked={unopenedOnly}
            onChange={(e) => setUnopenedOnly(e.target.checked)}
            className="accent-gold-500"
          />
          Only ones I haven&apos;t opened
        </label>
        {customized && (
          <Button variant="ghost" size="sm" onClick={reset}>
            <RotateCcw className="w-3.5 h-3.5" />
            Reset sidebar
          </Button>
        )}
      </div>

      {(searching ? shownHits.length === 0 : shown.length === 0) && (
        <p className="text-sm text-[var(--text-muted)]">No page matches that.</p>
      )}

      {searching && shownHits.length > 0 && (
        <div className={GRID}>
          {shownHits.map((e) => renderCard(e.item, e.area, e.areaLabel, moreContext(e, multiArea)))}
        </div>
      )}

      {shown.map((moreArea, i) => {
        const groups = moreArea.groups.map((group) => {
          const Heading = multiArea ? 'h3' : 'h2';
          return (
            <section key={group.id} id={group.anchor} className="scroll-mt-20">
              {group.label && (
                <Heading
                  className={`mb-3 text-[11px] font-semibold uppercase tracking-[0.12em] ${
                    group.partner ? 'text-gold-600 dark:text-gold-400' : 'text-[var(--text-muted)]'
                  }`}
                >
                  {group.label}
                </Heading>
              )}
              {group.subgroups ? (
                <div className="space-y-5">
                  {group.subgroups.map((sub) => (
                    <div key={sub.id} id={sub.anchor} className="scroll-mt-20">
                      <p className="mb-2 text-xs font-medium text-[var(--text-secondary)]">{sub.label}</p>
                      <div className={GRID}>
                        {sub.items.map((item) => renderCard(item, moreArea.area, moreArea.label))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className={GRID}>
                  {group.items.map((item) => renderCard(item, moreArea.area, moreArea.label))}
                </div>
              )}
            </section>
          );
        });
        if (!multiArea) return <div key={moreArea.area} className="space-y-8">{groups}</div>;
        return (
          <div key={moreArea.area} id={moreArea.anchor} className={`scroll-mt-20 space-y-6 ${i > 0 ? 'pt-6 border-t border-[var(--border-color)]' : ''}`}>
            <h2 className="font-serif text-xl text-stone-900 dark:text-stone-50">{moreArea.label}</h2>
            {groups}
          </div>
        );
      })}
    </div>
  );
}
