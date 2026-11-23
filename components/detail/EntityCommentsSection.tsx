'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MessageSquare, Pencil, Trash2, Reply, Check, X } from 'lucide-react';
import { CARD } from '@/components/ui/tone';
import dynamic from 'next/dynamic';
import type { RichCommentEditorHandle } from './RichCommentEditor';
import CommentReactions from './CommentReactions';
import Avatar from '@/components/Avatar';
import type { EntityComment, EntityCommentKind } from '@/lib/queries/entity-comments';
import type { PersonInfo, TeamMemberOption } from '@/lib/queries/people';
import { confirmAction } from '@/components/ui/confirm';
import { toast } from 'sonner';
import { FORMER_MEMBER } from '@/lib/former-member';
import { sanitizeCommentHtml } from '@/lib/sanitize-comment';

// The rich-text editor (tiptap) loads on its own, behind a box of its height.
const RichCommentEditor = dynamic(() => import('./RichCommentEditor'), {
  ssr: false,
  loading: () => <div className="h-[7.9rem] rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)]" />,
});
const CompactRichCommentEditor = dynamic(() => import('./RichCommentEditor'), {
  ssr: false,
  loading: () => <div className="h-[4.9rem] rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)]" />,
});

/** Negative ids for comments shown before the server has saved them. */
let tempId = 0;

interface Props {
  entityType: EntityCommentKind;
  entityId: string;
  initialComments: EntityComment[];
  people: Record<string, PersonInfo>;
  teamMembers: TeamMemberOption[];
  currentUserId: string;
}

function authorDisplayName(
  personId: string,
  people: Record<string, PersonInfo>,
  teamMembers: TeamMemberOption[],
): string {
  // PersonInfo from getAllTeamMembersAsMap doesn't carry the display name —
  // fall back to the team-member options (which do) when we need to show a
  // human-readable byline.
  const team = teamMembers.find((m) => m.personId === personId);
  if (team?.name) return team.name;
  const info = people[personId];
  return info?.initials || FORMER_MEMBER;
}

