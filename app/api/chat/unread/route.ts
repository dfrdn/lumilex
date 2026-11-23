import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';

/**
 * GET /api/chat/unread
 * Get total and per-channel unread message counts for the current user.
 */
export async function GET() {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const personId = session.user.notionUserId;
  const supabase = getServiceDbForFirm(session.firmId);

  // Get all channels user belongs to
  const { data: channels } = await supabase
    .from('chat_channels')
    .select('id')
    .contains('member_ids', [personId]);

  if (!channels || channels.length === 0) {
    return NextResponse.json({ total: 0, channels: {} });
  }

  const channelIds = channels.map((c) => c.id);

  // Get read receipts
  const { data: receipts } = await supabase
    .from('chat_read_receipts')
    .select('channel_id, last_read_at')
    .eq('person_id', personId)
    .in('channel_id', channelIds);

  const receiptMap: Record<string, string> = {};
  for (const r of receipts ?? []) {
    receiptMap[r.channel_id] = r.last_read_at;
  }

  // Count unread per channel in a SINGLE query. The previous per-channel
  // COUNT fan-out (Promise.all × N) could exceed serverless timeouts for
  // users with many matter channels.
  const { data: allMsgs } = await supabase
    .from('chat_messages')
    .select('channel_id, created_at, mentions')
    .in('channel_id', channelIds)
    .is('deleted_at', null)
    .neq('sender_id', personId);

  let total = 0;
  const channelCounts: Record<string, number> = {};
  const mentionCounts: Record<string, number> = {};

  for (const m of allMsgs ?? []) {
    const lastReadAt = receiptMap[m.channel_id];
    if (!lastReadAt || new Date(m.created_at) > new Date(lastReadAt)) {
      channelCounts[m.channel_id] = (channelCounts[m.channel_id] ?? 0) + 1;
      total += 1;
      // Track mentions of the current user
      if (Array.isArray(m.mentions) && m.mentions.includes(personId)) {
        mentionCounts[m.channel_id] = (mentionCounts[m.channel_id] ?? 0) + 1;
      }
    }
  }

  return NextResponse.json({ total, channels: channelCounts, mention_counts: mentionCounts });
}
