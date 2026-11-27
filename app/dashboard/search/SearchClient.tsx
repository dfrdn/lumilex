'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import useSWR from 'swr';
import Link from 'next/link';
import { Library,
  Search, X, Scale, FileText, BookOpen, Gavel, Handshake,
  Paperclip, ScrollText, ClipboardCheck, Mail, Sparkles, Landmark, ExternalLink, Quote, ChevronDown, BookMarked,
} from 'lucide-react';
import EmptyState from '@/components/ui/EmptyState';
import CellDropdown, { type DropdownOption } from '@/components/admin/CellDropdown';
import { DOCUMENT_TYPES } from '@/lib/document-type';
import type {
  EnrichedResult,
  KnowledgeCategory,
} from '@/lib/ai/knowledge-search';
import type { JurisCaseHit, JurisRaHit } from '@/lib/juris';
import { trackKnowledgeClick } from '@/lib/knowledge-click';

interface MatterOption {
  notion_id: string;
  name: string;
  matter_code: string | null;
}

interface SearchResponse {
  groups: Partial<Record<KnowledgeCategory, { count: number; results: EnrichedResult[] }>>;
  totalResults: number;
  topSimilarity: number | null;
  query: string;
  searchId: number | null;
}

const CATEGORY_META: Record<KnowledgeCategory, { icon: typeof Scale; tone: string }> = {
  'Exact matches':  { icon: Quote,          tone: 'bg-gold-50 text-gold-800 dark:bg-gold-400/15 dark:text-gold-200 ring-gold-300/70 dark:ring-gold-400/30' },
  'Library':        { icon: Library,        tone: 'bg-violet-50 text-violet-800 dark:bg-violet-400/15 dark:text-violet-200 ring-violet-300/60 dark:ring-violet-400/30' },
  'Codes & Rules': { icon: BookMarked,     tone: 'bg-emerald-50 text-emerald-800 dark:bg-emerald-400/15 dark:text-emerald-200 ring-emerald-300/60 dark:ring-emerald-400/30' },
  'Matter Briefs':  { icon: Scale,          tone: 'bg-navy-100 text-navy-700 dark:bg-navy-400/15 dark:text-navy-200 ring-navy-200/60 dark:ring-navy-400/20' },
  'Pleadings':      { icon: ScrollText,     tone: 'bg-gold-100 text-gold-700 dark:bg-gold-400/15 dark:text-gold-300 ring-gold-200/60 dark:ring-gold-400/20' },
  'Memos':          { icon: FileText,       tone: 'bg-blue-100 text-blue-700 dark:bg-blue-400/15 dark:text-blue-300 ring-blue-200/60 dark:ring-blue-400/20' },
  'Client Letters': { icon: Mail,           tone: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-300 ring-emerald-200/60 dark:ring-emerald-400/20' },
  'Status Reports': { icon: ClipboardCheck, tone: 'bg-violet-100 text-violet-700 dark:bg-violet-400/15 dark:text-violet-300 ring-violet-200/60 dark:ring-violet-400/20' },
  'Hearings':       { icon: Gavel,          tone: 'bg-amber-100 text-amber-700 dark:bg-amber-400/15 dark:text-amber-300 ring-amber-200/60 dark:ring-amber-400/20' },
  'Meetings':       { icon: Handshake,      tone: 'bg-teal-100 text-teal-700 dark:bg-teal-400/15 dark:text-teal-300 ring-teal-200/60 dark:ring-teal-400/20' },
  'Files':          { icon: Paperclip,      tone: 'bg-stone-100 text-stone-700 dark:bg-stone-400/15 dark:text-stone-300 ring-stone-200/60 dark:ring-stone-400/20' },
  'Deliverables':   { icon: BookOpen,       tone: 'bg-rose-100 text-rose-700 dark:bg-rose-400/15 dark:text-rose-300 ring-rose-200/60 dark:ring-rose-400/20' },
};

const CATEGORY_ORDER: KnowledgeCategory[] = [
  'Exact matches', 'Library', 'Codes & Rules', 'Matter Briefs', 'Pleadings', 'Memos', 'Client Letters', 'Status Reports',
  'Hearings', 'Meetings', 'Files', 'Deliverables',
];

interface JurisResponse {
  cases: JurisCaseHit[];
  acts: JurisRaHit[];
  available: boolean;
  query: string;
}

type SearchSource = 'firm' | 'juris';

async function fetcher<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Search failed: ${res.status}`);
  return res.json();
}

interface Props {
  matters: MatterOption[];
}

export default function SearchClient({ matters }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Initial state from URL
  const initialQuery = searchParams.get('q') ?? '';
  const initialCategory = (searchParams.get('category') ?? '') as KnowledgeCategory | '';
  const initialMatterId = searchParams.get('matterId') ?? '';
  const initialType = searchParams.get('type') ?? '';
  const initialSource: SearchSource = searchParams.get('source') === 'juris' ? 'juris' : 'firm';

  const [input, setInput] = useState(initialQuery);
  const [debouncedQuery, setDebouncedQuery] = useState(initialQuery);
  const [category, setCategory] = useState<KnowledgeCategory | ''>(initialCategory);
  const [matterId, setMatterId] = useState(initialMatterId);
  const [docType, setDocType] = useState(initialType);
  const [source, setSource] = useState<SearchSource>(initialSource);

  // Debounce input → debouncedQuery
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(input.trim()), 150);
    return () => clearTimeout(t);
  }, [input]);

  // Push URL state for shareable links (replace, not push, to avoid bloating history)
  useEffect(() => {
    const params = new URLSearchParams();
    if (debouncedQuery) params.set('q', debouncedQuery);
    if (category) params.set('category', category);
    if (matterId) params.set('matterId', matterId);
    if (docType) params.set('type', docType);
    if (source === 'juris') params.set('source', 'juris');
    const qs = params.toString();
    router.replace(qs ? `/dashboard/search?${qs}` : '/dashboard/search', { scroll: false });
  }, [debouncedQuery, category, matterId, docType, source, router]);

  const swrKey = useMemo(() => {
    if (source !== 'firm' || debouncedQuery.length < 2) return null;
    const params = new URLSearchParams({ q: debouncedQuery, limit: '12' });
    if (category) params.set('category', category);
    if (matterId) params.set('matterId', matterId);
    if (docType) params.set('type', docType);
    return `/api/knowledge/search?${params.toString()}`;
  }, [source, debouncedQuery, category, matterId, docType]);

  const { data, isLoading: firmLoading, error } = useSWR<SearchResponse>(swrKey, fetcher, {
    keepPreviousData: true,
    revalidateOnFocus: false,
  });

  const jurisKey = source === 'juris' && debouncedQuery.length >= 2
    ? `/api/knowledge/jurisprudence?q=${encodeURIComponent(debouncedQuery)}`
    : null;
  const { data: juris, isLoading: jurisLoading, error: jurisError } = useSWR<JurisResponse>(
    jurisKey,
    fetcher,
    { keepPreviousData: true, revalidateOnFocus: false },
  );

  const isLoading = source === 'juris' ? jurisLoading : firmLoading;

  const totalCounts = useMemo(() => {
    const counts: Partial<Record<KnowledgeCategory, number>> = {};
    if (!data) return counts;
    for (const cat of CATEGORY_ORDER) {
      counts[cat] = data.groups[cat]?.count ?? 0;
    }
    return counts;
  }, [data]);

  const visibleCategories = useMemo(() => {
    if (!data) return [];
    return CATEGORY_ORDER.filter((c) => (data.groups[c]?.results.length ?? 0) > 0);
  }, [data]);

  const clearAll = useCallback(() => {
    setInput('');
    setDebouncedQuery('');
    setCategory('');
    setMatterId('');
    setDocType('');
  }, []);

  const typeOptions = useMemo<DropdownOption[]>(
    () => DOCUMENT_TYPES.map((t) => ({ id: t, label: t })),
    [],
  );
  const matterOptions = useMemo<DropdownOption[]>(
    () => matters.map((m) => ({ id: m.notion_id, label: m.name, sublabel: m.matter_code ?? undefined })),
    [matters],
  );

  const hasQuery = debouncedQuery.length >= 2;
  const totalResults = source === 'juris'
    ? (juris?.cases.length ?? 0) + (juris?.acts.length ?? 0)
    : data?.totalResults ?? 0;
  const showEmpty = hasQuery && !isLoading && totalResults === 0
    && (source !== 'juris' || juris?.available !== false);

  return (
    <div className="space-y-5">
      {/* Source tabs */}
      <div className="flex items-center gap-1 p-1 rounded-xl border border-stone-200 dark:border-[rgba(255,255,255,0.08)] bg-card w-fit">
        <SourceTab
          label="Firm documents"
          icon={Sparkles}
          active={source === 'firm'}
          onClick={() => setSource('firm')}
        />
        <SourceTab
          label="Jurisprudence"
          icon={Landmark}
          active={source === 'juris'}
          onClick={() => setSource('juris')}
        />
      </div>

      {/* Search input */}
      <div className="flex items-center gap-2 px-4 py-3 rounded-xl border border-stone-200 dark:border-[rgba(255,255,255,0.08)] bg-card focus-within:ring-2 focus-within:ring-gold-300 focus-within:border-gold-300 dark:focus-within:ring-gold-500/40 dark:focus-within:border-gold-500/50 transition-all">
        <Search className="w-5 h-5 text-stone-400 dark:text-stone-500 shrink-0" />
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={source === 'juris'
            ? 'Search SC decisions & Republic Acts by facts, issue, or doctrine…'
            : 'A phrase, a party, a docket number, or describe the document…'}
          className="flex-1 bg-transparent outline-none text-base placeholder:text-stone-400 dark:placeholder:text-stone-500"
          autoFocus
          spellCheck={false}
          autoComplete="off"
        />
        {(input || category || matterId || docType) && (
          <button
            type="button"
            onClick={clearAll}
            className="p-1 rounded text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 transition-colors"
            aria-label="Clear search"
          >
            <X className="w-4 h-4" />
          </button>
        )}
        {isLoading && (
          <div className="flex items-center gap-0.5 ml-1">
            <span className="w-1 h-1 rounded-full bg-gold-400 animate-pulse" />
            <span className="w-1 h-1 rounded-full bg-gold-400 animate-pulse [animation-delay:150ms]" />
            <span className="w-1 h-1 rounded-full bg-gold-400 animate-pulse [animation-delay:300ms]" />
          </div>
        )}
      </div>

      {/* Filters row (firm corpus only — juris.ph has no category/matter facets) */}
      {source === 'firm' && (
      <div className="flex flex-wrap items-center gap-2">
        <CategoryChip
          label="All"
          active={category === ''}
          count={totalResults}
          icon={Sparkles}
          tone="bg-stone-100 text-stone-700 dark:bg-stone-400/15 dark:text-stone-300 ring-stone-200/60 dark:ring-stone-400/20"
          onClick={() => setCategory('')}
          disabled={!hasQuery}
        />
        {CATEGORY_ORDER.map((cat) => {
          const count = totalCounts[cat] ?? 0;
          if (!hasQuery) return null; // hide until there's a query
          if (count === 0 && category !== cat) return null;
          const meta = CATEGORY_META[cat];
          return (
            <CategoryChip
              key={cat}
              label={cat}
              active={category === cat}
              count={count}
              icon={meta.icon}
              tone={meta.tone}
              onClick={() => setCategory(category === cat ? '' : cat)}
            />
          );
        })}

        <div className="ml-auto flex items-center gap-2">
          <FacetPicker
            label="Any type"
            value={docType}
            options={typeOptions}
            onChange={setDocType}
            searchPlaceholder="Document type…"
          />
          <FacetPicker
            label="All matters"
            value={matterId}
            options={matterOptions}
            onChange={setMatterId}
            searchPlaceholder="Find a matter…"
            minWidth={320}
          />
        </div>
      </div>
      )}

      {/* Status / error / empty */}
      {source === 'firm' && error && (
        <div className="px-4 py-3 rounded-lg border border-red-200 bg-red-50 dark:border-red-500/25 dark:bg-red-500/10 text-sm text-red-700 dark:text-red-300">
          Search error. Try again in a moment.
        </div>
      )}

      {source === 'juris' && (jurisError || juris?.available === false) && (
        <div className="px-4 py-3 rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-500/25 dark:bg-amber-500/10 text-sm text-amber-700 dark:text-amber-300">
          juris.ph is unreachable right now. Try again in a moment.
        </div>
      )}

      {!hasQuery && (
        <div className="px-4 py-12 text-center text-stone-500 dark:text-stone-400">
          <Search className="w-6 h-6 mx-auto mb-2 opacity-40" />
          <p className="text-sm">
            {source === 'juris'
              ? 'Describe the facts, issue, or doctrine — e.g. “warrantless search of a moving vehicle”.'
              : 'Search by the exact words a document contains, a party or docket number, or describe what you need in plain language.'}
          </p>
        </div>
      )}

      {showEmpty && (
        <EmptyState
          message={source === 'juris'
            ? `No matches for “${debouncedQuery}”. Try different words or fewer terms.`
            : `No matches for “${debouncedQuery}”. Try fewer words, the exact phrase in quotes, or a party name.`}
        />
      )}

      {/* Jurisprudence results (juris.ph) */}
      {source === 'juris' && hasQuery && juris && totalResults > 0 && (
        <div className="space-y-7">
          {juris.cases.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-3">
                <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-semibold rounded-full ring-1 ring-inset bg-navy-100 text-navy-700 dark:bg-navy-400/15 dark:text-navy-200 ring-navy-200/60 dark:ring-navy-400/20">
                  <Gavel className="w-3 h-3" />
                  Supreme Court Decisions
                </span>
                <span className="text-xs text-stone-400 dark:text-stone-500">
                  {juris.cases.length} {juris.cases.length === 1 ? 'match' : 'matches'}
                </span>
              </div>
              <div className="space-y-2">
                {juris.cases.map((c) => <JurisCaseCard key={c.id} hit={c} />)}
              </div>
            </section>
          )}
          {juris.acts.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-3">
                <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-semibold rounded-full ring-1 ring-inset bg-gold-100 text-gold-700 dark:bg-gold-400/15 dark:text-gold-300 ring-gold-200/60 dark:ring-gold-400/20">
                  <Landmark className="w-3 h-3" />
                  Republic Acts
                </span>
                <span className="text-xs text-stone-400 dark:text-stone-500">
                  {juris.acts.length} {juris.acts.length === 1 ? 'match' : 'matches'}
                </span>
              </div>
              <div className="space-y-2">
                {juris.acts.map((a) => <JurisRaCard key={a.id} hit={a} />)}
              </div>
            </section>
          )}
          <p className="text-[11px] text-stone-400 dark:text-stone-500">
            Results from juris.ph (sourced from lawphil). Summaries are AI-generated — verify
            against the full text before citing in a filing.
          </p>
        </div>
      )}

      {/* Results */}
      {source === 'firm' && hasQuery && data && visibleCategories.length > 0 && (
        <div className="space-y-7">
          {visibleCategories.map((cat) => {
            const group = data.groups[cat];
            if (!group) return null;
            const meta = CATEGORY_META[cat];
            const Icon = meta.icon;
            return (
              <section key={cat}>
                <div className="flex items-center gap-2 mb-3">
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-semibold rounded-full ring-1 ring-inset ${meta.tone}`}>
                    <Icon className="w-3 h-3" />
                    {cat}
                  </span>
                  <span className="text-xs text-stone-400 dark:text-stone-500">
                    {group.count} {group.count === 1 ? 'match' : 'matches'}
                  </span>
                </div>
                <div className="space-y-2">
                  {group.results.map((r) => (
                    <ResultCard key={`${r.sourceType}-${r.sourceId}`} result={r} query={debouncedQuery} searchId={data.searchId} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SourceTab({
  label, icon: Icon, active, onClick,
}: {
  label: string;
  icon: typeof Scale;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
        active
          ? 'bg-gold-50 text-gold-700 dark:bg-gold-400/15 dark:text-gold-300 ring-1 ring-inset ring-gold-300/60'
          : 'text-stone-500 dark:text-stone-400 hover:text-stone-700 dark:hover:text-stone-200'
      }`}
    >
      <Icon className="w-3.5 h-3.5" />
      {label}
    </button>
  );
}

function scorePill(score: number | undefined) {
  if (typeof score !== 'number') return null;
  const pct = Math.round(score * 100);
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 text-[10px] font-semibold rounded-full ring-1 ring-inset shrink-0 ${
        pct >= 60
          ? 'bg-emerald-50 text-emerald-700 ring-emerald-200/60 dark:bg-emerald-400/10 dark:text-emerald-300 dark:ring-emerald-400/20'
          : pct >= 45
            ? 'bg-amber-50 text-amber-700 ring-amber-200/60 dark:bg-amber-400/10 dark:text-amber-300 dark:ring-amber-400/20'
            : 'bg-stone-50 text-stone-600 ring-stone-200/60 dark:bg-stone-400/10 dark:text-stone-300 dark:ring-stone-400/20'
      }`}
      title="Semantic similarity"
    >
      {pct}%
    </span>
  );
}

function JurisCaseCard({ hit }: { hit: JurisCaseHit }) {
  return (
    <div className="group p-4 rounded-xl border border-stone-200 dark:border-[rgba(255,255,255,0.08)] bg-card hover:border-gold-300 dark:hover:border-gold-400/40 transition-all">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <a
            href={hit.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-foreground hover:text-gold-700 dark:hover:text-gold-300 transition-colors"
          >
            <span className="font-mono">{hit.case_number}</span>
            <ExternalLink className="w-3 h-3 opacity-50 shrink-0" />
          </a>
          <p className="text-[13px] text-stone-600 dark:text-stone-300 mt-0.5 line-clamp-2">{hit.case_title}</p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {hit.decision_date && (
            <span className="text-[10px] font-mono text-stone-400 dark:text-stone-500 tabular-nums">{hit.decision_date}</span>
          )}
          {scorePill(hit.score)}
        </div>
      </div>
      {hit.facts && (
        <p className="text-[13px] text-stone-600 dark:text-stone-300 mt-2 leading-relaxed line-clamp-3">{hit.facts}</p>
      )}
      {(hit.tags?.length ?? 0) > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {hit.tags!.slice(0, 5).map((t, i) => (
            <span key={i} className="px-1.5 py-0.5 text-[10px] font-medium rounded-full bg-stone-100 text-stone-600 dark:bg-stone-400/10 dark:text-stone-300">
              {t}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function JurisRaCard({ hit }: { hit: JurisRaHit }) {
  const raLabel = /^ra/i.test(hit.ra_number) || /republic/i.test(hit.ra_number)
    ? hit.ra_number
    : `RA ${hit.ra_number}`;
  return (
    <div className="group p-4 rounded-xl border border-stone-200 dark:border-[rgba(255,255,255,0.08)] bg-card hover:border-gold-300 dark:hover:border-gold-400/40 transition-all">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <a
            href={hit.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-foreground hover:text-gold-700 dark:hover:text-gold-300 transition-colors"
          >
            <span className="font-mono">{raLabel}</span>
            {hit.year && <span className="text-[11px] font-normal text-stone-400 dark:text-stone-500">({hit.year})</span>}
            <ExternalLink className="w-3 h-3 opacity-50 shrink-0" />
          </a>
          <p className="text-[13px] text-stone-600 dark:text-stone-300 mt-0.5 line-clamp-2">{hit.title}</p>
        </div>
        {scorePill(hit.score)}
      </div>
      {hit.summary && (
        <p className="text-[13px] text-stone-600 dark:text-stone-300 mt-2 leading-relaxed line-clamp-3">{hit.summary}</p>
      )}
    </div>
  );
}

function CategoryChip({
  label, active, count, icon: Icon, tone, onClick, disabled,
}: {
  label: string;
  active: boolean;
  count: number;
  icon: typeof Scale;
  tone: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full border transition-all ${
        active
          ? 'border-gold-400 bg-gold-50 text-gold-700 dark:bg-gold-400/15 dark:text-gold-300 ring-1 ring-gold-300/60'
          : disabled
            ? 'border-stone-200 dark:border-[rgba(255,255,255,0.06)] text-stone-300 dark:text-stone-600 cursor-not-allowed'
            : 'border-stone-200 dark:border-[rgba(255,255,255,0.08)] text-stone-600 dark:text-stone-300 hover:border-gold-300 dark:hover:border-gold-500/50 hover:bg-gold-50/40 dark:hover:bg-gold-400/8'
      }`}
    >
      <Icon className="w-3 h-3" />
      <span>{label}</span>
      {count > 0 && (
        <span className={`inline-flex items-center justify-center min-w-[1.25rem] h-4 px-1 text-[10px] font-semibold rounded-full ${active ? '' : 'bg-stone-100 dark:bg-stone-400/10'}`}>
          {count}
        </span>
      )}
    </button>
  );
}

function ResultCard({ result, query, searchId }: { result: EnrichedResult; query: string; searchId: number | null }) {
  const meta = CATEGORY_META[result.category];
  const Icon = meta.icon;
  const similarityPct = Math.round(result.similarity * 100);
  const snippetEl = result.highlighted
    ? <span dangerouslySetInnerHTML={{ __html: highlightInline(result.snippet, query) }} />
    : <>{result.snippet}</>;

  return (
    <div className="group p-4 rounded-xl border border-stone-200 dark:border-[rgba(255,255,255,0.08)] bg-card hover:border-gold-300 dark:hover:border-gold-400/40 transition-all">
      <div className="flex items-start gap-3">
        <span className={`inline-flex items-center justify-center w-7 h-7 rounded-lg ring-1 ring-inset shrink-0 ${meta.tone}`}>
          <Icon className="w-3.5 h-3.5" />
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              {result.deepLinkHref ? (
                <Link
                  href={result.deepLinkHref}
                  onClick={() => trackKnowledgeClick(searchId, result.sourceType, result.sourceId)}
                  className="text-sm font-semibold text-foreground hover:text-gold-700 dark:hover:text-gold-300 transition-colors block truncate"
                >
                  {result.displayLabel}
                </Link>
              ) : (
                <p className="text-sm font-semibold text-foreground truncate">{result.displayLabel}</p>
              )}
              {result.matterName && (
                <p className="text-[11px] font-mono text-stone-500 dark:text-stone-400 mt-0.5 truncate">
                  {result.matterId ? (
                    <Link href={`/dashboard/matters/${result.matterId}`} className="hover:text-gold-600 dark:hover:text-gold-300 transition-colors">
                      {result.matterName}
                    </Link>
                  ) : (
                    result.matterName
                  )}
                </p>
              )}
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {result.exact && (
                <span
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-semibold rounded-full ring-1 ring-inset bg-gold-50 text-gold-800 ring-gold-300/70 dark:bg-gold-400/15 dark:text-gold-200 dark:ring-gold-400/30"
                  title="Contains these exact words"
                >
                  <Quote className="w-2.5 h-2.5" />
                  Exact
                </span>
              )}
              {result.documentType && (
                <span className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium rounded-full bg-stone-100 text-stone-600 dark:bg-stone-400/10 dark:text-stone-300 whitespace-nowrap">
                  {result.documentType}
                </span>
              )}
              {result.chunkMatchCount > 1 && (
                <span className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium rounded-full bg-stone-100 text-stone-600 dark:bg-stone-400/10 dark:text-stone-300">
                  {result.chunkMatchCount} chunks
                </span>
              )}
              {!result.exact && (
              <span
                className={`inline-flex items-center px-1.5 py-0.5 text-[10px] font-semibold rounded-full ring-1 ring-inset ${
                  similarityPct >= 60
                    ? 'bg-emerald-50 text-emerald-700 ring-emerald-200/60 dark:bg-emerald-400/10 dark:text-emerald-300 dark:ring-emerald-400/20'
                    : similarityPct >= 45
                      ? 'bg-amber-50 text-amber-700 ring-amber-200/60 dark:bg-amber-400/10 dark:text-amber-300 dark:ring-amber-400/20'
                      : 'bg-stone-50 text-stone-600 ring-stone-200/60 dark:bg-stone-400/10 dark:text-stone-300 dark:ring-stone-400/20'
                }`}
                title="How closely the meaning matches"
              >
                {similarityPct}%
              </span>
              )}
            </div>
          </div>
          <p className="text-[13px] text-stone-600 dark:text-stone-300 mt-2 leading-relaxed line-clamp-3">
            {snippetEl}
          </p>
        </div>
      </div>
    </div>
  );
}

// A filter button that opens the shared CellDropdown, so the Search page uses
// the same picker as every other form instead of the browser's native select.
function FacetPicker({
  label, value, options, onChange, searchPlaceholder, minWidth,
}: {
  label: string;
  value: string;
  options: DropdownOption[];
  onChange: (id: string) => void;
  searchPlaceholder?: string;
  minWidth?: number;
}) {
  const ref = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.id === value);
  return (
    <>
      <button
        type="button"
        ref={ref}
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-all max-w-[16rem] ${
          selected
            ? 'border-gold-300 bg-gold-50 text-gold-700 dark:bg-gold-400/10 dark:text-gold-300 dark:border-gold-500/30'
            : 'border-stone-200 dark:border-[rgba(255,255,255,0.08)] bg-card text-stone-600 dark:text-stone-300 hover:border-stone-300 dark:hover:border-stone-600'
        }`}
      >
        <span className="truncate">{selected ? selected.label : label}</span>
        <ChevronDown className={`w-3 h-3 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <CellDropdown
          mode="single"
          value={value || null}
          options={options}
          onSelect={(id) => { onChange(id ?? ''); setOpen(false); }}
          onClose={() => setOpen(false)}
          anchorRef={ref}
          placeholder={searchPlaceholder}
          minWidth={minWidth ?? 240}
        />
      )}
    </>
  );
}

// Lightweight client-side highlight (the server already centered the window).
// Mirrors the same token rules as makeSnippet on the server.
function highlightInline(text: string, query: string): string {
  const tokens = query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= 3);
  if (tokens.length === 0) return escapeHtml(text);
  const pattern = new RegExp('(' + tokens.map(escapeRegex).join('|') + ')', 'gi');
  return escapeHtml(text).replace(pattern, '<mark class="bg-gold-100 dark:bg-gold-400/20 text-inherit rounded-sm px-0.5 font-semibold">$1</mark>');
}
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
