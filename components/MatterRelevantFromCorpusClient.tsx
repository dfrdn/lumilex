'use client';

import useSWR from 'swr';
import Link from 'next/link';
import {
  Sparkles, Scale, FileText, BookOpen, Gavel, Handshake,
  Paperclip, ScrollText, ClipboardCheck, Mail, ArrowRight, Library, Quote, BookMarked,
} from 'lucide-react';
import type { EnrichedResult, KnowledgeCategory } from '@/lib/ai/knowledge-search';
import { trackKnowledgeClick } from '@/lib/knowledge-click';

interface Props {
  matterId: string;
  query: string;
}

interface SearchResponse {
  groups: Partial<Record<KnowledgeCategory, { count: number; results: EnrichedResult[] }>>;
  totalResults: number;
  searchId: number | null;
}

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

// The query is the matter's own summary, so it goes in a POST body: out of
// the URL, the request logs and the persisted SWR cache, which saves only
// '/api/...' keys and never this array key.
async function fetcher([, matterId, query]: [string, string, string]): Promise<SearchResponse> {
  const res = await fetch('/api/knowledge/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: query, excludeMatterId: matterId, limit: 6 }),
  });
  if (!res.ok) throw new Error(`Search failed: ${res.status}`);
  return res.json();
}

export default function MatterRelevantFromCorpusClient({ matterId, query }: Props) {
  const { data, isLoading, error } = useSWR<SearchResponse, Error, [string, string, string]>(
    ['matter-corpus', matterId, query],
    fetcher,
    { revalidateOnFocus: false },
  );

  // Flatten + take top 5 across all categories
  const top: EnrichedResult[] = [];
  if (data) {
    for (const group of Object.values(data.groups)) {
      if (group?.results) top.push(...group.results);
    }
    top.sort((a, b) => b.similarity - a.similarity);
  }
  const display = top.slice(0, 5);

  if (error) return null;
  if (!isLoading && display.length === 0) return null;

  const viewAllHref = `/dashboard/search?q=${encodeURIComponent(query)}`;

  return (
    <section className="rounded-xl border border-stone-200 dark:border-[rgba(255,255,255,0.08)] bg-card p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Sparkles className="w-4 h-4 text-gold-500 dark:text-gold-400" />
          Relevant from corpus
        </h3>
        {display.length > 0 && (
          <Link
            href={viewAllHref}
            className="inline-flex items-center gap-1 text-[11px] font-medium text-gold-700 dark:text-gold-300 hover:text-gold-600 dark:hover:text-gold-200 transition-colors"
          >
            View all
            <ArrowRight className="w-3 h-3" />
          </Link>
        )}
      </div>

      {isLoading && (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-12 rounded-lg bg-stone-100 dark:bg-stone-400/5 animate-pulse" />
          ))}
        </div>
      )}

      {!isLoading && display.length > 0 && (
        <ul className="space-y-2">
          {display.map((r) => {
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
                    {r.matterName && (
                      <p className="text-[11px] font-mono text-stone-500 dark:text-stone-400 truncate mt-0.5">
                        {r.matterName}
                      </p>
                    )}
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
