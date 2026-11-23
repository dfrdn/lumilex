'use client';

import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { usePersistedState } from '@/hooks/use-persisted-state';
import PrefetchLink from '@/components/PrefetchLink';
import { useRouter } from 'next/navigation';
import {
  ChevronUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  SlidersHorizontal,
  Check,
  Search,
  X,
  ChevronDownIcon,
  Inbox,
} from 'lucide-react';
import { DensityToggle, useRowDensity } from '@/components/RowDensity';
import { BTN_OUTLINE, CARD } from '@/components/ui/tone';
import SummaryCards, { type SummaryCard } from '@/components/ui/SummaryCards';

// ── Types ─────────────────────────────────────────────────────────

export interface ColumnDef<T> {
  key: string;
  label: string;
  getValue: (item: T) => string | number | boolean | null;
  /** Optional custom sort value. When provided, sorting uses this instead of getValue. */
  getSortValue?: (item: T) => string | number | boolean | null;
  render: (item: T) => React.ReactNode;
  sortable?: boolean;
  defaultVisible?: boolean;
  hiddenOnMobile?: boolean;
  /** Optional tooltip shown on hover over the column header */
  headerTooltip?: string;
}

export interface FilterDef<T> {
  /** Unique key for this filter */
  key: string;
  /** Label shown on the dropdown button */
  label: string;
  /** Extract the filterable value from a row */
  getValue: (item: T) => string;
  /** Optional fixed ordering of options (values not listed appear at end, alphabetically) */
  optionOrder?: string[];
  /** Optional formatter for option labels in the dropdown (value is still used for filtering) */
  formatOption?: (value: string) => string;
}

/** A summary card over the list: its number counts the rows `match` keeps, and clicking it shows just those. */
export interface TableCard<T> {
  key: string;
  label: string;
  sub: string;
  icon: React.ReactNode;
  accent: SummaryCard['accent'];
  match: (item: T) => boolean;
}

interface Props<T> {
  data: T[];
  /** Cards above the toolbar. A chosen card replaces the active-only toggle — it carries its own window. */
  cards?: TableCard<T>[];
  /** The card chosen on arrival, e.g. from a link's `?card=`. */
  initialCard?: string | null;
  /** A second line under the row's name, shown in Comfortable density. Compact keeps every row to one line. */
  getRowDetail?: (item: T) => React.ReactNode;
  columns: ColumnDef<T>[];
  getRowHref: (item: T) => string;
  getRowId: (item: T) => string;
  entityLabel: string;
  defaultSortKey?: string;
  defaultSortDir?: 'asc' | 'desc';
  userId?: string;
  isMyItem?: (item: T, userId: string) => boolean;
  /** User role — lawyers are locked to "My Items", partners/super_users can toggle */
  role?: string;
  /** Optional predicate to determine if an item is "active" (for Active Only filter) */
  isActiveItem?: (item: T) => boolean;
  /** Whether the active filter starts on. Defaults to true. */
  initialActiveOnly?: boolean;
  /** Custom label for the active filter button (defaults to "Active Only") */
  activeLabel?: string;
  /** Optional dropdown filters shown in the toolbar */
  filters?: FilterDef<T>[];
  /** Optional default values for dropdown filters, keyed by filter key */
  defaultFilters?: Record<string, string>;
  /** Rows per page. Defaults to 50. */
  pageSize?: number;
  /** If set, persists sort key/direction to localStorage under this key prefix. */
  persistKey?: string;
  /** Optional predicate — matching rows are pinned to the top regardless of the active sort. */
  pinToTop?: (item: T) => boolean;
}

const PAGE_SIZE_OPTIONS = [25, 50, 100, 200];

const TOGGLE = 'press flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors cursor-pointer';
const TOGGLE_ON = 'bg-navy-50 text-navy-800 border-navy-300 dark:bg-navy-600 dark:text-white dark:border-navy-500';
const TOGGLE_OFF =
  'bg-white text-stone-600 border-stone-200 hover:border-stone-300 hover:text-stone-800 dark:bg-card dark:text-stone-300 dark:border-white/10 dark:hover:border-white/20 dark:hover:text-stone-100';
