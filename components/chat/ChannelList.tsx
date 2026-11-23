'use client';

import { useState } from 'react';
import { Search, Plus, Scale, User, MessageSquare, X, Users, ChevronDown, ChevronRight } from 'lucide-react';
import { useChatChannels } from '@/hooks/use-chat-channels';
import { useChatContext } from './ChatProvider';
import type { ChatChannel } from '@/types/chat';

function timeLabel(dateStr: string): string {
  const now = new Date();
  const d = new Date(dateStr);
  const diff = now.getTime() - d.getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d`;
  return d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
}

interface Props {
  onOpenNewDm: () => void;
  onClose?: () => void;
}

export default function ChannelList({ onOpenNewDm, onClose }: Props) {
  const { channels, isLoading } = useChatChannels();
  const { activeChannelId, setActiveChannel, channelUnread, channelMentions } = useChatContext();
  const [filter, setFilter] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const toggleCollapse = (group: string) =>
    setCollapsed((prev) => ({ ...prev, [group]: !prev[group] }));

  const filtered = filter
    ? channels.filter((ch) => {
        const label = ch.type === 'matter' && ch.matter_code
          ? `${ch.name ?? ''} (${ch.matter_code})`
          : (ch.name ?? '');
        return label.toLowerCase().includes(filter.toLowerCase());
      })
    : channels;

  const isActive = (ch: ChatChannel) => !ch.matter_status || ch.matter_status === 'Ongoing';

  const lastActivityMs = (ch: ChatChannel) =>
    new Date(ch.last_message?.created_at ?? ch.updated_at ?? ch.created_at).getTime();

  const sortChannels = (list: ChatChannel[]) =>
    [...list].sort((a, b) => {
      // Mentioned channels first within unread
      const aMention = (channelMentions[a.id] ?? 0) > 0 ? 0 : 1;
      const bMention = (channelMentions[b.id] ?? 0) > 0 ? 0 : 1;
      if (aMention !== bMention) return aMention - bMention;
      const aUnread = (channelUnread[a.id] ?? a.unread_count ?? 0) > 0 ? 0 : 1;
      const bUnread = (channelUnread[b.id] ?? b.unread_count ?? 0) > 0 ? 0 : 1;
      if (aUnread !== bUnread) return aUnread - bUnread;
      // Primary sort: most recent activity first; fall back to name
      const diff = lastActivityMs(b) - lastActivityMs(a);
      if (diff !== 0) return diff;
      return (a.name ?? '').localeCompare(b.name ?? '');
    });

  const unreadChannels = sortChannels(filtered.filter((ch) => (channelUnread[ch.id] ?? ch.unread_count ?? 0) > 0));
  const unreadIds = new Set(unreadChannels.map((ch) => ch.id));
  const groupChannels = sortChannels(filtered.filter((ch) => ch.type === 'group' && !unreadIds.has(ch.id)));
  const dmChannels = sortChannels(filtered.filter((ch) => ch.type === 'dm' && !unreadIds.has(ch.id)));
  const activeMatterChannels = sortChannels(filtered.filter((ch) => ch.type === 'matter' && isActive(ch) && !unreadIds.has(ch.id)));
  const inactiveMatterChannels = sortChannels(filtered.filter((ch) => ch.type === 'matter' && !isActive(ch) && !unreadIds.has(ch.id)));

  function handleSelect(ch: ChatChannel) {
    setActiveChannel(ch.id);
    fetch(`/api/chat/channels/${ch.id}/read`, { method: 'POST' }).catch(() => {});
  }

  function channelIcon(ch: ChatChannel) {
    if (ch.type === 'group') return <Users className="w-3.5 h-3.5" />;
    if (ch.type === 'dm') return <User className="w-3.5 h-3.5" />;
    return <Scale className="w-3.5 h-3.5" />;
  }

  function iconStyle(ch: ChatChannel) {
    if (ch.type === 'group') return 'bg-violet-500/10 text-violet-500';
    if (ch.type === 'dm') return 'bg-blue-500/10 text-blue-500';
    return 'bg-emerald-500/10 text-emerald-500 dark:text-emerald-400';
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-[var(--text-muted)]">
        <MessageSquare className="w-5 h-5 animate-pulse" />
      </div>
    );
  }

  const groups: { key: string; label: string; channels: ChatChannel[]; defaultCollapsed?: boolean }[] = [
    { key: 'unread', label: 'Unread', channels: unreadChannels },
    { key: 'groups', label: 'Channels', channels: groupChannels },
    { key: 'dm', label: 'Direct Messages', channels: dmChannels },
    { key: 'active', label: 'Active Matters', channels: activeMatterChannels },
    { key: 'inactive', label: 'Inactive Matters', channels: inactiveMatterChannels, defaultCollapsed: true },
  ];

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-3 pt-3 pb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">Chat</h2>
        <div className="flex items-center gap-1">
          <button
            onClick={onOpenNewDm}
            className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-foreground hover:bg-[var(--subtle-bg)] transition-colors"
            aria-label="New message"
          >
            <Plus className="w-4 h-4" />
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-foreground hover:bg-[var(--subtle-bg)] transition-colors"
              aria-label="Close chat"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Search */}
      <div className="px-3 pb-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-muted)]" />
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search channels..."
            className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg bg-[var(--subtle-bg)] border border-[var(--border-color)] text-foreground placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-1 focus:ring-blue-500/40"
          />
        </div>
      </div>

      {/* Channel groups */}
      <div className="flex-1 overflow-y-auto px-1.5 pb-2 space-y-1">
        {groups.map((group) => {
          if (group.channels.length === 0) return null;
          const isCollapsed = collapsed[group.key] ?? (group.defaultCollapsed ?? false);
          const groupUnreadCount = group.channels.reduce(
            (sum, ch) => sum + (channelUnread[ch.id] ?? ch.unread_count ?? 0),
            0,
          );

          return (
            <div key={group.key}>
              <button
                onClick={() => toggleCollapse(group.key)}
                className="w-full px-2 py-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] hover:text-foreground transition-colors"
              >
                {isCollapsed ? (
                  <ChevronRight className="w-3 h-3" />
                ) : (
                  <ChevronDown className="w-3 h-3" />
                )}
                <span>{group.label}</span>
                {isCollapsed && groupUnreadCount > 0 && (
                  <span className="ml-auto min-w-[16px] h-[16px] px-1 flex items-center justify-center text-[9px] font-bold text-white bg-blue-500 rounded-full leading-none">
                    {groupUnreadCount > 99 ? '99+' : groupUnreadCount}
                  </span>
                )}
              </button>
              {!isCollapsed &&
                group.channels.map((ch) => (
                  <ChannelRow
                    key={ch.id}
                    channel={ch}
                    isActive={activeChannelId === ch.id}
                    unread={channelUnread[ch.id] ?? ch.unread_count ?? 0}
                    mentionCount={channelMentions[ch.id] ?? 0}
                    icon={channelIcon(ch)}
                    iconStyle={iconStyle(ch)}
                    onClick={() => handleSelect(ch)}
                  />
                ))}
            </div>
          );
        })}

        {filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-8 text-[var(--text-muted)]">
            <MessageSquare className="w-5 h-5 mb-2 opacity-40" />
            <p className="text-xs">{filter ? 'No channels match' : 'No channels yet'}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function ChannelRow({
  channel,
  isActive,
  unread,
  mentionCount,
  icon,
  iconStyle,
  onClick,
}: {
  channel: ChatChannel;
  isActive: boolean;
  unread: number;
  mentionCount: number;
  icon: React.ReactNode;
  iconStyle: string;
  onClick: () => void;
}) {
  const lastMsg = channel.last_message;

  return (
    <button
      onClick={onClick}
      className={`w-full flex items-start gap-2.5 px-2 py-2 rounded-lg text-left transition-colors active:scale-[0.98] active:opacity-80 ${
        isActive
          ? 'bg-blue-500/10 dark:bg-blue-500/10'
          : 'hover:bg-[var(--subtle-bg)]'
      }`}
    >
      {/* Icon */}
      <div
        className={`shrink-0 w-8 h-8 rounded-lg flex items-center justify-center mt-0.5 ${iconStyle}`}
      >
        {icon}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-1">
          <p
            className={`text-sm truncate ${
              unread > 0 ? 'font-semibold text-foreground' : 'font-normal text-foreground'
            }`}
          >
            {channel.type === 'matter' && channel.matter_code
              ? `${channel.name ?? 'Unknown'} (${channel.matter_code})`
              : (channel.name ?? 'Unknown')}
          </p>
          {lastMsg && (
            <span className="text-[10px] text-[var(--text-muted)] shrink-0">
              {timeLabel(lastMsg.created_at)}
            </span>
          )}
        </div>
        {lastMsg && (
          <div className="flex items-center justify-between gap-1">
            <p className="text-xs text-[var(--text-muted)] truncate">
              {lastMsg.sender_name ? `${lastMsg.sender_initials}: ` : ''}
              {lastMsg.content || (lastMsg.entity_refs?.length ? 'Shared a reference' : 'Sent an attachment')}
            </p>
            <div className="flex items-center gap-1">
              {mentionCount > 0 && (
                <span className="shrink-0 min-w-[18px] h-[18px] px-1 flex items-center justify-center text-[10px] font-bold text-white bg-violet-500 rounded-full leading-none">
                  @{mentionCount > 99 ? '99+' : mentionCount}
                </span>
              )}
              {unread > 0 && mentionCount === 0 && (
                <span className="chat-badge-ring shrink-0 min-w-[18px] h-[18px] px-1 flex items-center justify-center text-[10px] font-bold text-white bg-blue-500 rounded-full leading-none">
                  {unread > 99 ? '99+' : unread}
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </button>
  );
}
