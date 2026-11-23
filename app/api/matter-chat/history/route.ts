import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';

/**
 * GET /api/matter-chat/history?matterId=xxx&limit=50
 * Returns chat messages for a matter, ordered by created_at ASC.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const matterId = req.nextUrl.searchParams.get('matterId');
  const limit = parseInt(req.nextUrl.searchParams.get('limit') || '50', 10);

  if (!matterId) {
    return NextResponse.json({ error: 'matterId is required' }, { status: 400 });
  }

  const supabase = getServiceDbForFirm(session.firmId);

  const { data: messages, error } = await supabase
    .from('chat_messages')
    .select('id, role, content, sources, user_name, created_at')
    .eq('matter_id', matterId)
    .order('created_at', { ascending: true })
    .limit(limit);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ messages: messages || [] });
}
