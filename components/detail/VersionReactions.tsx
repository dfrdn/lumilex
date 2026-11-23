'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { SmilePlus } from 'lucide-react';
import type { CommentReaction } from '@/types/notion';
import type { PersonInfo } from '@/lib/queries/people';
import { FORMER_MEMBER } from '@/lib/former-member';

const QUICK_EMOJIS = ['👍', '❤️', '🎉', '👀', '🔥', '💯', '✅', '👏'];

interface Props {
  deliverableId: string;
  version: number;
  reactions: CommentReaction[];
  currentUserId: string;
  people: Record<string, PersonInfo>;
  onReactionToggled: () => void;
}

/** Toggle currentUserId in the reactions array — mirrors what the server will do. */
function toggleLocal(
  reactions: CommentReaction[],
  emoji: string,
  userId: string,
): CommentReaction[] {
  const existing = reactions.find((r) => r.emoji === emoji);
  if (!existing) {
    return [...reactions, { emoji, personIds: [userId] }];
  }
  const hasUser = existing.personIds.includes(userId);
  const nextIds = hasUser
    ? existing.personIds.filter((id) => id !== userId)
    : [...existing.personIds, userId];
  if (nextIds.length === 0) {
    return reactions.filter((r) => r.emoji !== emoji);
  }
  return reactions.map((r) => (r.emoji === emoji ? { ...r, personIds: nextIds } : r));
}

export default function VersionReactions({
  deliverableId, version, reactions, currentUserId, people, onReactionToggled,
}: Props) {
  const [showPicker, setShowPicker] = useState(false);
  // Local mirror of reactions — updated optimistically, resynced when parent refreshes.
  const [localReactions, setLocalReactions] = useState(reactions);
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setLocalReactions(reactions); }, [reactions]);

  useEffect(() => {
    if (!showPicker) return;
    function handleClick(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowPicker(false);
      }
    }
    document.addEventListener('mousedown', handleClick, true);
    return () => document.removeEventListener('mousedown', handleClick, true);
  }, [showPicker]);

  const toggleReaction = useCallback(async (emoji: string) => {
    const previous = localReactions;
    // Optimistic — flip the reaction locally and close the picker immediately.
    setLocalReactions((prev) => toggleLocal(prev, emoji, currentUserId));
    setShowPicker(false);
    try {
      const res = await fetch('/api/deliverable-version-reaction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deliverableId, version, emoji }),
      });
      if (!res.ok) throw new Error('Failed');
      onReactionToggled();
    } catch {
      // Revert on failure
      setLocalReactions(previous);
    }
  }, [deliverableId, version, currentUserId, localReactions, onReactionToggled]);

  const getTooltip = (reaction: CommentReaction): string => {
    return reaction.personIds
      .map((id) => people[id]?.initials ?? FORMER_MEMBER)
      .join(', ');
  };

  return (
    <div className="flex items-center gap-1 flex-wrap">
      {localReactions.map((r) => {
        const isOwn = r.personIds.includes(currentUserId);
        return (
          <button
            key={r.emoji}
            type="button"
            onClick={() => toggleReaction(r.emoji)}
            title={getTooltip(r)}
            className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[11px] rounded-full border transition-all duration-150 cursor-pointer ${
              isOwn
                ? 'bg-blue-50 dark:bg-blue-500/10 border-blue-300 dark:border-blue-500/30 text-blue-700 dark:text-blue-300'
                : 'bg-[var(--subtle-bg)] border-[var(--border-color)] text-[var(--text-secondary)] hover:border-blue-300 dark:hover:border-blue-500/30'
            }`}
          >
            <span>{r.emoji}</span>
            <span className="font-medium text-[10px]">
              {r.personIds.map((id) => people[id]?.initials ?? FORMER_MEMBER).join(', ')}
            </span>
          </button>
        );
      })}

      <div className="relative" ref={pickerRef}>
        <button
          type="button"
          onClick={() => setShowPicker((p) => !p)}
          className="inline-flex items-center justify-center w-6 h-6 rounded-full border border-dashed border-[var(--border-color)] text-[var(--text-muted)] hover:border-blue-300 hover:text-blue-500 dark:hover:border-blue-500/30 dark:hover:text-blue-400 transition-all cursor-pointer"
          title="Add reaction"
        >
          <SmilePlus className="w-3 h-3" />
        </button>

        {showPicker && (
          <div className="absolute bottom-full left-0 mb-1 z-30 bg-[var(--card-bg)] border border-[var(--border-color)] rounded-lg shadow-lg p-1.5 flex items-center gap-0.5 animate-fade-down">
            {QUICK_EMOJIS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => toggleReaction(emoji)}
                className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-[var(--subtle-bg)] transition-colors cursor-pointer text-sm"
              >
                {emoji}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
