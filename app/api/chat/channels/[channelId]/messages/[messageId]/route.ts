import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';

/**
 * PATCH /api/chat/channels/[channelId]/messages/[messageId]
 * Edit a message's content. Only the original sender can edit, within 24h of send.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ channelId: string; messageId: string }> },
) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const content = typeof body?.content === 'string' ? body.content.trim() : '';
  if (!content) {
    return NextResponse.json({ error: 'Content is required' }, { status: 400 });
  }

  const { channelId, messageId } = await params;
  const personId = session.user.notionUserId;
  const supabase = getServiceDbForFirm(session.firmId);

  const { data: message } = await supabase
    .from('chat_messages')
    .select('id, sender_id, deleted_at, created_at')
    .eq('id', messageId)
    .eq('channel_id', channelId)
    .single();

  if (!message) return NextResponse.json({ error: 'Message not found' }, { status: 404 });
  if (message.sender_id !== personId) {
    return NextResponse.json({ error: 'Cannot edit another user\'s message' }, { status: 403 });
  }
  if (message.deleted_at) {
    return NextResponse.json({ error: 'Message was deleted' }, { status: 409 });
  }

  const ageMs = Date.now() - new Date(message.created_at).getTime();
  if (ageMs > 24 * 60 * 60 * 1000) {
    return NextResponse.json({ error: 'Edit window has passed' }, { status: 403 });
  }

  const now = new Date().toISOString();
  const { error } = await supabase
    .from('chat_messages')
    .update({ content, edited_at: now })
    .eq('id', messageId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

/**
 * DELETE /api/chat/channels/[channelId]/messages/[messageId]
 * Soft-delete (unsend) a message. Only the original sender can unsend.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ channelId: string; messageId: string }> },
) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { channelId, messageId } = await params;
  const personId = session.user.notionUserId;
  const supabase = getServiceDbForFirm(session.firmId);

  // Verify the message belongs to this sender
  const { data: message } = await supabase
    .from('chat_messages')
    .select('id, sender_id, deleted_at')
    .eq('id', messageId)
    .eq('channel_id', channelId)
    .single();

  if (!message) {
    return NextResponse.json({ error: 'Message not found' }, { status: 404 });
  }

  if (message.sender_id !== personId) {
    return NextResponse.json({ error: 'Cannot unsend another user\'s message' }, { status: 403 });
  }

  if (message.deleted_at) {
    return NextResponse.json({ error: 'Already deleted' }, { status: 409 });
  }

  const { error } = await supabase
    .from('chat_messages')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', messageId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
