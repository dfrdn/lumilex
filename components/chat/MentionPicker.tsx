'use client';

import { useState, useEffect, useRef, useImperativeHandle, forwardRef } from 'react';
import { useChatChannels } from '@/hooks/use-chat-channels';

export interface MentionPickerHandle {
  handleKeyDown: (key: string) => boolean;
}

interface Props {
  query: string;
  channelMemberIds?: string[];
  onSelect: (personId: string, name: string) => void;
  onClose: () => void;
}

const MentionPicker = forwardRef<MentionPickerHandle, Props>(function MentionPicker(
  { query, channelMemberIds, onSelect, onClose },
  ref,
) {
  const { team } = useChatChannels();
  const [selectedIdx, setSelectedIdx] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // Filter team members by query and optionally by channel membership
  const members = Object.entries(team)
    .filter(([id, info]) => {
      if (channelMemberIds && !channelMemberIds.includes(id)) return false;
      if (!query) return true;
      return info.name.toLowerCase().includes(query.toLowerCase());
    })
    .slice(0, 8);

  useEffect(() => {
    setSelectedIdx(0);
  }, [query]);

  useImperativeHandle(ref, () => ({
    handleKeyDown(key: string) {
      if (members.length === 0) return false;
      if (key === 'ArrowDown') {
        setSelectedIdx((i) => (i + 1) % members.length);
        return true;
      }
      if (key === 'ArrowUp') {
        setSelectedIdx((i) => (i - 1 + members.length) % members.length);
        return true;
      }
      if (key === 'Enter') {
        const [id, info] = members[selectedIdx];
        onSelect(id, info.name);
        return true;
      }
      if (key === 'Escape') {
        onClose();
        return true;
      }
      return false;
    },
  }));

  if (members.length === 0) return null;

  return (
    <div
      ref={listRef}
      className="rounded-xl border border-[var(--border-color)] bg-card shadow-lg overflow-hidden max-h-[200px] overflow-y-auto"
    >
      {members.map(([id, info], i) => (
        <button
          key={id}
          onClick={() => onSelect(id, info.name)}
          className={`w-full flex items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors ${
            i === selectedIdx ? 'bg-blue-500/10 text-blue-500' : 'text-foreground hover:bg-[var(--subtle-bg)]'
          }`}
        >
          <div className="shrink-0 w-6 h-6 rounded-full bg-[var(--subtle-bg)] flex items-center justify-center text-[10px] font-semibold text-[var(--text-muted)]">
            {info.initials}
          </div>
          <span className="truncate">{info.name}</span>
          {info.position && (
            <span className="ml-auto text-[10px] text-[var(--text-muted)] truncate">{info.position}</span>
          )}
        </button>
      ))}
    </div>
  );
});

export default MentionPicker;
