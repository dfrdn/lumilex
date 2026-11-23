import { NextResponse, after } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { generateMentionNotifications } from '@/lib/notifications';

export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const personId = session.user.notionUserId;
  const { deliverableId, comment, mentions, parentType, parentId } = await req.json();

  if (!deliverableId || !comment?.trim()) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  const supabase = await getSupabaseServerAuthClient();

  try {
    const { data, error } = await supabase
      .from('deliverable_comments')
      .insert({
        firm_id: session.firmId,
        deliverable_id: deliverableId,
        parent_type: parentType || null,
        parent_id: parentId || null,
        comment: comment.trim(),
        mentions: mentions?.map((m: { id: string }) => m.id) ?? [],
        person_id: personId,
      })
      .select()
      .single();

    if (error) throw error;

    // Resolve "replied to" targets. A thread lives under a specific
    // (deliverable, parent_type, parent_id); everyone who commented earlier
    // in that thread is part of the conversation, so notify them all when
    // someone posts a reply.
    //
    // parent_type is 'version' or 'action' in the current UX. Future
    // 'comment' parent_type walks to the parent directly.
    let replyToAuthorIds: string[] = [];
    if (parentType === 'comment' && parentId) {
      const { data: parent } = await supabase
        .from('deliverable_comments')
        .select('person_id, deliverable_id')
        .eq('id', parentId)
        .single();
      if (parent?.deliverable_id === deliverableId && parent?.person_id) {
        replyToAuthorIds = [parent.person_id];
      }
    } else if ((parentType === 'version' || parentType === 'action') && parentId != null) {
      const { data: priorComments } = await supabase
        .from('deliverable_comments')
        .select('person_id')
        .eq('deliverable_id', deliverableId)
        .eq('parent_type', parentType)
        .eq('parent_id', parentId)
        .neq('id', data.id);
      const unique = new Set<string>();
      for (const c of priorComments ?? []) {
        if (c.person_id) unique.add(c.person_id);
      }
      replyToAuthorIds = [...unique];
    }

    // Notify mentioned users and/or thread participants after the response is sent
    if ((mentions && mentions.length > 0) || replyToAuthorIds.length > 0) {
      after(() =>
        generateMentionNotifications({
          firmId: session.firmId,
          notionId: deliverableId,
          mentions: mentions ?? [],
          comment: comment.trim(),
          performedBy: personId,
          replyToAuthorIds,
        }).catch((err) => console.error('[deliverable-comment] Mention notification failed:', err.message)),
      );
    }

    return NextResponse.json({ comment: data }, { status: 201 });
  } catch (err) {
    console.error('[deliverable-comment]', err);
    return NextResponse.json({ error: 'Failed to create comment' }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const personId = session.user.notionUserId;
  const { id, comment, mentions } = await req.json();

  if (!id || !comment?.trim()) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  const supabase = await getSupabaseServerAuthClient();

  try {
    // Verify ownership
    const { data: existing, error: fetchError } = await supabase
      .from('deliverable_comments')
      .select('person_id')
      .eq('id', id)
      .single();

    if (fetchError || !existing) {
      return NextResponse.json({ error: 'Comment not found' }, { status: 404 });
    }
    if (existing.person_id !== personId) {
      return NextResponse.json({ error: 'You can only edit your own comments' }, { status: 403 });
    }

    const { error } = await supabase
      .from('deliverable_comments')
      .update({
        comment: comment.trim(),
        mentions: mentions?.map((m: { id: string }) => m.id) ?? [],
      })
      .eq('id', id);

    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[deliverable-comment] PATCH', err);
    return NextResponse.json({ error: 'Failed to update comment' }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const personId = session.user.notionUserId;
  const { id } = await req.json();

  if (!id) {
    return NextResponse.json({ error: 'Missing comment id' }, { status: 400 });
  }

  const supabase = await getSupabaseServerAuthClient();

  try {
    // Verify ownership
    const { data: existing, error: fetchError } = await supabase
      .from('deliverable_comments')
      .select('person_id')
      .eq('id', id)
      .single();

    if (fetchError || !existing) {
      return NextResponse.json({ error: 'Comment not found' }, { status: 404 });
    }
    if (existing.person_id !== personId) {
      return NextResponse.json({ error: 'You can only delete your own comments' }, { status: 403 });
    }

    const { error } = await supabase
      .from('deliverable_comments')
      .delete()
      .eq('id', id);

    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[deliverable-comment] DELETE', err);
    return NextResponse.json({ error: 'Failed to delete comment' }, { status: 500 });
  }
}
