import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';

/**
 * GET /api/chat/channels/[channelId]/read-receipts
 * Returns the last-read message ID + initials for all channel members.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ channelId: string }> },
) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { channelId } = await params;
  const personId = session.user.notionUserId;
  const supabase = getServiceDbForFirm(session.firmId);

  const { data: channel } = await supabase
    .from('chat_channels')
    .select('member_ids')
    .eq('id', channelId)
    .single();

  if (!channel || !channel.member_ids.includes(personId)) {
    return NextResponse.json({ error: 'Not a member' }, { status: 403 });
  }

  const { data: receipts } = await supabase
    .from('chat_read_receipts')
    .select('person_id, last_read_msg_id, last_read_at')
    .eq('channel_id', channelId);

  const personIds = (receipts ?? []).map((r) => r.person_id);
  const { data: members } = personIds.length > 0
    ? await supabase.from('team').select('person_id, name, initials, avatar_url').in('person_id', personIds)
    : { data: [] };

  const memberMap: Record<string, { name: string; initials: string; avatar_url: string | null }> = {};
  for (const m of members ?? []) {
    memberMap[m.person_id] = {
      name: m.name,
      initials: m.initials,
      avatar_url: (m as { avatar_url: string | null }).avatar_url || null,
    };
  }

  const result = (receipts ?? []).map((r) => ({
    person_id: r.person_id,
    last_read_msg_id: r.last_read_msg_id,
    last_read_at: r.last_read_at,
    initials: memberMap[r.person_id]?.initials ?? '?',
    name: memberMap[r.person_id]?.name ?? 'Unknown',
    avatar_url: memberMap[r.person_id]?.avatar_url ?? null,
  }));

  return NextResponse.json({ receipts: result });
}
