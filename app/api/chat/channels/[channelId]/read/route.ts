import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';

/**
 * POST /api/chat/channels/[channelId]/read
 * Mark a channel as read up to the latest message.
 */
export async function POST(
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

  // Verify membership
  const { data: channel } = await supabase
    .from('chat_channels')
    .select('member_ids')
    .eq('id', channelId)
    .single();

  if (!channel || !channel.member_ids.includes(personId)) {
    return NextResponse.json({ error: 'Not a member' }, { status: 403 });
  }

  // Get the latest message
  const { data: latestMsg } = await supabase
    .from('chat_messages')
    .select('id, created_at')
    .eq('channel_id', channelId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  const now = new Date().toISOString();

  await supabase
    .from('chat_read_receipts')
    .upsert(
      {
        channel_id: channelId,
        person_id: personId,
        last_read_at: latestMsg?.created_at ?? now,
        last_read_msg_id: latestMsg?.id ?? null,
      },
      { onConflict: 'channel_id,person_id' },
    );

  return NextResponse.json({ ok: true });
}
