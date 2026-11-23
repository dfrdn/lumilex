import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { validateBody, knowledgeClickSchema } from '@/lib/validation';

/**
 * POST /api/knowledge/search/click
 *
 * Attributes a result click back to the `knowledge_searches` row that produced
 * it. The `clicked_source_*` columns existed since the table was created but
 * nothing ever wrote them, so click-through was unmeasurable. Scoped to the
 * caller's own search rows so a user can only annotate their own searches.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const validation = await validateBody(req, knowledgeClickSchema);
  if (!validation.success) return validation.response;
  const { searchId, sourceType, sourceId } = validation.data;

  // knowledge_searches has RLS disabled and is written via service-role on the
  // search path; mirror that here, constrained by person_id.
  const supabase = getServiceDbForFirm(session.firmId);
  const { error } = await supabase
    .from('knowledge_searches')
    .update({ clicked_source_type: sourceType, clicked_source_id: sourceId })
    .eq('id', searchId)
    .eq('person_id', session.user.notionUserId);

  if (error) {
    console.error('[knowledge-search] click update failed:', error.message);
    return NextResponse.json({ error: 'Failed to record click' }, { status: 500 });
  }

  return new NextResponse(null, { status: 204 });
}
