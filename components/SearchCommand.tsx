'use client';

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
  Search, Scale, FileText, CheckSquare, Handshake,
  Gavel, FolderOpen, Users, Paperclip, X, Sparkles, BookOpen,
  ScrollText, ClipboardCheck, Mail, Compass, ArrowRight, Library, Quote, BookMarked,
} from 'lucide-react';
import type { SearchEntityType, SearchResult, SearchResponse } from '@/types/search';
import { useSession } from '@/components/SessionProvider';
import { areaForPath, visiblePages, searchPages } from '@/lib/nav/pages';
import { useFeatures } from '@/components/FeatureProvider';
import type { EnrichedResult, KnowledgeCategory } from '@/lib/ai/knowledge-search';

// ── Entity metadata ──────────────────────────────────────────────

const GROUP_ORDER: SearchEntityType[] = [
  'matters', 'clients', 'deliverables', 'tasks',
  'meetings', 'hearings', 'filings', 'files',
];

const ENTITY_META: Record<SearchEntityType, { label: string; icon: typeof Scale }> = {
  matters:      { label: 'Matters',      icon: Scale },
  deliverables: { label: 'Deliverables', icon: FileText },
  tasks:        { label: 'Tasks',        icon: CheckSquare },
  meetings:     { label: 'Meetings',     icon: Handshake },
  hearings:     { label: 'Hearings',     icon: Gavel },
  filings:      { label: 'Filings',      icon: FolderOpen },
  clients:      { label: 'Clients',      icon: Users },
  files:        { label: 'Files',        icon: Paperclip },
};

// ── Semantic mode metadata ───────────────────────────────────────

type Mode = 'navigate' | 'semantic';
const MODE_STORAGE_KEY = 'lumilex:searchMode';

const CATEGORY_ICON: Record<KnowledgeCategory, typeof Scale> = {
  'Exact matches': Quote,
  'Library': Library,
  'Codes & Rules': BookMarked,
  'Matter Briefs':  Scale,
  'Pleadings':      ScrollText,
  'Memos':          FileText,
  'Client Letters': Mail,
  'Status Reports': ClipboardCheck,
  'Hearings':       Gavel,
  'Meetings':       Handshake,
  'Files':          Paperclip,
  'Deliverables':   BookOpen,
};

interface SemanticSearchResponse {
  groups: Partial<Record<KnowledgeCategory, { count: number; results: EnrichedResult[] }>>;
  totalResults: number;
  topSimilarity: number | null;
  query: string;
}

// Auto-suggest semantic mode when query looks issue-style (long / has question words).
const QUESTION_TOKENS = new Set(['what', 'how', 'why', 'when', 'where', 'who', 'which']);
function looksSemanticIntent(q: string): boolean {
  const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length > 3) return true;
  return tokens.some((t) => QUESTION_TOKENS.has(t));
}

// ── Match highlighting ───────────────────────────────────────────

function HighlightMatch({ text, query }: { text: string; query: string }) {
  if (!query || query.length < 2) return <>{text}</>;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-gold-100 dark:bg-gold-400/20 text-inherit rounded-sm px-0.5 font-semibold">
        {text.slice(idx, idx + query.length)}
      </mark>
      {text.slice(idx + query.length)}
    </>
  );
}

// ── Component ────────────────────────────────────────────────────

