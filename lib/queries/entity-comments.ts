import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import type { CommentReaction } from '@/types/notion';

export type EntityCommentKind = 'hearing' | 'meeting' | 'task' | 'file';

export interface EntityComment {
  id: number;
  entityType: EntityCommentKind;
  entityId: string;
  replyToId: number | null;
  bodyHtml: string;
  mentions: string[];
  personId: string;
  createdAt: string;
  updatedAt: string | null;
  reactions: CommentReaction[];
}

interface CommentRow {
  id: number;
  entity_type: EntityCommentKind;
  entity_id: string;
  reply_to_id: number | null;
  body_html: string;
  mentions: string[] | null;
  person_id: string;
  created_at: string;
  updated_at: string | null;
}

interface ReactionRow {
  comment_id: number;
  person_id: string;
  emoji: string;
}

/**
 * Fetch every comment (top-level + replies) attached to a single entity,
 * with reactions aggregated into the CommentReaction[] shape the existing
 * CommentReactions component expects.
 */
export async function getEntityComments(firmId: string, 
  entityType: EntityCommentKind,
  entityId: string,
): Promise<EntityComment[]> {
  const supabase = getServiceDbForFirm(firmId);

  const { data: rows, error } = await supabase
    .from('entity_comments')
    .select('*')
    .eq('entity_type', entityType)
    .eq('entity_id', entityId)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[entity-comments] fetch failed:', error.message);
    return [];
  }

  const comments = (rows ?? []) as CommentRow[];
  if (comments.length === 0) return [];

  const ids = comments.map((c) => c.id);
  const { data: reactionRows } = await supabase
    .from('entity_comment_reactions')
    .select('comment_id, person_id, emoji')
    .in('comment_id', ids);

  const reactionMap = new Map<number, Map<string, Set<string>>>();
  for (const r of (reactionRows ?? []) as ReactionRow[]) {
    let byEmoji = reactionMap.get(r.comment_id);
    if (!byEmoji) {
      byEmoji = new Map();
      reactionMap.set(r.comment_id, byEmoji);
    }
    let people = byEmoji.get(r.emoji);
    if (!people) {
      people = new Set();
      byEmoji.set(r.emoji, people);
    }
    people.add(r.person_id);
  }

  return comments.map((row) => {
    const byEmoji = reactionMap.get(row.id);
    const reactions: CommentReaction[] = byEmoji
      ? [...byEmoji.entries()].map(([emoji, people]) => ({
          emoji,
          personIds: [...people],
        }))
      : [];
    return {
      id: row.id,
      entityType: row.entity_type,
      entityId: row.entity_id,
      replyToId: row.reply_to_id,
      bodyHtml: row.body_html,
      mentions: row.mentions ?? [],
      personId: row.person_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      reactions,
    };
  });
}
