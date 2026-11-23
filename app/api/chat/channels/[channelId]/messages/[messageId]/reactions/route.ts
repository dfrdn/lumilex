import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';

/**
 * POST /api/chat/channels/[channelId]/messages/[messageId]/reactions
 * Toggle a reaction emoji on a message (add if absent, remove if present).
 * Returns the updated reactions map: Record<emoji, person_ids[]>
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ channelId: string; messageId: string }> },
) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { channelId, messageId } = await params;
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

  const body = await req.json();
  const { emoji } = body;
  if (!emoji || typeof emoji !== 'string') {
    return NextResponse.json({ error: 'Invalid emoji' }, { status: 400 });
  }

  // Check if reaction already exists
  const { data: existing } = await supabase
    .from('chat_reactions')
    .select('emoji')
    .eq('message_id', messageId)
    .eq('person_id', personId)
    .eq('emoji', emoji)
    .maybeSingle();

  if (existing) {
    // Remove reaction
    await supabase
      .from('chat_reactions')
      .delete()
      .eq('message_id', messageId)
      .eq('person_id', personId)
      .eq('emoji', emoji);
  } else {
    // Add reaction
    await supabase
      .from('chat_reactions')
      .insert({ message_id: messageId, channel_id: channelId, person_id: personId, emoji });
  }

  // Return updated reactions for this message
  const { data: rows } = await supabase
    .from('chat_reactions')
    .select('emoji, person_id')
    .eq('message_id', messageId);

  const reactions: Record<string, string[]> = {};
  for (const r of rows ?? []) {
    if (!reactions[r.emoji]) reactions[r.emoji] = [];
    reactions[r.emoji].push(r.person_id);
  }

  return NextResponse.json({ reactions });
}
