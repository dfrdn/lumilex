import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';

/**
 * GET /api/chat/channels
 * List all channels the current user belongs to, with last message and unread count.
 */
export async function GET() {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const personId = session.user.notionUserId;
  const supabase = await getSupabaseServerAuthClient();

  // Fetch channels where user is a member
  const { data: channels, error } = await supabase
    .from('chat_channels')
    .select('*')
    .contains('member_ids', [personId])
    .order('updated_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!channels || channels.length === 0) {
    return NextResponse.json({ channels: [] });
  }

  // Fetch matter details (code + status) for matter channels
  const matterIds = channels
    .filter((c) => c.type === 'matter' && c.matter_id)
    .map((c) => c.matter_id!);
  const matterMap: Record<string, { matter_code: string | null; status: string | null }> = {};
  if (matterIds.length > 0) {
    const { data: matters } = await supabase
      .from('matters')
      .select('notion_id, matter_code, status')
      .in('notion_id', matterIds);
    for (const m of matters ?? []) {
      matterMap[(m as any).notion_id] = {
        matter_code: (m as any).matter_code ?? null,
        status: (m as any).status ?? null,
      };
    }
  }

  const channelIds = channels.map((c) => c.id);

  // Fetch last message per channel
  const { data: lastMessages } = await supabase
    .from('chat_messages')
    .select('*')
    .in('channel_id', channelIds)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  // Group: first message per channel_id is the latest
  const lastMsgMap: Record<string, typeof lastMessages extends (infer T)[] | null ? T : never> = {};
  for (const msg of lastMessages ?? []) {
    if (!lastMsgMap[msg.channel_id]) {
      lastMsgMap[msg.channel_id] = msg;
    }
  }

  // Fetch read receipts for this user
  const { data: receipts } = await supabase
    .from('chat_read_receipts')
    .select('channel_id, last_read_at')
    .eq('person_id', personId)
    .in('channel_id', channelIds);

  const receiptMap: Record<string, string> = {};
  for (const r of receipts ?? []) {
    receiptMap[r.channel_id] = r.last_read_at;
  }

  // Count unread messages per channel in a SINGLE query.
  // Fetch the id + channel_id + created_at of every non-deleted, non-self
  // message in the user's channels, then count in-memory. This replaces
  // the previous per-channel COUNT fan-out that could exceed serverless
  // timeouts for users with many matter channels.
  const { data: allMsgsForCount } = await supabase
    .from('chat_messages')
    .select('channel_id, created_at, sender_id')
    .in('channel_id', channelIds)
    .is('deleted_at', null)
    .neq('sender_id', personId);

  const unreadMap: Record<string, number> = {};
  for (const m of allMsgsForCount ?? []) {
    const lastReadAt = receiptMap[m.channel_id];
    if (!lastReadAt || new Date(m.created_at) > new Date(lastReadAt)) {
      unreadMap[m.channel_id] = (unreadMap[m.channel_id] ?? 0) + 1;
    }
  }

  // Batch-fetch every sender mentioned in the last-message set in ONE query
  const senderIds = Array.from(
    new Set(
      Object.values(lastMsgMap)
        .map((m) => (m as { sender_id?: string } | undefined)?.sender_id)
        .filter((id): id is string => !!id),
    ),
  );
  const senderInfoMap: Record<string, { name: string; initials: string; avatar_url: string | null }> = {};
  if (senderIds.length > 0) {
    const { data: senders } = await supabase
      .from('team')
      .select('person_id, name, initials, avatar_url')
      .in('person_id', senderIds);
    for (const s of senders ?? []) {
      senderInfoMap[(s as { person_id: string }).person_id] = {
        name: (s as { name: string }).name,
        initials: (s as { initials: string }).initials,
        avatar_url: (s as { avatar_url: string | null }).avatar_url || null,
      };
    }
  }

  const enriched = channels.map((ch) => {
    const lastMsg = lastMsgMap[ch.id] ?? null;
    let lastMessage = lastMsg;
    if (lastMsg) {
      const info = senderInfoMap[(lastMsg as { sender_id: string }).sender_id];
      lastMessage = {
        ...lastMsg,
        sender_name: info?.name ?? 'Unknown',
        sender_initials: info?.initials ?? '?',
        sender_avatar_url: info?.avatar_url ?? null,
      };
    }

    const matterInfo = ch.matter_id ? matterMap[ch.matter_id] : null;
    return {
      ...ch,
      last_message: lastMessage,
      unread_count: unreadMap[ch.id] ?? 0,
      matter_code: matterInfo?.matter_code ?? null,
      matter_status: matterInfo?.status ?? null,
    };
  });

  // Sort by last message time (channels with recent messages first)
  enriched.sort((a, b) => {
    const aTime = a.last_message?.created_at ?? a.updated_at;
    const bTime = b.last_message?.created_at ?? b.updated_at;
    return new Date(bTime).getTime() - new Date(aTime).getTime();
  });

  // Fetch ALL team members (including inactive) for name enrichment of existing channels
  const { data: allTeamMembers } = await supabase.from('team').select('person_id, name, initials, role, position, avatar_url, active');
  const allTeamMap: Record<string, { name: string; initials: string; role?: string; position?: string; avatar_url?: string | null; active?: boolean }> = {};
  for (const t of allTeamMembers ?? []) {
    allTeamMap[(t as any).person_id] = {
      name: (t as any).name,
      initials: (t as any).initials,
      role: (t as any).role,
      position: (t as any).position,
      avatar_url: (t as any).avatar_url || null,
      active: (t as any).active,
    };
  }

  // Active-only team map returned to the client (used for member picker)
  const teamMap: Record<string, { name: string; initials: string; role?: string; position?: string; avatar_url?: string | null }> = {};
  for (const [id, m] of Object.entries(allTeamMap)) {
    if (m.active) {
      teamMap[id] = {
        name: m.name,
        initials: m.initials,
        role: m.role,
        position: m.position,
        avatar_url: m.avatar_url ?? null,
      };
    }
  }

  // Enrich DM channels with the other person's name (using all members so inactive don't show as Unknown)
  const result = enriched.map((ch) => {
    if (ch.type === 'dm') {
      const otherPersonId = ch.member_ids.find((id: string) => id !== personId);
      const other = otherPersonId ? allTeamMap[otherPersonId] : null;
      return {
        ...ch,
        name: other?.name || 'Unknown',
        dm_initials: other?.initials || '?',
        dm_avatar_url: other?.avatar_url ?? null,
      };
    }
    return ch;
  });

  return NextResponse.json({ channels: result, team: teamMap });
}

/**
 * POST /api/chat/channels
 * Create a DM channel with another team member. Returns existing if already exists.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const personId = session.user.notionUserId;
  const body = await req.json();
  const { targetPersonId } = body;

  if (!targetPersonId || targetPersonId === personId) {
    return NextResponse.json({ error: 'Invalid target' }, { status: 400 });
  }

  // chat_channels has SELECT-only RLS for team users; channel creation needs
  // service-role until a team write policy lands.
  const supabase = getServiceDbForFirm(session.firmId);
  const memberIds = [personId, targetPersonId].sort();

  // Check if DM already exists
  const { data: existing } = await supabase
    .from('chat_channels')
    .select('*')
    .eq('type', 'dm')
    .contains('member_ids', memberIds)
    .single();

  if (existing) {
    return NextResponse.json({ channel: existing });
  }

  // Create new DM channel
  const { data: channel, error } = await supabase
    .from('chat_channels')
    .insert({
      type: 'dm',
      member_ids: memberIds,
      created_by: personId,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ channel }, { status: 201 });
}
