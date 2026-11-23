import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import {
  searchKnowledge,
  type KnowledgeCategory,
  CATEGORY_ORDER,
} from '@/lib/ai/knowledge-search';
import { DOCUMENT_TYPES } from '@/lib/document-type';
import { knowledgeSearchSchema, validateBody } from '@/lib/validation';

export const maxDuration = 30;

const VALID_CATEGORIES = new Set<KnowledgeCategory>(CATEGORY_ORDER);
const VALID_TYPES = new Set<string>(DOCUMENT_TYPES);

interface SearchParams {
  q: string;
  matterId: string | null;
  excludeMatterId: string | null;
  category: string | null;
  type: string | null;
  limit: number | null;
}

/**
 * GET /api/knowledge/search?q=&matterId=&excludeMatterId=&category=&type=&limit=
 * POST /api/knowledge/search with the same fields as JSON — for a query that
 * mustn't sit in a URL, such as a matter's summary (knowledgeSearchSchema).
 *
 * Faceted search over the firm's corpus: exact matches, then semantic ones.
 * Logs each query into `knowledge_searches` and returns the row id so a
 * later result click can be attributed back to it (POST .../search/click),
 * giving us click-through — which topics get queried AND which results land.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const sp = req.nextUrl.searchParams;
  const limit = sp.get('limit');
  return search(session.firmId, session.user.notionUserId, {
    q: sp.get('q') ?? '',
    matterId: sp.get('matterId'),
    excludeMatterId: sp.get('excludeMatterId'),
    category: sp.get('category'),
    type: sp.get('type'),
    limit: limit ? parseInt(limit, 10) || null : null,
  });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const validation = await validateBody(req, knowledgeSearchSchema);
  if (!validation.success) return validation.response;
  const b = validation.data;
  return search(session.firmId, session.user.notionUserId, {
    q: b.q,
    matterId: b.matterId ?? null,
    excludeMatterId: b.excludeMatterId ?? null,
    category: b.category ?? null,
    type: b.type ?? null,
    limit: b.limit ?? null,
  });
}

async function search(firmId: string, personId: string, params: SearchParams): Promise<NextResponse> {
  const q = params.q.trim();
  if (q.length < 2) {
    return NextResponse.json({ groups: {}, totalResults: 0, topSimilarity: null, query: q });
  }

  const matterId = params.matterId?.trim() || null;
  const excludeMatterId = params.excludeMatterId?.trim() || null;
  const categoryParam = params.category?.trim() as KnowledgeCategory | undefined;
  const category = categoryParam && VALID_CATEGORIES.has(categoryParam) ? categoryParam : undefined;
  const typeParam = params.type?.trim();
  const documentType = typeParam && VALID_TYPES.has(typeParam) ? typeParam : null;
  const limit = params.limit ? Math.max(1, Math.min(50, params.limit)) : 10;

  let results;
  try {
    results = await searchKnowledge(q, {
      firmId,
      matterId,
      excludeMatterId,
      category,
      documentType,
      limit,
      viewer: await getSupabaseServerAuthClient(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Search failed';
    console.error('[knowledge-search] error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }

  // Log the search and capture its id so a later result click can be
  // attributed back to this exact result set. One indexed insert — trivially
  // cheap next to the embedding + vector search above — so we await it.
  const searchId = await logSearch({
    firmId,
    query: q,
    personId,
    filterMatterId: matterId,
    filterCategory: category ?? null,
    resultCount: results.totalResults,
    topSimilarity: results.topSimilarity,
  });

  return NextResponse.json({
    ...results,
    query: q,
    searchId,
  });
}

async function logSearch(row: {
  firmId: string;
  query: string;
  personId: string;
  filterMatterId: string | null;
  filterCategory: string | null;
  resultCount: number;
  topSimilarity: number | null;
}): Promise<number | null> {
  try {
    const supabase = getServiceDbForFirm(row.firmId);
    const { data, error } = await supabase
      .from('knowledge_searches')
      .insert({
        query: row.query,
        person_id: row.personId,
        filter_matter_id: row.filterMatterId,
        filter_category: row.filterCategory,
        result_count: row.resultCount,
        top_similarity: row.topSimilarity,
      })
      .select('id')
      .single();
    if (error) throw error;
    return data?.id ?? null;
  } catch (err) {
    console.error('[knowledge-search] log insert failed:', err);
    return null;
  }
}
