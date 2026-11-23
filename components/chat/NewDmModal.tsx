'use client';

import { useState, useMemo } from 'react';
import { X, Search, Loader2 } from 'lucide-react';
import { useChatContext } from './ChatProvider';
import { useChatChannels } from '@/hooks/use-chat-channels';

interface TeamMember {
  id: string;
  person_id?: string;
  name: string;
  initials?: string;
  email?: string;
  avatar?: string | null;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  /** Called with the channel id after creation — use in full-page view to set active channel directly */
  onChannelCreated?: (channelId: string) => void;
}

export default function NewDmModal({ isOpen, onClose, onChannelCreated }: Props) {
  const { openDm } = useChatContext();
  const { team, isLoading } = useChatChannels();
  const [filter, setFilter] = useState('');

  const members = useMemo(
    () =>
      Object.entries(team)
        .map(([personId, info]) => ({ id: personId, person_id: personId, name: info.name, initials: info.initials }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [team],
  );

  if (!isOpen) return null;

  const filtered = filter
    ? members.filter((m) => m.name.toLowerCase().includes(filter.toLowerCase()))
    : members;

  const handleSelect = async (member: TeamMember) => {
    const personId = member.person_id ?? member.id;
    if (onChannelCreated) {
      // Full-page view: create channel and hand back the id
      const res = await fetch('/api/chat/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetPersonId: personId }),
      });
      if (res.ok) {
        const { channel } = await res.json();
        onChannelCreated(channel.id);
      }
    } else {
      await openDm(personId);
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 dark:bg-black/50 backdrop-blur-sm animate-overlay" onClick={onClose}>
      <div className="w-[360px] max-h-[480px] bg-card rounded-xl shadow-[var(--shadow-elevated)] border border-[var(--border-color)] overflow-hidden flex flex-col animate-dialog" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-color)]">
          <h3 className="text-sm font-semibold text-foreground">New Message</h3>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-[var(--text-muted)] hover:text-foreground hover:bg-[var(--subtle-bg)] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Search */}
        <div className="px-4 py-2 border-b border-[var(--border-color)]">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-muted)]" />
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Search team members..."
              autoFocus
              className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg bg-[var(--subtle-bg)] border border-[var(--border-color)] text-foreground placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-1 focus:ring-blue-500/40"
            />
          </div>
        </div>

        {/* Members list */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="px-4 py-8 flex items-center justify-center gap-2 text-xs text-[var(--text-muted)]">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>Loading…</span>
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-[var(--text-muted)]">No members found</div>
          ) : (
            filtered.map((m) => (
              <button
                key={m.person_id ?? m.id}
                onClick={() => handleSelect(m)}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[var(--subtle-bg)] transition-colors text-left border-b border-[var(--border-color)] last:border-b-0"
              >
                <div className="shrink-0 w-8 h-8 rounded-full bg-blue-500/10 flex items-center justify-center text-xs font-semibold text-blue-500">
                  {m.initials ?? m.name.charAt(0)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground">{m.name}</p>
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
