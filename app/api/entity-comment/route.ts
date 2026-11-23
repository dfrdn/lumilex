import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { generateEntityCommentNotifications } from '@/lib/notifications';
import { sanitizeCommentHtml } from '@/lib/sanitize-comment';

type EntityType = 'hearing' | 'meeting' | 'task' | 'file';

function isEntityType(v: unknown): v is EntityType {
  return v === 'hearing' || v === 'meeting' || v === 'task' || v === 'file';
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const personId = session.user.notionUserId;
  const { entityType, entityId, bodyHtml, mentions, replyToId } = await req.json();

  if (!isEntityType(entityType) || !entityId || typeof bodyHtml !== 'string') {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  const cleanHtml = sanitizeCommentHtml(bodyHtml);
  if (!cleanHtml.replace(/<[^>]+>/g, '').trim()) {
    return NextResponse.json({ error: 'Comment is empty' }, { status: 400 });
  }

  const mentionIds: string[] = Array.isArray(mentions)
    ? mentions.filter((m: unknown): m is string => typeof m === 'string')
    : [];

  const supabase = await getSupabaseServerAuthClient();

  try {
    const { data, error } = await supabase
      .from('entity_comments')
      .insert({
        firm_id: session.firmId,
        entity_type: entityType,
        entity_id: entityId,
        reply_to_id: typeof replyToId === 'number' ? replyToId : null,
        body_html: cleanHtml,
        mentions: mentionIds,
        person_id: personId,
      })
      .select()
      .single();

    if (error) throw error;

    // Resolve reply targets: every prior participant in this thread gets
    // pinged when someone replies. A "thread" is anchored on the top-level
    // comment, so for a reply we collect (parent author) + (everyone else
    // who has replied under the same parent).
    let replyToAuthorIds: string[] = [];
    if (typeof replyToId === 'number') {
      const { data: parent } = await supabase
        .from('entity_comments')
        .select('person_id, entity_type, entity_id')
        .eq('id', replyToId)
        .single();
      if (parent && parent.entity_id === entityId && parent.entity_type === entityType) {
        const ids = new Set<string>();
        if (parent.person_id) ids.add(parent.person_id);
        const { data: siblings } = await supabase
          .from('entity_comments')
          .select('person_id')
          .eq('reply_to_id', replyToId)
          .neq('id', data.id);
        for (const s of siblings ?? []) {
          if (s.person_id) ids.add(s.person_id);
        }
        replyToAuthorIds = [...ids];
      }
    }

    if (mentionIds.length > 0 || replyToAuthorIds.length > 0) {
      generateEntityCommentNotifications({
        firmId: session.firmId,
        entityType,
        entityId,
        mentions: mentionIds,
        bodyHtml: cleanHtml,
        performedBy: personId,
        replyToAuthorIds,
      }).catch((err) =>
        console.error('[entity-comment] notification failed:', err.message),
      );
    }

    return NextResponse.json({ comment: data }, { status: 201 });
  } catch (err) {
    console.error('[entity-comment] POST', err);
    return NextResponse.json({ error: 'Failed to create comment' }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const personId = session.user.notionUserId;
  const { id, bodyHtml, mentions } = await req.json();

  if (!id || typeof bodyHtml !== 'string') {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  const cleanHtml = sanitizeCommentHtml(bodyHtml);
  if (!cleanHtml.replace(/<[^>]+>/g, '').trim()) {
    return NextResponse.json({ error: 'Comment is empty' }, { status: 400 });
  }

  const mentionIds: string[] = Array.isArray(mentions)
    ? mentions.filter((m: unknown): m is string => typeof m === 'string')
    : [];

  const supabase = await getSupabaseServerAuthClient();

  try {
    const { data: existing, error: fetchError } = await supabase
      .from('entity_comments')
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
      .from('entity_comments')
      .update({
        body_html: cleanHtml,
        mentions: mentionIds,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);

    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[entity-comment] PATCH', err);
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
    const { data: existing, error: fetchError } = await supabase
      .from('entity_comments')
      .select('person_id')
      .eq('id', id)
      .single();

    if (fetchError || !existing) {
      return NextResponse.json({ error: 'Comment not found' }, { status: 404 });
    }
    if (existing.person_id !== personId) {
      return NextResponse.json({ error: 'You can only delete your own comments' }, { status: 403 });
    }

    const { error } = await supabase.from('entity_comments').delete().eq('id', id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[entity-comment] DELETE', err);
    return NextResponse.json({ error: 'Failed to delete comment' }, { status: 500 });
  }
}
