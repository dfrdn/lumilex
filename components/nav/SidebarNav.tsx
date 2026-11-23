'use client';

import { useEffect, useMemo, useState, type HTMLAttributes, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import useSWR from 'swr';
import { ArrowDown, ArrowUp, Check, ChevronRight, Eye, EyeOff, LayoutGrid, Pin, PinOff, RotateCcw, SlidersHorizontal } from 'lucide-react';
import HoverTooltip from '@/components/HoverTooltip';
import SourceLink from '@/components/SourceLink';
import { useFeatures } from '@/components/FeatureProvider';
import { usePageVisits, useHydrated } from '@/hooks/use-page-visits';
import {
  NAV_AREAS, foldedByDefault, pageForPath, isPageActive, isRecentlyAdded, type NavArea, type NavPage,
} from '@/lib/nav/pages';
import { customSidebar } from '@/lib/nav/custom-sidebar';
import { moreHrefFor } from '@/lib/nav/more';
import { isGroupOpen, toggleFold, type FoldChoices } from '@/lib/nav/folds';
import { useSidebarChoices } from '@/components/nav/SidebarChoicesProvider';
import type { NavCounts } from '@/app/api/me/nav-counts/route';
import type { UserRole } from '@/lib/queries/team';

/**
 * What a sidebar's badges need: the counts waiting on the user, read again on
 * every navigation, and a visit record for the page they're on.
 */
export function useNavIndicators(area: NavArea) {
  const pathname = usePathname();
  const { data, mutate } = useSWR<{ counts: NavCounts }>(`/api/me/nav-counts?area=${area}`, {
    refreshInterval: 120_000,
  });
  useEffect(() => {
    mutate();
  }, [pathname, mutate]);
  // SWR restores its cache from localStorage before the first client render,
  // which the server never sees; badges wait for mount so hydration matches.
  const mounted = useHydrated();
  const counts: NavCounts = mounted ? { ...data?.counts } : {};

  const visits = usePageVisits();
  const page = pageForPath(pathname);
  // The first visit in this browser clears the page's "New" pill.
  const unvisitedPath = visits.loaded && page && !visits.hasVisited(page.href) ? page.href : null;
  const { recordVisit } = visits;
  useEffect(() => {
    if (unvisitedPath) recordVisit(unvisitedPath);
    // recordVisit is a fresh closure each render; the path is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unvisitedPath]);

  return {
    counts,
    anythingWaiting: Object.values(counts).some((n) => (n ?? 0) > 0),
    isNew: (p: NavPage) => mounted && visits.loaded && isRecentlyAdded(p) && !visits.hasVisited(p.href),
  };
}

export type NavIndicators = ReturnType<typeof useNavIndicators>;

interface Props {
  area: NavArea;
  role: UserRole;
  indicators: NavIndicators;
  /** Closes the sidebar on mobile after a link is followed. */
  onNavigate: () => void;
  /** Close with the More link, when the role can open a More, adding up the counts of the role's pages that have no link here. */
  more?: boolean;
}

const GROUP_DIVIDER = 'border-t border-navy-700 dark:border-[rgba(255,255,255,0.06)] my-2.5 pt-2.5';
const GROUP_HEADING = 'px-3 mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-navy-500 dark:text-[var(--text-muted)]';
const QUIET_TEXT = 'text-navy-400 dark:text-[var(--text-muted)] hover:text-white hover:bg-navy-800 dark:hover:bg-[#1C1C1E]';

/** A pin, hide or show control on a link while the sidebar is being customized. */
function EditButton({
  label, onClick, disabled, narrow, children,
}: { label: string; onClick: () => void; disabled?: boolean; narrow?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={`shrink-0 ${narrow ? 'w-6' : 'w-7'} h-7 flex items-center justify-center rounded-md transition-colors duration-150 disabled:opacity-30 disabled:pointer-events-none ${QUIET_TEXT}`}
    >
      {children}
    </button>
  );
}

/** The sections and links of a sidebar, with badges, New pills, folding, and the person's pins and hidden links. */
export default function SidebarNav({ area, role, indicators, onNavigate, more }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const { counts, isNew } = indicators;
  const { choices, customized, togglePin, toggleHide, movePin, placePin, reset } = useSidebarChoices(area);
  const flags = useFeatures();
  const { pinned, links: pages, hidden, moreCounts } = useMemo(
    () => customSidebar(role, area, flags, choices),
    [role, area, flags, choices],
  );
  const [editing, setEditing] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const firstSection = pinned.length > 0
    ? null
    : NAV_AREAS[area].sections.find((s) => pages.some((p) => p.section === s.id))?.id;

  // Sections the person folded or opened, remembered in this browser per
  // sidebar (lib/nav/folds.ts says how a choice and the default combine).
  const storageKey = `lumilex:navFolds:${area}`;
  const [folds, setFolds] = useState<FoldChoices>({});
  useEffect(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(storageKey) ?? '{}');
      if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage is only readable after mount
        setFolds(saved as FoldChoices);
      }
    } catch {
      // A missing or unreadable record leaves the role's defaults in place.
    }
  }, [storageKey]);
  function toggleSection(id: string, shownOpen: boolean) {
    const next = toggleFold(folds, id, shownOpen);
    setFolds(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      // Private mode or a full store: the fold still holds until the page reloads.
    }
  }

  function renderLink(item: NavPage, partner: boolean, tools: ReactNode, row?: HTMLAttributes<HTMLDivElement>) {
    const isActive = isPageActive(item, pathname);
    const count = counts[item.href] ?? 0;
    const activeClass = partner
      ? 'nav-active-bar bg-navy-800 dark:bg-[#1C1C1E] text-gold-300'
      : 'nav-active-bar bg-navy-800 dark:bg-[#1C1C1E] text-white';
    const inactiveClass = partner
      ? 'text-gold-400 hover:text-gold-200 hover:bg-navy-800 dark:hover:bg-[#1C1C1E]'
      : 'text-navy-300 dark:text-[#9B978F] hover:text-white hover:bg-navy-800 dark:hover:bg-[#1C1C1E]';
    const link = (
      <HoverTooltip key={item.href} content={item.description} side="right" delay={500} className="block">
        <Link
          href={item.href}
          draggable={row?.draggable ? false : undefined}
          prefetch={false}
          onMouseEnter={() => router.prefetch(item.href)}
          onClick={onNavigate}
          className={`flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-[13px] font-medium transition-colors duration-150 whitespace-nowrap ${
            isActive ? activeClass : inactiveClass
          }`}
        >
          <item.icon className="w-4 h-4 shrink-0" />
          <span className="truncate">{item.label}</span>
          {count > 0 ? (
            <CountPill count={count} />
          ) : isNew(item) ? (
            <span className="ml-auto px-1.5 py-px rounded-full text-[9px] font-bold uppercase tracking-wider text-gold-300 ring-1 ring-inset ring-gold-400/50">
              New
            </span>
          ) : null}
        </Link>
      </HoverTooltip>
    );
    if (!tools) return link;
    return (
      <div key={item.href} {...row} className={`flex items-center ${row?.className ?? ''}`}>
        <div className="min-w-0 flex-1">{link}</div>
        {tools}
      </div>
    );
  }

  function renderPinned(item: NavPage, index: number, shown: NavPage[]) {
    if (!editing) return renderLink(item, false, null);
    const order = shown.map((p) => p.href);
    const tools = (
      <>
        <EditButton
          label={`Move ${item.label} up`} narrow disabled={index === 0}
          onClick={() => movePin(order, item.href, -1)}
        >
          <ArrowUp className="w-3.5 h-3.5" />
        </EditButton>
        <EditButton
          label={`Move ${item.label} down`} narrow disabled={index === order.length - 1}
          onClick={() => movePin(order, item.href, 1)}
        >
          <ArrowDown className="w-3.5 h-3.5" />
        </EditButton>
        <EditButton label={`Unpin ${item.label}`} onClick={() => togglePin(item.href)}>
          <PinOff className="w-3.5 h-3.5" />
        </EditButton>
      </>
    );
    // Dragging works where the browser supports it (desktop); the arrows cover touch and keyboard.
    const row: HTMLAttributes<HTMLDivElement> = {
      draggable: true,
      onDragStart: (e) => {
        setDragging(item.href);
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', item.label);
      },
      onDragEnd: () => setDragging(null),
      onDragOver: (e) => {
        if (dragging) e.preventDefault();
      },
      onDrop: (e) => {
        e.preventDefault();
        if (dragging) placePin(order, dragging, item.href);
        setDragging(null);
      },
      className: `cursor-grab active:cursor-grabbing rounded-lg ${dragging === item.href ? 'opacity-50' : ''}`,
    };
    return renderLink(item, false, tools, row);
  }

  function renderDefault(item: NavPage, partner: boolean) {
    const tools = editing && (
      <>
        <EditButton label={`Pin ${item.label}`} onClick={() => togglePin(item.href)}>
          <Pin className="w-3.5 h-3.5" />
        </EditButton>
        <EditButton label={`Hide ${item.label}`} onClick={() => toggleHide(item.href)}>
          <EyeOff className="w-3.5 h-3.5" />
        </EditButton>
      </>
    );
    return renderLink(item, partner, tools);
  }

  const moreHref = more ? moreHrefFor(role, area) : null;
  const moreWaiting = moreHref ? moreCounts.reduce((sum, href) => sum + (counts[href] ?? 0), 0) : 0;

  return (
    <>
      {pinned.length > 0 && (
        <div>
          <p className={GROUP_HEADING}>Pinned</p>
          {pinned.map((item, i) => renderPinned(item, i, pinned))}
        </div>
      )}
      {NAV_AREAS[area].sections.map((section) => {
        const items = pages.filter((p) => p.section === section.id);
        if (items.length === 0) return null;
        const partner = section.variant === 'partner';
        if (!section.label) {
          // An unlabeled group below the first, such as an area's settings hub, stands apart like More.
          const first = section.id === firstSection;
          return (
            <div
              key={section.id}
              className={first ? undefined : 'border-t border-navy-700 dark:border-[rgba(255,255,255,0.06)] my-2.5 pt-2.5'}
            >
              {items.map((item) => renderDefault(item, partner))}
            </div>
          );
        }
        const open = isGroupOpen(
          folds[section.id], foldedByDefault(area, section.id, role), items.some((item) => isPageActive(item, pathname)),
        );
        const waiting = items.reduce((sum, item) => sum + (counts[item.href] ?? 0), 0);
        const hasNew = items.some(isNew);
        return (
          <div key={section.id} className="border-t border-navy-700 dark:border-[rgba(255,255,255,0.06)] my-2.5 pt-2.5">
            <button
              type="button"
              onClick={() => toggleSection(section.id, open)}
              aria-expanded={open}
              className={`w-full flex items-center gap-1 px-3 mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] transition-colors duration-150 ${
                partner
                  ? 'text-gold-500/80 hover:text-gold-300'
                  : 'text-navy-500 dark:text-[var(--text-muted)] hover:text-navy-300 dark:hover:text-[#9B978F]'
              }`}
            >
              <ChevronRight className={`w-3 h-3 -ml-1 shrink-0 transition-transform duration-150 ${open ? 'rotate-90' : ''}`} />
              {section.label}
              {!open && waiting > 0 && <CountPill count={waiting} />}
              {!open && waiting === 0 && hasNew && (
                <span className="ml-auto w-1.5 h-1.5 rounded-full bg-gold-400" aria-label="Has new pages" />
              )}
            </button>
            {open && items.map((item) => renderDefault(item, partner))}
          </div>
        );
      })}
      {editing && hidden.length > 0 && (
        <div className={GROUP_DIVIDER}>
          <p className={GROUP_HEADING}>Hidden</p>
          {hidden.map((item) => (
            <div key={item.href} className="flex items-center">
              <div className="min-w-0 flex-1 flex items-center gap-2.5 px-3 py-1.5 text-[13px] font-medium text-navy-500 dark:text-[var(--text-muted)]">
                <item.icon className="w-4 h-4 shrink-0" />
                <span className="truncate">{item.label}</span>
              </div>
              <EditButton label={`Show ${item.label}`} onClick={() => toggleHide(item.href)}>
                <Eye className="w-3.5 h-3.5" />
              </EditButton>
            </div>
          ))}
        </div>
      )}
      {moreHref && (
        <div className={GROUP_DIVIDER}>
          <Link
            href={moreHref}
            prefetch={false}
            onClick={onNavigate}
            className={`flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-[13px] font-medium transition-colors duration-150 whitespace-nowrap ${
              pathname === moreHref
                ? 'nav-active-bar bg-navy-800 dark:bg-[#1C1C1E] text-white'
                : 'text-navy-400 dark:text-[var(--text-muted)] hover:text-white hover:bg-navy-800 dark:hover:bg-[#1C1C1E]'
            }`}
          >
            <LayoutGrid className="w-4 h-4 shrink-0" />
            More
            {moreWaiting > 0 && <CountPill count={moreWaiting} />}
          </Link>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-x-1">
        <button
          type="button"
          onClick={() => setEditing(!editing)}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs transition-colors duration-150 ${QUIET_TEXT}`}
        >
          {editing ? <Check className="w-3.5 h-3.5 shrink-0" /> : <SlidersHorizontal className="w-3.5 h-3.5 shrink-0" />}
          {editing ? 'Done' : 'Customize'}
        </button>
        {editing && customized && (
          <button
            type="button"
            onClick={reset}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs transition-colors duration-150 ${QUIET_TEXT}`}
          >
            <RotateCcw className="w-3.5 h-3.5 shrink-0" />
            Reset
          </button>
        )}
      </div>
      {/* AGPL-3.0 section 13: the source is offered on every signed-in screen, in plain sight. */}
      <SourceLink className="block px-3 py-1 text-[11px] text-navy-500 dark:text-[#5E5B55] hover:text-gold-400 transition-colors duration-150" />
    </>
  );
}

/** The gold dot on the menu button while the sidebar is closed and something waits. */
export function MenuWaitingDot({ show }: { show: boolean }) {
  if (!show) return null;
  return <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-gold-400 ring-2 ring-navy-900 dark:ring-[#141414]" />;
}

export function CountPill({ count }: { count: number }) {
  return (
    <span
      className="ml-auto min-w-[18px] h-[18px] px-1.5 flex items-center justify-center rounded-full bg-gold-400 text-navy-900 text-[10px] font-bold leading-none tabular-nums normal-case tracking-normal"
      aria-label={`${count} waiting`}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}