const MENU = 'absolute right-0 top-full mt-1.5 z-20 rounded-xl border border-stone-200 dark:border-white/10 bg-white dark:bg-card shadow-lg p-1';
const MENU_ITEM = 'w-full text-left px-3 py-1.5 text-xs rounded-lg transition-colors cursor-pointer hover:bg-stone-50 dark:hover:bg-white/5';
const MENU_ITEM_ON = 'text-navy-800 bg-navy-50 font-medium dark:text-white dark:bg-navy-600';
const SEGMENT = 'press px-2.5 py-1 rounded-md transition-all';
const SEGMENT_ON = 'bg-white dark:bg-card shadow-sm text-stone-900 dark:text-stone-50 font-medium';
const SEGMENT_OFF = 'text-stone-500 dark:text-stone-400 hover:text-stone-800 dark:hover:text-stone-100';
const PAGE_ARROW =
  'p-1.5 rounded-lg text-stone-400 hover:text-stone-800 hover:bg-stone-100 dark:text-stone-500 dark:hover:text-stone-100 dark:hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer';

const NAME_LINE =
  'block max-w-[26rem] truncate text-[13px] group-data-[density=comfortable]/rows:whitespace-normal group-data-[density=comfortable]/rows:text-sm group-data-[density=comfortable]/rows:leading-snug';
const DETAIL_LINE =
  'hidden group-data-[density=comfortable]/rows:block mt-1 max-w-[26rem] text-[11.5px] leading-snug font-normal text-stone-500 dark:text-stone-400 truncate';

// ── Component ─────────────────────────────────────────────────────

