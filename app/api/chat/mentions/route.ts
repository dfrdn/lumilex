import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';

/**
 * GET /api/chat/mentions?limit=50&before=<messageId>
 * Returns messages where the authenticated user appears in `mentions`.
 * Newest-first. Enriched with sender name, channel name, and unread flag.
 *
 * Auth: Bearer (mobile) or cookie (web) via getSession().
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const personId = session.user.notionUserId;
  const supabase = getServiceDbForFirm(session.firmId);

  const searchParams = req.nextUrl.searchParams;
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '50', 10), 100);
  const before = searchParams.get('before');

  let query = supabase
    .from('chat_messages')
    .select('*')
    .contains('mentions', [personId])
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (before) {
    const { data: cursorMsg } = await supabase
      .from('chat_messages')
      .select('created_at')
      .eq('id', before)
      .single();
    if (cursorMsg) query = query.lt('created_at', cursorMsg.created_at);
  }

  const { data: messages, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const msgs = messages ?? [];
  const channelIds = [...new Set(msgs.map((m) => m.channel_id))];
  const senderIds = [...new Set(msgs.map((m) => m.sender_id))];

  const [channelsRes, sendersRes, receiptsRes] = await Promise.all([
    channelIds.length
      ? supabase.from('chat_channels').select('id, type, name, matter_id').in('id', channelIds)
      : Promise.resolve({ data: [] as Array<{ id: string; type: string; name: string | null; matter_id: string | null }> }),
    senderIds.length
      ? supabase.from('team').select('person_id, name, initials').in('person_id', senderIds)
      : Promise.resolve({ data: [] as Array<{ person_id: string; name: string; initials: string }> }),
    channelIds.length
      ? supabase
          .from('chat_read_receipts')
          .select('channel_id, last_read_at')
          .eq('person_id', personId)
          .in('channel_id', channelIds)
      : Promise.resolve({ data: [] as Array<{ channel_id: string; last_read_at: string }> }),
  ]);

  const channelMap = new Map((channelsRes.data ?? []).map((c) => [c.id, c]));
  const senderMap = new Map((sendersRes.data ?? []).map((s) => [s.person_id, s]));
  const lastReadMap = new Map((receiptsRes.data ?? []).map((r) => [r.channel_id, r.last_read_at]));

  const enriched = msgs.map((m) => {
    const lastRead = lastReadMap.get(m.channel_id);
    const channel = channelMap.get(m.channel_id);
    const sender = senderMap.get(m.sender_id);
    return {
      ...m,
      sender_name: sender?.name ?? 'Unknown',
      sender_initials: sender?.initials ?? '?',
      channel_name: channel?.name ?? null,
      channel_type: channel?.type ?? null,
      matter_id: channel?.matter_id ?? null,
      unread: !lastRead || new Date(m.created_at) > new Date(lastRead),
    };
  });

  return NextResponse.json({
    mentions: enriched,
    has_more: msgs.length === limit,
  });
}