function formatRelative(iso: string): string {
  const now = Date.now();
  const t = new Date(iso).getTime();
  const diff = Math.round((now - t) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(iso).toLocaleDateString('en-PH', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

function formatFull(iso: string): string {
  return new Date(iso).toLocaleString('en-PH', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  });
}

export default function EntityCommentsSection({
  entityType, entityId, initialComments, people, teamMembers, currentUserId,
}: Props) {
  const [comments, setComments] = useState<EntityComment[]>(initialComments);
  // The rows as last rendered, for rollbacks that must not depend on when an updater runs.
  const commentsRef = useRef(comments);
  useEffect(() => { commentsRef.current = comments; }, [comments]);
  const [replyOpenFor, setReplyOpenFor] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);

  // Organize: top-level (replyToId === null), plus a map of replies per parent.
  const { topLevel, repliesByParent } = useMemo(() => {
    const top: EntityComment[] = [];
    const byParent = new Map<number, EntityComment[]>();
    for (const c of comments) {
      if (c.replyToId == null) {
        top.push(c);
      } else {
        const arr = byParent.get(c.replyToId) ?? [];
        arr.push(c);
        byParent.set(c.replyToId, arr);
      }
    }
    return { topLevel: top, repliesByParent: byParent };
  }, [comments]);

  const postComment = useCallback(
    (html: string, mentionIds: string[], replyToId: number | null, onFail: () => void) => {
      const pendingId = --tempId;
      const pending: EntityComment = {
        id: pendingId,
        entityType,
        entityId,
        replyToId,
        bodyHtml: sanitizeCommentHtml(html),
        mentions: mentionIds,
        personId: currentUserId,
        createdAt: new Date().toISOString(),
        updatedAt: null,
        reactions: [],
      };
      setComments((prev) => [...prev, pending]);
      void (async () => {
        try {
          const res = await fetch('/api/entity-comment', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              entityType,
              entityId,
              bodyHtml: html,
              mentions: mentionIds,
              replyToId,
            }),
          });
          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err?.error || 'Failed to post');
          }
          const { comment } = await res.json();
          const saved: EntityComment = {
            id: comment.id,
            entityType: comment.entity_type,
            entityId: comment.entity_id,
            replyToId: comment.reply_to_id,
            bodyHtml: comment.body_html,
            mentions: comment.mentions ?? [],
            personId: comment.person_id,
            createdAt: comment.created_at,
            updatedAt: comment.updated_at,
            reactions: [],
          };
          setComments((prev) => prev.map((c) => (c.id === pendingId ? saved : c)));
        } catch (err) {
          setComments((prev) => prev.filter((c) => c.id !== pendingId));
          onFail();
          toast.error(err instanceof Error ? err.message : 'Failed to post');
        }
      })();
    },
    [entityType, entityId, currentUserId],
  );

  // A post that fails puts its text back in a fresh editor, so nothing typed is lost.
  const [composerDraft, setComposerDraft] = useState<{ key: number; html?: string }>({ key: 0 });
  const [replyDraft, setReplyDraft] = useState<{ parentId: number; html: string } | null>(null);

  const handleTopLevelSubmit = useCallback(
    async (html: string, mentionIds: string[]) => {
      postComment(html, mentionIds, null, () => setComposerDraft((d) => ({ key: d.key + 1, html })));
    },
    [postComment],
  );

  const handleReplySubmit = useCallback(
    (parentId: number) => async (html: string, mentionIds: string[]) => {
      postComment(html, mentionIds, parentId, () => {
        setReplyDraft({ parentId, html });
        setReplyOpenFor(parentId);
      });
      setReplyDraft(null);
      setReplyOpenFor(null);
    },
    [postComment],
  );

  const handleDelete = useCallback(async (id: number) => {
    if (!(await confirmAction({ title: 'Delete this comment?', confirmLabel: 'Delete', danger: true }))) return;
    // Replies go too: the DB cascade drops them.
    const gone = (c: EntityComment) => c.id === id || c.replyToId === id;
    const removed = commentsRef.current.filter(gone);
    setComments((prev) => prev.filter((c) => !gone(c)));
    try {
      const res = await fetch('/api/entity-comment', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) throw new Error('Failed');
    } catch {
      // Put back only what this delete took, keeping anything posted or edited since.
      setComments((prev) =>
        [...prev, ...removed.filter((r) => !prev.some((c) => c.id === r.id))].sort((a, b) =>
          a.createdAt.localeCompare(b.createdAt),
        ),
      );
      toast.error('Failed to delete comment');
    }
  }, []);

  const handleSaveEdit = useCallback(async (id: number, html: string, mentionIds: string[]) => {
    const previous = commentsRef.current.find((x) => x.id === id);
    setComments((prev) =>
      prev.map((x) =>
        x.id === id
          ? { ...x, bodyHtml: sanitizeCommentHtml(html), mentions: mentionIds, updatedAt: new Date().toISOString() }
          : x,
      ),
    );
    setEditingId(null);
    try {
      const res = await fetch('/api/entity-comment', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, bodyHtml: html, mentions: mentionIds }),
      });
      if (!res.ok) throw new Error('Failed');
    } catch {
      if (previous) {
        const restore = previous;
        setComments((prev) => prev.map((x) => (x.id === id ? restore : x)));
      }
      toast.error('Failed to save edit');
    }
  }, []);

  const total = comments.length;
  const currentUser = teamMembers.find((m) => m.personId === currentUserId);
  const currentUserAvatar = currentUser?.avatarUrl ?? people[currentUserId]?.avatarUrl ?? null;
  const currentUserInitials =
    currentUser?.initials ||
    people[currentUserId]?.initials ||
    '••';

  return (
    <div className={`${CARD} overflow-hidden animate-fade-up`}>
      <div className="px-5 pt-4 pb-2 flex items-center gap-2">
        <MessageSquare className="w-4 h-4 text-stone-400 dark:text-stone-500" />
        <h2 className="text-[13px] font-semibold text-stone-800 dark:text-stone-100">Comments</h2>
        {total > 0 && (
          <span className="inline-flex items-center px-1.5 py-px rounded-full bg-stone-100 dark:bg-white/[0.08] text-[11px] font-medium text-stone-600 dark:text-stone-300 tabular-nums">
            {total}
          </span>
        )}
      </div>

      <div className="px-5 pb-5 pt-2 space-y-6">
        {/* Existing thread */}
        {topLevel.length === 0 ? (
          <div className="text-center py-6">
            <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-[var(--subtle-bg)] mb-3">
              <MessageSquare className="w-4 h-4 text-[var(--text-muted)]" />
            </div>
            <p className="text-sm text-[var(--text-secondary)]">
              No comments yet
            </p>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              Be the first to add one below.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {topLevel.map((c) => (
              <CommentNode
                key={c.id}
                comment={c}
                replies={repliesByParent.get(c.id) ?? []}
                people={people}
                teamMembers={teamMembers}
                currentUserId={currentUserId}
                isReplyOpen={replyOpenFor === c.id}
                editingId={editingId}
                onToggleReply={() =>
                  setReplyOpenFor((prev) => (prev === c.id ? null : c.id))
                }
                onReplySubmit={handleReplySubmit(c.id)}
                replyInitialHtml={replyDraft?.parentId === c.id ? replyDraft.html : undefined}
                onStartEdit={(id) => setEditingId(id)}
                onCancelEdit={() => setEditingId(null)}
                onSaveEdit={handleSaveEdit}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}

        {/* Top-level composer */}
        <div className="flex items-start gap-3 pt-1">
          <Avatar
            size={32}
            avatarUrl={currentUserAvatar}
            initials={currentUserInitials}
            className="mt-1 ring-1 ring-gold-200/40 dark:ring-gold-500/20"
            fallbackClassName="bg-gold-50 dark:bg-gold-500/10 text-gold-700 dark:text-gold-300"
          />
          <div className="flex-1 min-w-0">
            <RichCommentEditor
              key={composerDraft.key}
              initialHtml={composerDraft.html}
              teamMembers={teamMembers}
              onSubmit={handleTopLevelSubmit}
              placeholder="Write a comment… use @ to mention someone"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Single comment (with nested replies) ──────────────────────────────────

interface CommentNodeProps {
  comment: EntityComment;
  replies: EntityComment[];
  people: Record<string, PersonInfo>;
  teamMembers: TeamMemberOption[];
  currentUserId: string;
  isReplyOpen: boolean;
  editingId: number | null;
  onToggleReply: () => void;
  onReplySubmit: (html: string, mentionIds: string[]) => Promise<void>;
  replyInitialHtml?: string;
  onStartEdit: (id: number) => void;
  onCancelEdit: () => void;
  onSaveEdit: (id: number, html: string, mentionIds: string[]) => Promise<void>;
  onDelete: (id: number) => void;
}

function CommentNode({
  comment, replies, people, teamMembers, currentUserId,
  isReplyOpen,
  editingId,
  onToggleReply, onReplySubmit, replyInitialHtml,
  onStartEdit, onCancelEdit, onSaveEdit, onDelete,
}: CommentNodeProps) {
  return (
    <div className="space-y-3">
      <CommentRow
        comment={comment}
        people={people}
        teamMembers={teamMembers}
        currentUserId={currentUserId}
        isEditing={editingId === comment.id}
        onStartEdit={() => onStartEdit(comment.id)}
        onCancelEdit={onCancelEdit}
        onSaveEdit={(html, mentionIds) => onSaveEdit(comment.id, html, mentionIds)}
        onDelete={() => onDelete(comment.id)}
      />

      {/* Replies + reply trigger — indent aligns with the avatar column above */}
      <div className="ml-[44px] pl-4 border-l border-[var(--border-color)] space-y-4">
        {replies.map((r) => (
          <CommentRow
            key={r.id}
            comment={r}
            people={people}
            teamMembers={teamMembers}
            currentUserId={currentUserId}
            isEditing={editingId === r.id}
            onStartEdit={() => onStartEdit(r.id)}
            onCancelEdit={onCancelEdit}
            onSaveEdit={(html, mentionIds) => onSaveEdit(r.id, html, mentionIds)}
            onDelete={() => onDelete(r.id)}
          />
        ))}

        {/* A pending comment has no id to reply to yet. */}
        {comment.id < 0 ? null : isReplyOpen ? (
          <div className="space-y-2">
            <CompactRichCommentEditor
              teamMembers={teamMembers}
              onSubmit={onReplySubmit}
              initialHtml={replyInitialHtml}
              placeholder="Write a reply…"
              autoFocus
              compact
            />
            <button
              type="button"
              onClick={onToggleReply}
              className="text-[11px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] cursor-pointer"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={onToggleReply}
            className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[var(--text-secondary)] hover:text-gold-600 dark:hover:text-gold-400 cursor-pointer transition-colors"
          >
            <Reply className="w-3 h-3" />
            Reply
          </button>
        )}
      </div>
    </div>
  );
}

interface CommentRowProps {
  comment: EntityComment;
  people: Record<string, PersonInfo>;
  teamMembers: TeamMemberOption[];
  currentUserId: string;
  isEditing: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: (html: string, mentionIds: string[]) => Promise<void>;
  onDelete: () => void;
}

function CommentRow({
  comment, people, teamMembers, currentUserId,
  isEditing,
  onStartEdit, onCancelEdit, onSaveEdit, onDelete,
}: CommentRowProps) {
  const author = people[comment.personId];
  const isOwn = currentUserId === comment.personId;
  const isPending = comment.id < 0;
  const editorRef = useRef<RichCommentEditorHandle>(null);
  const displayName = authorDisplayName(comment.personId, people, teamMembers);

  return (
    <div className={`flex items-start gap-3 group/comment transition-opacity ${isPending ? 'opacity-60' : ''}`}>
      <Avatar
        size={32}
        avatarUrl={author?.avatarUrl ?? null}
        initials={author?.initials ?? '–'}
        name={displayName}
        className="mt-0.5 ring-1 ring-gold-200/40 dark:ring-gold-500/20"
        fallbackClassName="bg-gold-50 dark:bg-gold-500/10 text-gold-700 dark:text-gold-300"
      />
      <div className="flex-1 min-w-0">
        {isEditing ? (
          <div className="space-y-2">
            <RichCommentEditor
              ref={editorRef}
              teamMembers={teamMembers}
              initialHtml={comment.bodyHtml}
              autoFocus
              hideSubmit
            />
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  const c = editorRef.current?.getContent();
                  if (!c) return;
                  onSaveEdit(c.html, c.mentionIds);
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold text-[#1A1816] bg-gold-400 hover:bg-gold-500 rounded-md cursor-pointer transition-colors"
              >
                <Check className="w-3 h-3" />
                Save
              </button>
              <button
                type="button"
                onClick={onCancelEdit}
                className="inline-flex items-center gap-1 px-2 py-1.5 text-[11px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] cursor-pointer"
              >
                <X className="w-3 h-3" />
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Author byline */}
            <div className="flex items-center gap-2 mb-1 text-[11px]">
              <span className="font-semibold text-[var(--text-primary)]">{displayName}</span>
              <span className="text-[var(--text-muted)]" title={formatFull(comment.createdAt)}>
                {formatRelative(comment.createdAt)}
              </span>
              {comment.updatedAt && (
                <span className="text-[var(--text-muted)] italic" title={formatFull(comment.updatedAt)}>
                  · edited
                </span>
              )}
              {isOwn && !isPending && (
                <span className="opacity-0 group-hover/comment:opacity-100 transition-opacity flex items-center gap-0.5 ml-auto">
                  <button
                    type="button"
                    onClick={onStartEdit}
                    className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--subtle-bg)] cursor-pointer transition-colors"
                    title="Edit"
                  >
                    <Pencil className="w-3 h-3" />
                  </button>
                  <button
                    type="button"
                    onClick={onDelete}
                    className="p-1 rounded text-[var(--text-muted)] hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10 cursor-pointer transition-colors"
                    title="Delete"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </span>
              )}
            </div>
            <div
              className="prose prose-sm prose-stone dark:prose-invert max-w-none text-[13.5px] text-[var(--text-primary)] leading-relaxed"
              dangerouslySetInnerHTML={{ __html: comment.bodyHtml }}
            />
            {currentUserId && !isPending && (
              <CommentReactions
                commentId={comment.id}
                reactions={comment.reactions}
                currentUserId={currentUserId}
                people={people}
                endpoint="/api/entity-comment/reaction"
                onReactionToggled={() => { /* optimistic — no refetch */ }}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}
