'use client';

import { useState, useEffect, useRef } from 'react';
import { useChatChannels } from '@/hooks/use-chat-channels';
import { useChatMessages } from '@/hooks/use-chat-messages';
import type { ChatChannel } from '@/types/chat';
import ChannelList from './ChannelList';
import MessageThread, { type MessageThreadHandle } from './MessageThread';
import MessageInput from './MessageInput';
import NewDmModal from './NewDmModal';
import ChannelInfoPanel from './ChannelInfoPanel';
import MessageSearch from './MessageSearch';
import { MessageSquare, ArrowLeft, Search, ChevronDown, ChevronRight, Users, User, Scale } from 'lucide-react';

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
  currentUserId: string;
  initialChannelId?: string;
  chatBasePath?: string;
  containerHeight?: string;
}

export default function ChatFullPage({ currentUserId, initialChannelId, chatBasePath = '/dashboard/chat', containerHeight = 'calc(100vh - 7.5rem)' }: Props) {
  const [activeChannelId, setActiveChannelId] = useState<string | null>(initialChannelId ?? null);
  const [showNewDm, setShowNewDm] = useState(false);
  const [showChannelInfo, setShowChannelInfo] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const threadRef = useRef<MessageThreadHandle>(null);
  const { channels, team, mutate: mutateChannels } = useChatChannels();
  const { messages, isLoading, hasMore, loadMore, sendMessage, deleteMessage, toggleReaction, readReceipts, isSending } = useChatMessages(activeChannelId);

  const activeChannel = channels.find((ch) => ch.id === activeChannelId);

  // On mobile, show either channel list or thread
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)');
    setIsMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const showThread = activeChannelId && activeChannel;
  const showList = !isMobile || !showThread;
  const showThreadPanel = !isMobile || showThread;

  return (
    <div className="flex rounded-xl border border-[var(--border-color)] bg-card overflow-hidden" style={{ height: containerHeight }}>
      {/* Channel list — left panel */}
      {showList && (
        <div className={`${isMobile ? 'w-full' : 'w-72 border-r border-[var(--border-color)]'} flex flex-col shrink-0`}>
          <ChannelListWrapper
            activeChannelId={activeChannelId}
            onSelectChannel={(id) => {
              setActiveChannelId(id);
              fetch(`/api/chat/channels/${id}/read`, { method: 'POST' }).catch(() => {});
            }}
            onOpenNewDm={() => setShowNewDm(true)}
          />
        </div>
      )}

      {/* Message thread — right panel */}
      {showThreadPanel && (
        <div className="flex-1 flex flex-col min-w-0">
          {showThread ? (
            <>
              {/* Channel header */}
              <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--border-color)]">
                {isMobile && (
                  <button
                    onClick={() => setActiveChannelId(null)}
                    className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-foreground hover:bg-[var(--subtle-bg)] transition-colors"
                  >
                    <ArrowLeft className="w-4 h-4" />
                  </button>
                )}
                <div className="flex-1 min-w-0">
                  {activeChannel.type === 'matter' && activeChannel.matter_id ? (
                    <button
                      onClick={() => setShowChannelInfo(true)}
                      className="text-left w-full hover:opacity-70 transition-opacity"
                    >
                      <h2 className="text-sm font-semibold text-foreground truncate">
                        {activeChannel.name ?? 'Chat'}
                        {activeChannel.matter_code && (
                          <span className="text-[var(--text-muted)] font-normal"> ({activeChannel.matter_code})</span>
                        )}
                      </h2>
                      <p className="text-[10px] text-[var(--text-muted)]">
                        {activeChannel.member_ids.length} members &middot; Tap for info
                      </p>
                    </button>
                  ) : (
                    <div>
                      <h2 className="text-sm font-semibold text-foreground truncate">
                        {activeChannel.name ?? 'Chat'}
                      </h2>
                      <p className="text-[10px] text-[var(--text-muted)]">
                        {activeChannel.member_ids.length} members
                      </p>
                    </div>
                  )}
                </div>
                <button
                  onClick={() => setShowSearch(!showSearch)}
                  className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-foreground hover:bg-[var(--subtle-bg)] transition-colors"
                  aria-label="Search messages"
                >
                  <Search className="w-4 h-4" />
                </button>
              </div>

              <div className="flex-1 flex flex-col min-w-0 relative">
                {showSearch && (
                  <MessageSearch
                    channelId={activeChannelId!}
                    onClose={() => {
                      setShowSearch(false);
                      setHighlightedMessageId(null);
                    }}
                    onJumpToMessage={(id) => {
                      setHighlightedMessageId(id);
                      threadRef.current?.scrollToMessage(id);
                    }}
                  />
                )}
                <MessageThread
                  ref={threadRef}
                  messages={messages}
                  isLoading={isLoading}
                  hasMore={hasMore}
                  loadMore={loadMore}
                  currentUserId={currentUserId}
                  highlightedMessageId={highlightedMessageId}
                  onDeleteMessage={deleteMessage}
                  onToggleReaction={(messageId, emoji) => toggleReaction(messageId, emoji, currentUserId)}
                  readReceipts={readReceipts}
                />
                <MessageInput
                  channelId={activeChannelId!}
                  channelMemberIds={activeChannel.member_ids}
                  matterId={activeChannel.matter_id}
                  matterName={activeChannel.name ?? null}
                  onSend={sendMessage}
                  isSending={isSending}
                />

                {/* Channel info overlay */}
                {activeChannel.type === 'matter' && activeChannel.matter_id && (
                  <ChannelInfoPanel
                    isOpen={showChannelInfo}
                    onClose={() => setShowChannelInfo(false)}
                    matterId={activeChannel.matter_id}
                    matterName={activeChannel.name ?? 'Matter'}
                    matterCode={activeChannel.matter_code}
                    memberIds={activeChannel.member_ids}
                    team={team}
                  />
                )}
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-[var(--text-muted)]">
              <div className="text-center">
                <MessageSquare className="w-8 h-8 mx-auto mb-3 opacity-30" />
                <p className="text-sm">Select a conversation to start messaging</p>
              </div>
            </div>
          )}
        </div>
      )}

      <NewDmModal
        isOpen={showNewDm}
        onClose={() => setShowNewDm(false)}
        onChannelCreated={(channelId) => { setActiveChannelId(channelId); mutateChannels(); }}
      />
    </div>
  );
}

