'use client';

import { useState, useEffect, useMemo } from 'react';
import useSWR from 'swr';
import Link from 'next/link';
import {
  Search, Scale, FileText, BookOpen, Gavel, Handshake,
  Paperclip, ScrollText, ClipboardCheck, Mail, Library, Quote, BookMarked,
} from 'lucide-react';
import type { EnrichedResult, KnowledgeCategory } from '@/lib/ai/knowledge-search';
import { trackKnowledgeClick } from '@/lib/knowledge-click';

interface Props {
  matterId: string;
}

interface SearchResponse {
  groups: Partial<Record<KnowledgeCategory, { count: number; results: EnrichedResult[] }>>;
  totalResults: number;
  searchId: number | null;
}

const CATEGORY_ICON: Record<KnowledgeCategory, typeof Scale> = {
  'Exact matches': Quote,
  'Library': Library,
  'Rules of Court': BookMarked,
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

async function fetcher(url: string): Promise<SearchResponse> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Search failed: ${res.status}`);
  return res.json();
}

/**
 * Human-driven semantic search scoped to a single matter (passes matterId →
 * filter_matter_id). Distinct from the auto-fired "Relevant from corpus" panel,
 * which searches *other* matters via excludeMatterId.
 */
export default function MatterKnowledgeSearch({ matterId }: Props) {
  const [input, setInput] = useState('');
  const [debounced, setDebounced] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setDebounced(input.trim()), 200);
    return () => clearTimeout(t);
  }, [input]);

  const swrKey = useMemo(() => {
    if (debounced.length < 2) return null;
    const params = new URLSearchParams({ q: debounced, matterId, limit: '8' });
    return `/api/knowledge/search?${params.toString()}`;
  }, [debounced, matterId]);

  const { data, isLoading } = useSWR<SearchResponse>(swrKey, fetcher, {
    keepPreviousData: true,
    revalidateOnFocus: false,
  });

  const results = useMemo(() => {
    const out: EnrichedResult[] = [];
    if (data) {
      for (const g of Object.values(data.groups)) {
        if (g?.results) out.push(...g.results);
      }
      out.sort((a, b) => b.similarity - a.similarity);
    }
    return out;
  }, [data]);

  const hasQuery = debounced.length >= 2;

  return (
    <section className="rounded-xl border border-stone-200 dark:border-[rgba(255,255,255,0.08)] bg-card p-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground mb-3">
        <Search className="w-4 h-4 text-gold-500 dark:text-gold-400" />
        Search this matter
      </h3>

      <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-stone-200 dark:border-[rgba(255,255,255,0.08)] bg-[var(--card-bg)] focus-within:ring-2 focus-within:ring-gold-300 focus-within:border-gold-300 transition-all">
        <Search className="w-4 h-4 text-stone-400 dark:text-stone-500 shrink-0" />
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Search this matter's pleadings, files, hearings…"
          className="flex-1 bg-transparent outline-none text-sm placeholder:text-stone-400 dark:placeholder:text-stone-500"
          spellCheck={false}
          autoComplete="off"
        />
        {isLoading && (
          <div className="flex items-center gap-0.5">
            <span className="w-1 h-1 rounded-full bg-gold-400 animate-pulse" />
            <span className="w-1 h-1 rounded-full bg-gold-400 animate-pulse [animation-delay:150ms]" />
            <span className="w-1 h-1 rounded-full bg-gold-400 animate-pulse [animation-delay:300ms]" />
          </div>
        )}
      </div>

      {hasQuery && !isLoading && results.length === 0 && (
        <p className="text-[13px] text-stone-500 dark:text-stone-400 mt-3 px-1">
          No matches in this matter for &ldquo;{debounced}&rdquo;.
        </p>
      )}

      {results.length > 0 && (
        <ul className="space-y-2 mt-3">
          {results.map((r) => {
            const Icon = CATEGORY_ICON[r.category] ?? FileText;
            const similarityPct = Math.round(r.similarity * 100);
            return (
              <li key={`${r.sourceType}-${r.sourceId}`}>
                <Link
                  href={r.deepLinkHref ?? '#'}
                  onClick={() => trackKnowledgeClick(data?.searchId, r.sourceType, r.sourceId)}
                  className={`flex items-start gap-2.5 p-2.5 rounded-lg border border-transparent hover:border-stone-200 dark:hover:border-[rgba(255,255,255,0.08)] hover:bg-stone-50/60 dark:hover:bg-stone-400/5 transition-all ${
                    !r.deepLinkHref ? 'pointer-events-none opacity-60' : ''
                  }`}
                >
                  <Icon className="w-3.5 h-3.5 mt-0.5 shrink-0 text-stone-400 dark:text-stone-500" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium text-foreground truncate">{r.displayLabel}</p>
                      <span className="text-[10px] font-semibold text-stone-400 dark:text-stone-500 shrink-0" title={r.exact ? 'Contains these exact words' : undefined}>
                        {r.exact ? 'Exact' : `${similarityPct}%`}
                      </span>
                    </div>
                    <p className="text-[11px] text-stone-500 dark:text-stone-400 line-clamp-1 mt-0.5">
                      {r.snippet}
                    </p>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