export default function SearchBar() {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<Mode>('navigate');
  const [results, setResults] = useState<Record<string, SearchResult[]>>({});
  const [semanticResults, setSemanticResults] = useState<EnrichedResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [focused, setFocused] = useState(false);
  // Tracks whether the user has explicitly navigated with the keyboard.
  // Without this gate, result re-renders would fire scrollIntoView against
  // a freshly mounted button at index 0 and the browser would scroll the
  // whole page to bring it into view on every keystroke.
  const userNavigatedRef = useRef(false);

  const showDropdown = focused && query.length >= 2;

  // Pages of the app whose name, description or keywords match, listed after
  // the records, since people mostly search for documents.
  // The pages of the sidebar the user is in: team, admin or finance.
  const role = useSession().data?.user?.role ?? 'lawyer';
  const area = areaForPath(usePathname());
  const flags = useFeatures();
  const pageMatches = useMemo(
    () => (mode === 'navigate' && query.trim().length >= 2 ? searchPages(visiblePages(role, area, flags), query).slice(0, 4) : []),
    [mode, query, role, area, flags],
  );

  // Flatten results for keyboard navigation. In semantic mode the list is
  // already a single flat sequence (sorted by similarity); in navigate mode
  // we walk GROUP_ORDER to keep group ordering stable.
  const flatResults = useMemo(() => {
    if (mode === 'semantic') {
      return semanticResults.map((r) => ({
        id: `${r.sourceType}-${r.sourceId}`,
        href: r.deepLinkHref ?? '#',
      }));
    }
    const items: { id: string; href: string }[] = [];
    for (const type of GROUP_ORDER) {
      if (results[type]) {
        for (const r of results[type]) items.push({ id: r.id, href: r.href });
      }
    }
    for (const p of pageMatches) items.push({ id: `page:${p.href}`, href: p.href });
    return items;
  }, [mode, results, semanticResults, pageMatches]);

  // Reset active index when results change. Also reset the navigation flag
  // so the scroll effect stays dormant until the user presses arrow keys.
  useEffect(() => {
    setActiveIndex(0);
    userNavigatedRef.current = false;
  }, [flatResults.length]);

  // Global Cmd/Ctrl+K shortcut
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  // Restore mode preference from previous session
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(MODE_STORAGE_KEY);
      if (saved === 'navigate' || saved === 'semantic') setMode(saved);
    } catch {
      // ignore (private mode, etc.)
    }
  }, []);

  const setModeAndPersist = useCallback((next: Mode) => {
    setMode(next);
    try {
      window.localStorage.setItem(MODE_STORAGE_KEY, next);
    } catch {
      // ignore
    }
  }, []);

  // Click outside to close dropdown
  useEffect(() => {
    if (!showDropdown) return;
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setFocused(false);
      }
    }
    document.addEventListener('mousedown', handleClick, true);
    return () => document.removeEventListener('mousedown', handleClick, true);
  }, [showDropdown]);

  // Debounced search — hits a different endpoint depending on mode
  useEffect(() => {
    if (!query || query.length < 2) {
      setResults({});
      setSemanticResults([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const controller = new AbortController();
    const timeout = setTimeout(async () => {
      try {
        if (mode === 'semantic') {
          const res = await fetch(
            `/api/knowledge/search?q=${encodeURIComponent(query)}&limit=8`,
            { signal: controller.signal },
          );
          if (res.ok) {
            const data: SemanticSearchResponse = await res.json();
            // Flatten groups into a single similarity-sorted list for the palette.
            const flat: EnrichedResult[] = [];
            for (const group of Object.values(data.groups)) {
              if (group?.results) flat.push(...group.results);
            }
            flat.sort((a, b) => b.similarity - a.similarity);
            setSemanticResults(flat.slice(0, 12));
            setResults({});
          }
        } else {
          const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`, {
            signal: controller.signal,
          });
          if (res.ok) {
            const data: SearchResponse = await res.json();
            setResults(data.results);
            setSemanticResults([]);
          }
        }
      } catch (err) {
        if (!(err instanceof DOMException && err.name === 'AbortError')) {
          console.error('[search] fetch error:', err);
        }
      } finally {
        setLoading(false);
      }
    }, 150);

    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [query, mode]);

  // Scroll active item into view — but only within the results container,
  // and only after the user has actually pressed arrow keys. Using
  // element.scrollIntoView() here walks every scrollable ancestor and will
  // scroll the whole page, which is the source of the "page jumps on every
  // keystroke" bug. We compute the target scrollTop manually instead.
  useEffect(() => {
    if (!userNavigatedRef.current) return;
    const item = itemRefs.current[activeIndex];
    const list = listRef.current;
    if (!item || !list) return;
    const itemTop = item.offsetTop;
    const itemBottom = itemTop + item.offsetHeight;
    if (itemTop < list.scrollTop) {
      list.scrollTop = itemTop;
    } else if (itemBottom > list.scrollTop + list.clientHeight) {
      list.scrollTop = itemBottom - list.clientHeight;
    }
  }, [activeIndex]);

  const navigateTo = useCallback(
    (href: string) => {
      router.push(href);
      setFocused(false);
      setQuery('');
      setResults({});
      setSemanticResults([]);
      inputRef.current?.blur();
    },
    [router],
  );

  const viewAllInSearch = useCallback(() => {
    if (!query) return;
    router.push(`/dashboard/search?q=${encodeURIComponent(query)}`);
    setFocused(false);
    setQuery('');
    setResults({});
    setSemanticResults([]);
    inputRef.current?.blur();
  }, [query, router]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault();
      setModeAndPersist(mode === 'navigate' ? 'semantic' : 'navigate');
      userNavigatedRef.current = false;
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      userNavigatedRef.current = true;
      setActiveIndex((i) => Math.min(i + 1, flatResults.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      userNavigatedRef.current = true;
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && flatResults[activeIndex]) {
      e.preventDefault();
      const href = flatResults[activeIndex].href;
      if (href && href !== '#') navigateTo(href);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setFocused(false);
      inputRef.current?.blur();
    }
  }

  // Build grouped display with flat index tracking (navigate mode only).
  // Page matches take the last indexes, matching flatResults.
  let flatIdx = 0;
  const groupedDisplay: { type: SearchEntityType; items: { result: SearchResult; index: number }[] }[] = [];
  if (mode === 'navigate') {
    for (const type of GROUP_ORDER) {
      if (results[type] && results[type].length > 0) {
        const items = results[type].map((r) => ({ result: r, index: flatIdx++ }));
        groupedDisplay.push({ type, items });
      }
    }
  }

  const pageStartIdx = flatIdx;

  // Semantic display: flat indexed list
  const semanticIndexed = mode === 'semantic'
    ? semanticResults.map((result, index) => ({ result, index }))
    : [];

  const hasResults = flatResults.length > 0;
  const showEmpty = query.length >= 2 && !loading && !hasResults;
  const suggestSemantic = mode === 'navigate' && query.length >= 2 && looksSemanticIntent(query);

  const [mobileExpanded, setMobileExpanded] = useState(false);

  return (
    <div ref={containerRef} className="relative sm:flex-1 sm:max-w-md ml-auto sm:ml-0">
      {/* Mobile: search icon button */}
      <button
        type="button"
        onClick={() => { setMobileExpanded(true); setTimeout(() => inputRef.current?.focus(), 100); }}
        className="sm:hidden p-1.5 rounded-lg text-navy-400 dark:text-[#9B978F] hover:text-white hover:bg-navy-800 dark:hover:bg-[#232326] transition-colors"
      >
        <Search className="w-4 h-4" />
      </button>

      {/* Mobile: expanded search overlay */}
      {mobileExpanded && (
        <div className="sm:hidden fixed inset-x-0 top-0 z-50 p-3 bg-navy-950 dark:bg-[#0F0F0F]">
          <div className="flex items-center gap-2 px-3 py-2 bg-navy-800 dark:bg-[#232326] rounded-lg ring-1 ring-gold-400/40">
            <Search className="w-3.5 h-3.5 text-navy-400 dark:text-[#9B978F] shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={() => setFocused(true)}
              onKeyDown={(e) => { if (e.key === 'Escape') { setMobileExpanded(false); setQuery(''); setFocused(false); } handleKeyDown(e); }}
              placeholder="Search..."
              className="flex-1 bg-transparent text-sm text-white placeholder:text-navy-500 dark:placeholder:text-[var(--text-muted)] outline-none min-w-0"
              autoComplete="off"
              spellCheck={false}
              autoFocus
            />
            <button
              onClick={() => { setMobileExpanded(false); setQuery(''); setResults({}); setFocused(false); }}
              className="p-0.5 rounded text-navy-400 dark:text-[#9B978F] hover:text-white transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Desktop: inline search input */}
      <div className={`hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg transition-all duration-150 ${
        focused
          ? 'bg-navy-800 dark:bg-[#232326] ring-1 ring-gold-400/40'
          : 'bg-navy-800/50 dark:bg-[rgba(255,255,255,0.04)] hover:bg-navy-800 dark:hover:bg-[#232326]'
      }`}>
        <Search className="w-3.5 h-3.5 text-navy-400 dark:text-[#9B978F] shrink-0" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setFocused(true)}
          onKeyDown={handleKeyDown}
          placeholder="Search..."
          className="flex-1 bg-transparent text-sm text-white placeholder:text-navy-500 dark:placeholder:text-[var(--text-muted)] outline-none min-w-0"
          autoComplete="off"
          spellCheck={false}
        />
        {loading && (
          <div className="flex items-center gap-0.5">
            <span className="w-1 h-1 rounded-full bg-gold-400 animate-pulse" />
            <span className="w-1 h-1 rounded-full bg-gold-400 animate-pulse [animation-delay:150ms]" />
            <span className="w-1 h-1 rounded-full bg-gold-400 animate-pulse [animation-delay:300ms]" />
          </div>
        )}
        {query ? (
          <button
            onClick={() => { setQuery(''); setResults({}); inputRef.current?.focus(); }}
            className="p-0.5 rounded text-navy-400 dark:text-[#9B978F] hover:text-white transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        ) : (
          <kbd className="hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-mono text-navy-500 dark:text-[var(--text-muted)] bg-navy-900/50 dark:bg-[rgba(255,255,255,0.04)] rounded border border-navy-700/50 dark:border-[rgba(255,255,255,0.06)]">
            ⌘K
          </kbd>
        )}
      </div>

      {/* Results dropdown */}
      {showDropdown && (
        <div className="fixed sm:absolute inset-x-3 sm:inset-x-0 top-16 sm:top-full mt-0 sm:mt-2 bg-card rounded-xl shadow-[var(--shadow-elevated)] border border-[var(--border-color)] overflow-hidden z-50">
          {/* Gold accent line */}
          <div className="absolute top-0 left-4 right-4 h-px bg-gradient-to-r from-transparent via-gold-400/40 to-transparent" />

          {/* Mode toggle */}
          <div className="flex items-center gap-1 px-2 py-1.5 border-b border-[var(--border-color)]">
            <button
              type="button"
              onClick={() => setModeAndPersist('navigate')}
              className={`flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors ${
                mode === 'navigate'
                  ? 'bg-subtle text-foreground'
                  : 'text-[var(--text-muted)] hover:text-foreground'
              }`}
            >
              <Compass className="w-3 h-3" />
              Navigate
            </button>
            <button
              type="button"
              onClick={() => setModeAndPersist('semantic')}
              className={`flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors ${
                mode === 'semantic'
                  ? 'bg-subtle text-foreground'
                  : 'text-[var(--text-muted)] hover:text-foreground'
              }`}
            >
              <Sparkles className="w-3 h-3" />
              Search
            </button>
            <span className="ml-auto text-[10px] text-[var(--text-muted)]">
              <kbd className="inline-flex items-center justify-center h-4 px-1 text-[9px] font-mono bg-card rounded border border-[var(--border-color)] mr-1">
                Tab
              </kbd>
              switch
            </span>
          </div>

          {/* Auto-suggest hint */}
          {suggestSemantic && (
            <button
              type="button"
              onClick={() => setModeAndPersist('semantic')}
              className="w-full flex items-center gap-2 px-4 py-2 text-[11px] text-gold-700 dark:text-gold-300 bg-gold-50/60 dark:bg-gold-400/10 hover:bg-gold-100 dark:hover:bg-gold-400/15 transition-colors text-left"
            >
              <Sparkles className="w-3 h-3 shrink-0" />
              Looks like a research question. Switch to Search mode to look across document contents.
            </button>
          )}

          <div
            ref={listRef}
            className="max-h-[60vh] overflow-y-auto overscroll-contain"
            role="listbox"
          >
            {/* Empty state */}
            {showEmpty && (
              <div className="px-4 py-8 text-center">
                <Search className="w-6 h-6 text-[var(--text-muted)] mx-auto mb-2 opacity-30" />
                <p className="text-sm text-[var(--text-muted)]">
                  No {mode === 'semantic' ? 'matches' : 'results'} for &ldquo;{query}&rdquo;
                </p>
              </div>
            )}

            {/* Semantic flat list */}
            {mode === 'semantic' && hasResults && (
              <div className="py-1.5">
                {semanticIndexed.map(({ result, index }) => {
                  const Icon = CATEGORY_ICON[result.category] ?? FileText;
                  const isActive = index === activeIndex;
                  const similarityPct = Math.round(result.similarity * 100);
                  return (
                    <button
                      key={`${result.sourceType}-${result.sourceId}`}
                      ref={(el) => { itemRefs.current[index] = el; }}
                      role="option"
                      aria-selected={isActive}
                      onClick={() => result.deepLinkHref && navigateTo(result.deepLinkHref)}
                      onMouseEnter={() => setActiveIndex(index)}
                      disabled={!result.deepLinkHref}
                      className={`w-full text-left flex items-start gap-3 px-4 py-2 transition-all duration-100 cursor-pointer group ${
                        isActive
                          ? 'bg-subtle border-l-2 border-gold-400 pl-[14px]'
                          : 'border-l-2 border-transparent hover:bg-subtle/50'
                      } disabled:opacity-60 disabled:cursor-not-allowed`}
                    >
                      <Icon className={`w-3.5 h-3.5 mt-0.5 shrink-0 transition-colors duration-100 ${
                        isActive ? 'text-gold-400' : 'text-[var(--text-muted)]'
                      }`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <p className={`text-sm truncate transition-colors duration-100 ${
                            isActive ? 'text-foreground font-medium' : 'text-[var(--text-secondary)] group-hover:text-foreground'
                          }`}>
                            {result.displayLabel}
                          </p>
                          <span className="text-[10px] font-semibold text-[var(--text-muted)] shrink-0" title={result.exact ? 'Contains these exact words' : undefined}>
                            {result.exact ? 'Exact' : `${similarityPct}%`}
                          </span>
                        </div>
                        {result.matterName && (
                          <p className="text-[10px] font-mono text-[var(--text-muted)] truncate mt-0.5">
                            {result.matterName}
                          </p>
                        )}
                        <p className="text-[11px] text-[var(--text-muted)] mt-0.5 line-clamp-1">
                          {result.snippet}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Grouped results (navigate mode) */}
            {mode === 'navigate' && hasResults && (
              <div className="py-1.5">
                {groupedDisplay.map((group, gi) => {
                  const meta = ENTITY_META[group.type];
                  return (
                    <div
                      key={group.type}
                      className="animate-fade-up"
                      style={{ animationDelay: `${gi * 50}ms`, animationFillMode: 'both' }}
                    >
                      {/* Group header */}
                      <div className="flex items-center gap-2 px-4 pt-2.5 pb-1">
                        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
                          {meta.label}
                        </span>
                        <div className="flex-1 h-px bg-[var(--border-color)]" />
                      </div>

                      {/* Items */}
                      {group.items.map(({ result, index }) => {
                        const Icon = ENTITY_META[result.entityType].icon;
                        const isActive = index === activeIndex;
                        return (
                          <button
                            key={result.id}
                            ref={(el) => { itemRefs.current[index] = el; }}
                            role="option"
                            aria-selected={isActive}
                            onClick={() => navigateTo(result.href)}
                            onMouseEnter={() => setActiveIndex(index)}
                            className={`w-full text-left flex items-center gap-3 px-4 py-2 transition-all duration-100 cursor-pointer group ${
                              isActive
                                ? 'bg-subtle border-l-2 border-gold-400 pl-[14px]'
                                : 'border-l-2 border-transparent hover:bg-subtle/50'
                            }`}
                          >
                            <Icon className={`w-3.5 h-3.5 shrink-0 transition-colors duration-100 ${
                              isActive ? 'text-gold-400' : 'text-[var(--text-muted)]'
                            }`} />
                            <div className="flex-1 min-w-0">
                              <p className={`text-sm truncate transition-colors duration-100 ${
                                isActive ? 'text-foreground font-medium' : 'text-[var(--text-secondary)] group-hover:text-foreground'
                              }`}>
                                <HighlightMatch text={result.name} query={query} />
                              </p>
                              {result.subtitle && (
                                <p className="text-[11px] font-mono text-[var(--text-muted)] truncate mt-0.5">
                                  {result.subtitle}
                                  {result.semantic && (
                                    <span className="ml-1.5 inline-flex items-center gap-0.5 px-1 py-0 text-[9px] font-semibold rounded bg-gold-50 text-gold-600 dark:bg-gold-400/12 dark:text-gold-400 ring-1 ring-inset ring-gold-200/60 dark:ring-gold-400/20">
                                      ✦ AI
                                    </span>
                                  )}
                                </p>
                              )}
                              {result.snippet && (
                                <p className="text-[10px] text-[var(--text-muted)] truncate mt-0.5 italic">
                                  {result.snippet}
                                </p>
                              )}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  );
                })}
                {pageMatches.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 px-4 pt-2.5 pb-1">
                      <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
                        Pages
                      </span>
                      <div className="flex-1 h-px bg-[var(--border-color)]" />
                    </div>
                    {pageMatches.map((page, i) => {
                      const index = pageStartIdx + i;
                      const isActive = index === activeIndex;
                      return (
                        <button
                          key={page.href}
                          ref={(el) => { itemRefs.current[index] = el; }}
                          role="option"
                          aria-selected={isActive}
                          onClick={() => navigateTo(page.href)}
                          onMouseEnter={() => setActiveIndex(index)}
                          className={`w-full text-left flex items-center gap-3 px-4 py-2 transition-all duration-100 cursor-pointer group ${
                            isActive
                              ? 'bg-subtle border-l-2 border-gold-400 pl-[14px]'
                              : 'border-l-2 border-transparent hover:bg-subtle/50'
                          }`}
                        >
                          <page.icon className={`w-3.5 h-3.5 shrink-0 transition-colors duration-100 ${
                            isActive ? 'text-gold-400' : 'text-[var(--text-muted)]'
                          }`} />
                          <div className="flex-1 min-w-0">
                            <p className={`text-sm truncate transition-colors duration-100 ${
                              isActive ? 'text-foreground font-medium' : 'text-[var(--text-secondary)] group-hover:text-foreground'
                            }`}>
                              <HighlightMatch text={page.label} query={query} />
                            </p>
                            <p className="text-[11px] text-[var(--text-muted)] truncate mt-0.5">{page.description}</p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Footer — keyboard hints + (in semantic mode) view all */}
          {(hasResults || query.length >= 2) && (
            <div className="flex items-center gap-3 px-4 py-2 border-t border-[var(--border-color)] bg-subtle/50">
              <div className="flex items-center gap-1">
                <kbd className="inline-flex items-center justify-center w-4 h-4 text-[9px] font-mono text-[var(--text-muted)] bg-card rounded border border-[var(--border-color)]">
                  ↑
                </kbd>
                <kbd className="inline-flex items-center justify-center w-4 h-4 text-[9px] font-mono text-[var(--text-muted)] bg-card rounded border border-[var(--border-color)]">
                  ↓
                </kbd>
                <span className="text-[10px] text-[var(--text-muted)] ml-0.5">navigate</span>
              </div>
              <div className="flex items-center gap-1">
                <kbd className="inline-flex items-center justify-center h-4 px-1 text-[9px] font-mono text-[var(--text-muted)] bg-card rounded border border-[var(--border-color)]">
                  ↵
                </kbd>
                <span className="text-[10px] text-[var(--text-muted)] ml-0.5">open</span>
              </div>
              <div className="flex items-center gap-1">
                <kbd className="inline-flex items-center justify-center h-4 px-1 text-[9px] font-mono text-[var(--text-muted)] bg-card rounded border border-[var(--border-color)]">
                  esc
                </kbd>
                <span className="text-[10px] text-[var(--text-muted)] ml-0.5">close</span>
              </div>
              {mode === 'semantic' && (
                <button
                  type="button"
                  onClick={viewAllInSearch}
                  className="ml-auto inline-flex items-center gap-1 text-[10px] font-medium text-gold-700 dark:text-gold-300 hover:text-gold-600 dark:hover:text-gold-200 transition-colors"
                >
                  View all in Search
                  <ArrowRight className="w-3 h-3" />
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