export default function DataTable<T>({
  data,
  columns,
  getRowHref,
  getRowId,
  entityLabel,
  defaultSortKey,
  defaultSortDir = 'asc',
  userId,
  isMyItem,
  role = 'lawyer',
  isActiveItem,
  initialActiveOnly = true,
  activeLabel = 'Active Only',
  filters,
  defaultFilters,
  pageSize: defaultPageSize = 50,
  persistKey,
  pinToTop,
  cards,
  initialCard = null,
  getRowDetail,
}: Props<T>) {
  const isLawyer = role === 'lawyer';
  const canToggleMyItems = !isLawyer; // partners & super_users can toggle
  const [sortKey, setSortKey] = usePersistedState(
    persistKey ? `${persistKey}.sortKey` : null,
    defaultSortKey ?? columns[0]?.key ?? '',
  );
  const [sortDir, setSortDir] = usePersistedState<'asc' | 'desc'>(
    persistKey ? `${persistKey}.sortDir` : null,
    defaultSortDir,
  );
  const [myOnly, setMyOnly] = useState(isLawyer); // lawyers default to My Items
  const [activeOnly, setActiveOnly] = useState(initialActiveOnly);
  const [cardKey, setCardKey] = useState<string | null>(initialCard);
  const card = cards?.find((c) => c.key === cardKey) ?? null;
  const [visibleCols, setVisibleCols] = useState<Record<string, boolean>>(() => {
    const map: Record<string, boolean> = {};
    for (const col of columns) {
      map[col.key] = col.defaultVisible !== false;
    }
    return map;
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [colMenuOpen, setColMenuOpen] = useState(false);
  const [activeFilters, setActiveFilters] = useState<Record<string, string>>(defaultFilters ?? {});
  const [openFilterKey, setOpenFilterKey] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(defaultPageSize);
  const menuRef = useRef<HTMLDivElement>(null);
  const filterMenuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [density, setDensity] = useRowDensity(`${persistKey ?? `table.${entityLabel}`}.density`);

  // Close column menu on outside click
  useEffect(() => {
    if (!colMenuOpen && !openFilterKey) return;
    function handleClick(e: MouseEvent) {
      if (colMenuOpen && menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setColMenuOpen(false);
      }
      if (openFilterKey && filterMenuRef.current && !filterMenuRef.current.contains(e.target as Node)) {
        setOpenFilterKey(null);
      }
    }
    document.addEventListener('mousedown', handleClick, true);
    return () => document.removeEventListener('mousedown', handleClick, true);
  }, [colMenuOpen, openFilterKey]);

  // Reset to page 1 when filters/search change
  useEffect(() => { setPage(1); }, [searchQuery, myOnly, activeFilters, cardKey]);

  // Compute unique filter options from data
  const filterOptions = useMemo(() => {
    if (!filters) return {};
    const map: Record<string, string[]> = {};
    for (const f of filters) {
      const values = new Set<string>();
      for (const item of data) {
        const v = f.getValue(item);
        if (v) values.add(v);
      }
      if (f.optionOrder) {
        const order = f.optionOrder;
        map[f.key] = [...values].sort((a, b) => {
          const ia = order.indexOf(a);
          const ib = order.indexOf(b);
          const oa = ia === -1 ? 999 : ia;
          const ob = ib === -1 ? 999 : ib;
          return oa !== ob ? oa - ob : a.localeCompare(b);
        });
      } else {
        map[f.key] = [...values].sort();
      }
    }
    return map;
  }, [data, filters]);

  // Text search filter (substring match)
  const searched = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return data;
    const tokens = q.split(/\s+/).filter(Boolean);
    return data.filter((item) =>
      tokens.every((token) =>
        columns.some((col) => {
          const v = col.getValue(item);
          if (v == null) return false;
          return String(v).toLowerCase().includes(token);
        }),
      ),
    );
  }, [data, searchQuery, columns]);

  // Dropdown filters. Pinned rows (pinToTop) bypass the dropdown filters so they
  // always surface — they still respect the text search above.
  const dropdownFiltered = useMemo(() => {
    if (!filters) return searched;
    const activeEntries = Object.entries(activeFilters).filter(([, v]) => v);
    if (activeEntries.length === 0) return searched;
    return searched.filter((item) =>
      (pinToTop?.(item) ?? false) ||
      activeEntries.every(([key, val]) => {
        const f = filters.find((fd) => fd.key === key);
        return f ? f.getValue(item) === val : true;
      }),
    );
  }, [searched, activeFilters, filters, pinToTop]);

  // My Items filter
  const myFiltered = useMemo(() => {
    if (!myOnly || !userId || !isMyItem) return dropdownFiltered;
    return dropdownFiltered.filter((item) => isMyItem(item, userId));
  }, [dropdownFiltered, myOnly, userId, isMyItem]);

  // A chosen card, else the Active Items filter
  const filtered = useMemo(() => {
    if (card) return myFiltered.filter(card.match);
    if (!activeOnly || !isActiveItem) return myFiltered;
    return myFiltered.filter((item) => isActiveItem(item));
  }, [myFiltered, activeOnly, isActiveItem, card]);

  const summary: SummaryCard[] | null = cards
    ? cards.map((c) => ({
        key: c.key,
        label: c.label,
        sub: c.sub,
        icon: c.icon,
        accent: c.accent,
        value: myFiltered.filter(c.match).length,
        active: c.key === cardKey,
        onClick: () => setCardKey((k) => (k === c.key ? null : c.key)),
      }))
    : null;

  // Sort
  const sorted = useMemo(() => {
    // Pinned rows float to the top regardless of the active sort (stable partition).
    const applyPin = (rows: T[]) =>
      pinToTop ? [...rows.filter((i) => pinToTop(i)), ...rows.filter((i) => !pinToTop(i))] : rows;

    const col = columns.find((c) => c.key === sortKey);
    if (!col || col.sortable === false) return applyPin(filtered);

    const valFn = col.getSortValue ?? col.getValue;
    const ordered = [...filtered].sort((a, b) => {
      const va = valFn(a);
      const vb = valFn(b);
      // Nulls always last
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;

      let cmp = 0;
      if (typeof va === 'string' && typeof vb === 'string') {
        cmp = va.localeCompare(vb);
      } else if (typeof va === 'number' && typeof vb === 'number') {
        cmp = va - vb;
      } else if (typeof va === 'boolean' && typeof vb === 'boolean') {
        cmp = (va ? 1 : 0) - (vb ? 1 : 0);
      } else {
        cmp = String(va).localeCompare(String(vb));
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return applyPin(ordered);
  }, [filtered, sortKey, sortDir, columns, pinToTop]);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(sorted.length / perPage));
  const safePage = Math.min(page, totalPages);
  const paginatedItems = useMemo(() => {
    const start = (safePage - 1) * perPage;
    return sorted.slice(start, start + perPage);
  }, [sorted, safePage, perPage]);

  const activeColumns = columns.filter((c) => visibleCols[c.key]);

  function toggleSort(key: string) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }

  const router = useRouter();
  const handleCardClick = useCallback((item: T, e: React.MouseEvent) => {
    // Don't navigate if user clicked a link inside the card
    if ((e.target as HTMLElement).closest('a[target]')) return;
    router.push(getRowHref(item));
  }, [router, getRowHref]);

  const hasMyFilter = !!userId && !!isMyItem;
  const showPagination = sorted.length > perPage;

  function getPageNumbers(): (number | 'ellipsis')[] {
    const pages: (number | 'ellipsis')[] = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      if (safePage > 3) pages.push('ellipsis');
      const start = Math.max(2, safePage - 1);
      const end = Math.min(totalPages - 1, safePage + 1);
      for (let i = start; i <= end; i++) pages.push(i);
      if (safePage < totalPages - 2) pages.push('ellipsis');
      pages.push(totalPages);
    }
    return pages;
  }

  const filtersApplied =
    !!searchQuery.trim() || Object.values(activeFilters).some(Boolean) || (myOnly && hasMyFilter) || (activeOnly && !!isActiveItem) || !!card;
  const canClear = !!searchQuery.trim() || Object.values(activeFilters).some(Boolean);
  const plural = `${entityLabel.toLowerCase()}s`;

  function clearFilters() {
    setSearchQuery('');
    setActiveFilters({});
  }

  const empty = (
    <div className="reveal px-6 py-12 text-center">
      <Inbox className="w-6 h-6 mx-auto text-stone-300 dark:text-stone-600" />
      <p className="mt-2 text-sm text-stone-600 dark:text-stone-300">
        {filtersApplied ? `No ${plural} match.` : `No ${plural} yet.`}
      </p>
      {canClear && (
        <button type="button" onClick={clearFilters} className={`${BTN_OUTLINE} mt-4 px-3 py-1.5`}>
          Clear filters
        </button>
      )}
    </div>
  );

  return (
    <div data-density={density} className="group/rows">
      {summary && <SummaryCards cards={summary} className="mb-4 grid-cols-2 lg:grid-cols-4" />}

      {/* ── Toolbar ──────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <label className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-stone-400 pointer-events-none dark:text-stone-500" />
            <input
              ref={searchRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={`Search ${plural}…`}
              className="pl-8.5 pr-8 py-2 text-[13px] rounded-xl border border-stone-200 dark:border-white/10 bg-white dark:bg-card text-stone-800 dark:text-stone-100 placeholder:text-stone-400 dark:placeholder:text-stone-500 focus:outline-none focus:ring-2 focus:ring-navy-200 dark:focus:ring-navy-500/30 w-52 sm:w-64 transition-shadow"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => { setSearchQuery(''); searchRef.current?.focus(); }}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 rounded text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 cursor-pointer"
                title="Clear search"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </label>

          <p className="text-[13px] text-stone-500 dark:text-stone-400 whitespace-nowrap">
            <span className="font-semibold text-stone-800 dark:text-stone-100 tabular-nums">{sorted.length}</span>{' '}
            {entityLabel}{sorted.length !== 1 ? 's' : ''}
            {myOnly && hasMyFilter && !canToggleMyItems && <span className="ml-1">· mine</span>}
            {card ? (
              <span className="ml-1">· {card.label.toLowerCase()}</span>
            ) : (
              activeOnly && isActiveItem && <span className="ml-1">· {activeLabel.replace(' Only', '').toLowerCase()}</span>
            )}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {filters?.map((f) => {
            const opts = filterOptions[f.key] ?? [];
            if (opts.length === 0) return null;
            const isOpen = openFilterKey === f.key;
            const selected = activeFilters[f.key];
            const fmt = f.formatOption ?? ((v: string) => v);
            return (
              <div key={f.key} className="relative" ref={isOpen ? filterMenuRef : undefined}>
                <button
                  type="button"
                  onClick={() => setOpenFilterKey(isOpen ? null : f.key)}
                  className={`${TOGGLE} ${selected ? TOGGLE_ON : TOGGLE_OFF}`}
                >
                  {selected ? fmt(selected) : f.label}
                  <ChevronDownIcon className={`w-3 h-3 transition-transform duration-150 ${isOpen ? 'rotate-180' : ''}`} />
                </button>
                {isOpen && (
                  <div className={`${MENU} min-w-[160px] max-h-80 overflow-y-auto`}>
                    <button
                      type="button"
                      onClick={() => { setActiveFilters((prev) => ({ ...prev, [f.key]: '' })); setOpenFilterKey(null); }}
                      className={`${MENU_ITEM} ${!selected ? MENU_ITEM_ON : 'text-stone-500 dark:text-stone-400'}`}
                    >
                      All
                    </button>
                    {opts.map((opt) => (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => { setActiveFilters((prev) => ({ ...prev, [f.key]: opt })); setOpenFilterKey(null); }}
                        className={`${MENU_ITEM} ${selected === opt ? MENU_ITEM_ON : 'text-stone-700 dark:text-stone-300'}`}
                      >
                        {fmt(opt)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {/* My items toggle — only shown for partners/super_users */}
          {hasMyFilter && canToggleMyItems && (
            <div className="inline-flex p-0.5 rounded-lg bg-stone-100 dark:bg-white/[0.06] text-xs" role="group" aria-label="Whose items">
              <button type="button" onClick={() => setMyOnly(true)} aria-pressed={myOnly} className={`${SEGMENT} ${myOnly ? SEGMENT_ON : SEGMENT_OFF}`}>
                Mine
              </button>
              <button type="button" onClick={() => setMyOnly(false)} aria-pressed={!myOnly} className={`${SEGMENT} ${!myOnly ? SEGMENT_ON : SEGMENT_OFF}`}>
                All
              </button>
            </div>
          )}

          {isActiveItem && !card && (
            <button type="button" onClick={() => setActiveOnly((o) => !o)} aria-pressed={activeOnly} className={`${TOGGLE} ${activeOnly ? TOGGLE_ON : TOGGLE_OFF}`}>
              {activeOnly && <Check className="w-3.5 h-3.5" />}
              {activeLabel.replace(' Only', '')}
            </button>
          )}

          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={() => setColMenuOpen((o) => !o)}
              className={`${TOGGLE} ${TOGGLE_OFF} px-2`}
              title="Columns"
              aria-label="Choose columns"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
            </button>

            {colMenuOpen && (
              <div className={`${MENU} min-w-[180px]`}>
                {columns.map((col) => (
                  <label key={col.key} className={`${MENU_ITEM} flex items-center gap-2.5 text-stone-700 dark:text-stone-300`}>
                    <input
                      type="checkbox"
                      checked={visibleCols[col.key]}
                      onChange={() =>
                        setVisibleCols((prev) => ({
                          ...prev,
                          [col.key]: !prev[col.key],
                        }))
                      }
                      className="rounded border-stone-300 dark:border-stone-600 dark:bg-stone-800 text-navy-700 focus:ring-navy-300 dark:focus:ring-navy-500/40 dark:text-navy-400"
                    />
                    {col.label}
                  </label>
                ))}
              </div>
            )}
          </div>

          <DensityToggle density={density} onChange={setDensity} iconOnly />
        </div>
      </div>

      {/* ── Desktop Table ────────────────────────────────────── */}
      <div className={`hidden md:block overflow-x-auto ${CARD}`}>
        {paginatedItems.length === 0 ? (
          empty
        ) : (
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-stone-100 dark:border-white/[0.06]">
                {activeColumns.map((col) => {
                  const isSorted = sortKey === col.key;
                  const canSort = col.sortable !== false;
                  return (
                    <th
                      key={col.key}
                      className={`px-4 py-2 text-left text-[11px] font-medium uppercase tracking-wider text-stone-400 dark:text-stone-500 ${
                        canSort ? 'cursor-pointer select-none hover:text-stone-700 dark:hover:text-stone-300 transition-colors duration-150' : ''
                      }`}
                      onClick={() => canSort && toggleSort(col.key)}
                      aria-sort={isSorted ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}
                    >
                      <span className="relative flex items-center gap-1 group/hdr">
                        {col.label}
                        {isSorted && (
                          sortDir === 'asc'
                            ? <ChevronUp className="w-3 h-3 text-navy-600 dark:text-navy-300" />
                            : <ChevronDown className="w-3 h-3 text-navy-600 dark:text-navy-300" />
                        )}
                        {col.headerTooltip && (
                          <span className="absolute left-0 top-full mt-1.5 px-3 py-2 text-[11px] leading-relaxed font-normal normal-case tracking-normal text-white bg-navy-800 rounded-lg whitespace-pre opacity-0 group-hover/hdr:opacity-100 transition-opacity duration-150 pointer-events-none shadow-lg z-30">
                            {col.headerTooltip}
                            <span className="absolute left-4 bottom-full w-0 h-0 border-l-4 border-r-4 border-b-4 border-l-transparent border-r-transparent border-b-navy-800" />
                          </span>
                        )}
                      </span>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100 dark:divide-white/[0.06]">
              {paginatedItems.map((item) => (
                <tr key={getRowId(item)} className="group hover:bg-stone-50/70 dark:hover:bg-white/[0.03] transition-colors">
                  {activeColumns.map((col, ci) => (
                    <td key={col.key} className="px-4 py-2 group-data-[density=comfortable]/rows:py-3.5">
                      {ci === 0 ? (
                        <>
                          {/* Compact: one line, the rest on hover. Comfortable: the name wraps and a detail line follows. */}
                          <PrefetchLink
                            href={getRowHref(item)}
                            title={String(col.getValue(item) ?? '')}
                            className={`${NAME_LINE} font-medium text-stone-900 dark:text-stone-50 group-hover:text-navy-800 dark:group-hover:text-navy-200 transition-colors`}
                          >
                            {col.render(item)}
                          </PrefetchLink>
                          {getRowDetail && <div className={DETAIL_LINE}>{getRowDetail(item)}</div>}
                        </>
                      ) : (
                        col.render(item)
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Mobile Cards ─────────────────────────────────────── */}
      <div className="md:hidden space-y-2">
        {paginatedItems.length === 0 ? (
          <div className={CARD}>{empty}</div>
        ) : (
          paginatedItems.map((item) => (
            <div
              key={getRowId(item)}
              onClick={(e) => handleCardClick(item, e)}
              onTouchStart={() => router.prefetch(getRowHref(item))}
              className={`${CARD} block p-4 hover:border-stone-300 dark:hover:border-white/20 transition-colors cursor-pointer`}
            >
              {activeColumns
                .filter((c) => !c.hiddenOnMobile)
                .map((col, ci) => (
                  <div key={col.key} className={ci === 0 ? 'mb-2' : 'flex items-center justify-between py-0.5'}>
                    {ci === 0 ? (
                      <>
                        <div className="text-sm font-medium text-stone-900 dark:text-stone-50">{col.render(item)}</div>
                        {getRowDetail && <div className={DETAIL_LINE}>{getRowDetail(item)}</div>}
                      </>
                    ) : (
                      <>
                        <span className="text-xs text-stone-400 dark:text-stone-500">{col.label}</span>
                        <span className="text-xs text-stone-600 dark:text-stone-300">{col.render(item)}</span>
                      </>
                    )}
                  </div>
                ))}
            </div>
          ))
        )}
      </div>

      {/* ── Pagination ───────────────────────────────────────── */}
      {showPagination && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 mt-4 px-1">
          <div className="flex items-center gap-2 text-xs text-stone-500 dark:text-stone-400">
            <span>Rows per page</span>
            <div className="inline-flex p-0.5 rounded-lg bg-stone-100 dark:bg-white/[0.06]" role="group" aria-label="Rows per page">
              {PAGE_SIZE_OPTIONS.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => { setPerPage(n); setPage(1); }}
                  aria-pressed={perPage === n}
                  className={`press px-2 py-0.5 rounded-md tabular-nums transition-all ${
                    perPage === n
                      ? 'bg-white dark:bg-card shadow-sm text-stone-900 dark:text-stone-50 font-medium'
                      : 'hover:text-stone-800 dark:hover:text-stone-100'
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-1">
            <button type="button" disabled={safePage <= 1} onClick={() => setPage(1)} className={PAGE_ARROW} title="First page">
              <ChevronsLeft className="w-4 h-4" />
            </button>
            <button type="button" disabled={safePage <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} className={PAGE_ARROW} title="Previous page">
              <ChevronLeft className="w-4 h-4" />
            </button>

            <div className="flex items-center gap-0.5 mx-1">
              {getPageNumbers().map((p, idx) =>
                p === 'ellipsis' ? (
                  <span key={`ellipsis-${idx}`} className="w-8 text-center text-sm text-stone-400 dark:text-stone-500 select-none">…</span>
                ) : (
                  <button key={p} type="button" onClick={() => setPage(p)}
                    aria-current={p === safePage ? 'page' : undefined}
                    className={`press min-w-[32px] h-8 rounded-lg text-[13px] font-medium tabular-nums transition-colors duration-150 cursor-pointer ${
                      p === safePage
                        ? 'bg-navy-800 text-white shadow-sm dark:bg-navy-600'
                        : 'text-stone-500 hover:text-stone-800 hover:bg-stone-100 dark:text-stone-400 dark:hover:text-stone-100 dark:hover:bg-white/5'
                    }`}>
                    {p}
                  </button>
                ),
              )}
            </div>

            <button type="button" disabled={safePage >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))} className={PAGE_ARROW} title="Next page">
              <ChevronRight className="w-4 h-4" />
            </button>
            <button type="button" disabled={safePage >= totalPages} onClick={() => setPage(totalPages)} className={PAGE_ARROW} title="Last page">
              <ChevronsRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
