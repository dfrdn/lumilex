import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { searchJurisprudence, searchRepublicActs } from '@/lib/juris';

/**
 * GET /api/knowledge/jurisprudence?q=...
 * Federates the knowledge-search query to juris.ph (public SC decisions +
 * Republic Acts index). No firm data leaves the server except the query text.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const q = req.nextUrl.searchParams.get('q')?.trim() ?? '';
  if (q.length < 2) {
    return NextResponse.json({ cases: [], acts: [], available: true, query: q });
  }

  const [cases, acts] = await Promise.all([
    searchJurisprudence(q, { limit: 8 }),
    searchRepublicActs(q, { limit: 5 }),
  ]);

  return NextResponse.json({
    cases: cases ?? [],
    acts: acts ?? [],
    available: cases !== null || acts !== null,
    query: q,
  });
}
