import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import type { SearchEntityType, SearchResult, SearchResponse } from '@/types/search';

const LIMIT_PER_TYPE = 5;

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const q = req.nextUrl.searchParams.get('q')?.trim();
  if (!q || q.length < 2) {
    return NextResponse.json({ results: {}, query: q ?? '' } satisfies SearchResponse);
  }

  // global_search is a plain STABLE SQL function, so on the authed client the
  // caller's RLS applies inside it — the firm-scoped service proxy can't reach
  // into an RPC, and service-role would search every firm's rows.
  const supabase = await getSupabaseServerAuthClient();

  const { data, error } = await supabase.rpc('global_search', {
    search_term: q,
    max_per_type: LIMIT_PER_TYPE,
  });

  if (error) {
    console.error('[search] RPC error:', error.message);
    return NextResponse.json({ results: {}, query: q } satisfies SearchResponse);
  }

  const results: Record<string, SearchResult[]> = {};
  for (const row of data ?? []) {
    const entityType = row.entity_type as SearchEntityType;
    if (!results[entityType]) results[entityType] = [];
    results[entityType].push({
      id: row.id,
      name: row.name,
      entityType,
      href: row.route,
      subtitle: row.subtitle,
    });
  }

  return NextResponse.json({ results, query: q } satisfies SearchResponse);
}
