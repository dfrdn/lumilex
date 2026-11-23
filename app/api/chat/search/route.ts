import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';

/**
 * GET /api/chat/search?q=term&channelId=optional
 * Full-text search across chat messages in user's channels.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const personId = session.user.notionUserId;
  const supabase = getServiceDbForFirm(session.firmId);

  const searchParams = req.nextUrl.searchParams;
  const q = searchParams.get('q')?.trim();
  const channelId = searchParams.get('channelId');

  if (!q) {
    return NextResponse.json({ results: [] });
  }

  // Get user's channels
  const { data: channels } = await supabase
    .from('chat_channels')
    .select('id')
    .contains('member_ids', [personId]);

  const myChannelIds = (channels ?? []).map((c) => c.id);
  if (myChannelIds.length === 0) {
    return NextResponse.json({ results: [] });
  }

  // If channelId specified, verify membership
  const searchChannelIds = channelId && myChannelIds.includes(channelId)
    ? [channelId]
    : myChannelIds;

  // Full-text search using textSearch
  const { data: messages, error } = await supabase
    .from('chat_messages')
    .select('*')
    .in('channel_id', searchChannelIds)
    .is('deleted_at', null)
    .textSearch('content', q, { type: 'websearch' })
    .order('created_at', { ascending: false })
    .limit(30);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Resolve sender names
  const senderIds = [...new Set((messages ?? []).map((m) => m.sender_id))];
  const { data: senders } = await supabase
    .from('team')
    .select('person_id, name, initials, avatar_url')
    .in('person_id', senderIds.length > 0 ? senderIds : ['__none__']);

  const senderMap: Record<string, { name: string; initials: string; avatar_url: string | null }> = {};
  for (const s of senders ?? []) {
    senderMap[s.person_id] = { name: s.name, initials: s.initials, avatar_url: s.avatar_url || null };
  }

  // Resolve channel names
  const msgChannelIds = [...new Set((messages ?? []).map((m) => m.channel_id))];
  const { data: msgChannels } = await supabase
    .from('chat_channels')
    .select('id, name, type, matter_id')
    .in('id', msgChannelIds.length > 0 ? msgChannelIds : ['__none__']);

  const channelMap: Record<string, { name: string; type: string }> = {};
  for (const c of msgChannels ?? []) {
    channelMap[c.id] = { name: c.name ?? 'DM', type: c.type };
  }

  const results = (messages ?? []).map((m) => ({
    ...m,
    sender_name: senderMap[m.sender_id]?.name ?? 'Unknown',
    sender_initials: senderMap[m.sender_id]?.initials ?? '?',
    sender_avatar_url: senderMap[m.sender_id]?.avatar_url ?? null,
    channel_name: channelMap[m.channel_id]?.name ?? 'Unknown',
    channel_type: channelMap[m.channel_id]?.type ?? 'dm',
  }));

  return NextResponse.json({ results });
}