/**
 * Wrapper that manages its own channel selection for the full-page view
 * (separate from the ChatProvider context used by the sidebar panel).
 */
function ChannelListWrapper({
  activeChannelId,
  onSelectChannel,
  onOpenNewDm,
}: {
  activeChannelId: string | null;
  onSelectChannel: (id: string) => void;
  onOpenNewDm: () => void;
}) {
  const { channels, isLoading } = useChatChannels();
  const [filter, setFilter] = useState('');
  const [mounted, setMounted] = useState(false);
  const { channelUnread, channelMentions } = useChatUnreadLocal();

  useEffect(() => { setMounted(true); }, []);

  const filtered = filter
    ? channels.filter((ch) => {
        const label = ch.type === 'matter' && ch.matter_code
          ? `${ch.name ?? ''} (${ch.matter_code})`
          : (ch.name ?? '');
        return label.toLowerCase().includes(filter.toLowerCase());
      })
    : channels;

  const isActiveMatter = (ch: ChatChannel) => !ch.matter_status || ch.matter_status === 'Ongoing';

  const lastActivityMs = (ch: ChatChannel) =>
    new Date(ch.last_message?.created_at ?? ch.updated_at ?? ch.created_at).getTime();

  const sortChs = (list: ChatChannel[]) =>
    [...list].sort((a, b) => {
      // Mentioned channels first
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

  const unreadChannels = sortChs(filtered.filter((ch) => (channelUnread[ch.id] ?? ch.unread_count ?? 0) > 0));
  const unreadIds = new Set(unreadChannels.map((ch) => ch.id));
  const groupChannels = sortChs(filtered.filter((ch) => ch.type === 'group' && !unreadIds.has(ch.id)));
  const dmChannels = sortChs(filtered.filter((ch) => ch.type === 'dm' && !unreadIds.has(ch.id)));
  const activeMatterChannels = sortChs(filtered.filter((ch) => ch.type === 'matter' && isActiveMatter(ch) && !unreadIds.has(ch.id)));
  const inactiveMatterChannels = sortChs(filtered.filter((ch) => ch.type === 'matter' && !isActiveMatter(ch) && !unreadIds.has(ch.id)));

  if (!mounted || isLoading) {
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
      <div className="px-3 pt-3 pb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">Chat</h2>
        <button
          onClick={onOpenNewDm}
          className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-foreground hover:bg-[var(--subtle-bg)] transition-colors"
          aria-label="New message"
        >
          <span className="text-lg leading-none">+</span>
        </button>
      </div>

      <div className="px-3 pb-2">
        <div className="relative">
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search channels..."
            className="w-full pl-3 pr-3 py-1.5 text-xs rounded-lg bg-[var(--subtle-bg)] border border-[var(--border-color)] text-foreground placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-1 focus:ring-blue-500/40"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-1.5 pb-2 space-y-1">
        {groups.map((group) => {
          if (group.channels.length === 0) return null;
          return (
            <CollapsibleChannelGroup
              key={group.key}
              groupKey={group.key}
              label={group.label}
              channels={group.channels}
              activeChannelId={activeChannelId}
              channelUnread={channelUnread}
              channelMentions={channelMentions}
              onSelectChannel={onSelectChannel}
              defaultCollapsed={group.defaultCollapsed}
            />
          );
        })}
      </div>
    </div>
  );
}

function CollapsibleChannelGroup({
  groupKey,
  label,
  channels,
  activeChannelId,
  channelUnread,
  channelMentions,
  onSelectChannel,
  defaultCollapsed,
}: {
  groupKey: string;
  label: string;
  channels: ChatChannel[];
  activeChannelId: string | null;
  channelUnread: Record<string, number>;
  channelMentions: Record<string, number>;
  onSelectChannel: (id: string) => void;
  defaultCollapsed?: boolean;
}) {
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed ?? false);
  const groupUnreadCount = channels.reduce(
    (sum, ch) => sum + (channelUnread[ch.id] ?? ch.unread_count ?? 0),
    0,
  );

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

  return (
    <div>
      <button
        onClick={() => setIsCollapsed(!isCollapsed)}
        className="w-full px-2 py-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] hover:text-foreground transition-colors"
      >
        {isCollapsed ? (
          <ChevronRight className="w-3 h-3" />
        ) : (
          <ChevronDown className="w-3 h-3" />
        )}
        <span>{label}</span>
        {isCollapsed && groupUnreadCount > 0 && (
          <span className="ml-auto min-w-[16px] h-[16px] px-1 flex items-center justify-center text-[9px] font-bold text-white bg-blue-500 rounded-full leading-none">
            {groupUnreadCount > 99 ? '99+' : groupUnreadCount}
          </span>
        )}
      </button>
      {!isCollapsed && channels.map((ch) => {
        const unread = channelUnread[ch.id] ?? ch.unread_count ?? 0;
        const mentions = channelMentions[ch.id] ?? 0;
        const displayName = ch.type === 'matter' && ch.matter_code
          ? `${ch.name} (${ch.matter_code})`
          : ch.name;
        const lastMsg = ch.last_message;
        const previewText = lastMsg
          ? (lastMsg.content || (lastMsg.entity_refs?.length ? 'Shared a reference' : 'Sent an attachment'))
          : null;
        return (
          <button
            key={ch.id}
            onClick={() => onSelectChannel(ch.id)}
            className={`w-full flex items-start gap-2.5 px-2 py-2 rounded-lg text-left transition-colors ${
              activeChannelId === ch.id
                ? 'bg-blue-500/10'
                : 'hover:bg-[var(--subtle-bg)]'
            }`}
          >
            <div className={`shrink-0 w-8 h-8 rounded-lg flex items-center justify-center mt-0.5 ${iconStyle(ch)}`}>
              {channelIcon(ch)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-1">
                <p className={`text-sm truncate text-foreground ${unread > 0 ? 'font-semibold' : 'font-normal'}`}>
                  {displayName}
                </p>
                {lastMsg && (
                  <span className="text-[10px] text-[var(--text-muted)] shrink-0">
                    {timeLabel(lastMsg.created_at)}
                  </span>
                )}
              </div>
              {(previewText || mentions > 0 || unread > 0) && (
                <div className="flex items-center justify-between gap-1">
                  <p className="text-xs text-[var(--text-muted)] truncate">
                    {previewText
                      ? `${lastMsg?.sender_initials ? `${lastMsg.sender_initials}: ` : ''}${previewText}`
                      : ''}
                  </p>
                  <div className="flex items-center gap-1 shrink-0">
                    {mentions > 0 && (
                      <span className="min-w-[18px] h-[18px] px-1 flex items-center justify-center text-[10px] font-bold text-white bg-violet-500 rounded-full leading-none">
                        @{mentions > 99 ? '99+' : mentions}
                      </span>
                    )}
                    {unread > 0 && mentions === 0 && (
                      <span className="min-w-[18px] h-[18px] px-1 flex items-center justify-center text-[10px] font-bold text-white bg-blue-500 rounded-full leading-none">
                        {unread > 99 ? '99+' : unread}
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}

/** Local hook to get unread counts without depending on ChatProvider context */
function useChatUnreadLocal() {
  const [channelUnread, setChannelUnread] = useState<Record<string, number>>({});
  const [channelMentions, setChannelMentions] = useState<Record<string, number>>({});

  useEffect(() => {
    fetch('/api/chat/unread')
      .then((r) => r.json())
      .then((data) => {
        setChannelUnread(data.channels ?? {});
        setChannelMentions(data.mention_counts ?? {});
      })
      .catch(() => {});
  }, []);

  return { channelUnread, channelMentions };
}
