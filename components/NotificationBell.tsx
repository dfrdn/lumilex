'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from '@/components/SessionProvider';
import { getSupabaseBrowserAuthClient } from '@/lib/supabase-browser';
import {
  Bell, BellOff, CheckCheck, FileText, Calendar, Gavel, ArrowRight, Loader2, AtSign, Mail, MessageSquare,
  ChevronDown, Briefcase, MessageCircleQuestion, Siren, Upload, ClipboardList, FileSignature, CalendarClock,
  CheckCircle2,
} from 'lucide-react';

type NotificationType =
  | 'assignment'
  | 'status_change'
  | 'finalized'
  | 'deadline'
  | 'deadline_proposal'
  | 'hearing'
  | 'mention'
  | 'meeting'
  | 'email'
  | 'chat_message'
  | 'leave_request'
  | 'leave_action'
  | 'feedback'
  | 'feedback_response'
  | 'client_upload'
  | 'intake'
  | 'engagement_signed'
  | 'sla_breach';

type Priority = 'action' | 'fyi';

interface Notification {
  id: string;
  person_id: string;
  type: NotificationType;
  priority: Priority;
  title: string;
  body: string | null;
  href: string | null;
  entity_id: string | null;
  read: boolean;
  created_at: string;
}

type Filter = 'for_you' | 'fyi' | 'all';

interface NotificationGroup {
  key: string;
  items: Notification[];
  latest: Notification;
  unreadCount: number;
}

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = Math.max(0, now - then);
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
}

function typeIcon(type: NotificationType) {
  switch (type) {
    case 'assignment': return <FileText className="w-3.5 h-3.5" />;
    case 'status_change': return <ArrowRight className="w-3.5 h-3.5" />;
    case 'finalized': return <CheckCircle2 className="w-3.5 h-3.5" />;
    case 'deadline': return <Calendar className="w-3.5 h-3.5" />;
    case 'deadline_proposal': return <CalendarClock className="w-3.5 h-3.5" />;
    case 'hearing': return <Gavel className="w-3.5 h-3.5" />;
    case 'mention': return <AtSign className="w-3.5 h-3.5" />;
    case 'meeting': return <Calendar className="w-3.5 h-3.5" />;
    case 'email': return <Mail className="w-3.5 h-3.5" />;
    case 'chat_message': return <MessageSquare className="w-3.5 h-3.5" />;
    case 'leave_request':
    case 'leave_action': return <Briefcase className="w-3.5 h-3.5" />;
    case 'feedback':
    case 'feedback_response': return <MessageCircleQuestion className="w-3.5 h-3.5" />;
    case 'client_upload': return <Upload className="w-3.5 h-3.5" />;
    case 'intake': return <ClipboardList className="w-3.5 h-3.5" />;
    case 'engagement_signed': return <FileSignature className="w-3.5 h-3.5" />;
    case 'sla_breach': return <Siren className="w-3.5 h-3.5" />;
  }
}

function typeColor(type: NotificationType) {
  switch (type) {
    case 'assignment': return 'text-blue-500 bg-blue-500/10';
    case 'status_change': return 'text-purple-500 bg-purple-500/10';
    case 'finalized': return 'text-green-500 bg-green-500/10';
    case 'deadline': return 'text-amber-500 bg-amber-500/10';
    case 'deadline_proposal': return 'text-amber-500 bg-amber-500/10';
    case 'hearing': return 'text-emerald-500 bg-emerald-500/10 dark:text-emerald-400';
    case 'mention': return 'text-rose-500 bg-rose-500/10';
    case 'meeting': return 'text-cyan-500 bg-cyan-500/10';
    case 'email': return 'text-indigo-500 bg-indigo-500/10';
    case 'chat_message': return 'text-blue-500 bg-blue-500/10';
    case 'leave_request':
    case 'leave_action': return 'text-teal-500 bg-teal-500/10';
    case 'feedback':
    case 'feedback_response': return 'text-pink-500 bg-pink-500/10';
    case 'client_upload': return 'text-violet-500 bg-violet-500/10';
    case 'intake': return 'text-orange-500 bg-orange-500/10';
    case 'engagement_signed': return 'text-green-500 bg-green-500/10';
    case 'sla_breach': return 'text-red-500 bg-red-500/10';
  }
}

function categoryFor(type: NotificationType): string {
  switch (type) {
    case 'assignment':
    case 'status_change':
    case 'finalized':
    case 'mention':
    case 'deadline':
    case 'deadline_proposal':
      return 'deliverable';
    case 'hearing': return 'hearing';
    case 'meeting': return 'meeting';
    case 'email': return 'email';
    case 'chat_message': return 'chat';
    case 'leave_request':
    case 'leave_action': return 'leave';
    case 'feedback':
    case 'feedback_response': return 'feedback';
    case 'client_upload': return 'file';
    case 'intake': return 'intake';
    case 'engagement_signed': return 'engagement';
    case 'sla_breach': return 'sla';
  }
}

function groupNotifications(list: Notification[]): NotificationGroup[] {
  const map = new Map<string, Notification[]>();
  for (const n of list) {
    const key = n.entity_id ? `${categoryFor(n.type)}:${n.entity_id}` : `solo:${n.id}`;
    const arr = map.get(key);
    if (arr) arr.push(n);
    else map.set(key, [n]);
  }
  const groups: NotificationGroup[] = [];
  for (const [key, items] of map) {
    const sorted = [...items].sort((a, b) => b.created_at.localeCompare(a.created_at));
    groups.push({
      key,
      items: sorted,
      latest: sorted[0],
      unreadCount: sorted.reduce((c, i) => c + (i.read ? 0 : 1), 0),
    });
  }
  groups.sort((a, b) => b.latest.created_at.localeCompare(a.latest.created_at));
  return groups;
}

function groupTitle(g: NotificationGroup): string {
  if (g.items.length === 1) return g.latest.title;
  const n = g.latest;
  // Try to extract the entity name from the title; fall back to the raw title.
  if (n.type === 'status_change') {
    const arrowIdx = n.title.lastIndexOf('→');
    if (arrowIdx > 0) return n.title.slice(0, arrowIdx).trim();
  }
  if (n.type === 'mention') {
    const onIdx = n.title.lastIndexOf(' on ');
    if (onIdx > 0) return n.title.slice(onIdx + 4).trim();
  }
  if (n.type === 'assignment') {
    const toIdx = n.title.lastIndexOf(' to ');
    if (toIdx > 0) return n.title.slice(toIdx + 4).trim();
  }
  return n.title;
}

/** Where each kind's own page lives, as a prefix for its id. */
const ENTITY_TYPE_PATH: Partial<Record<Notification['type'], string>> = {
  meeting: '/dashboard/meetings/',
  hearing: '/dashboard/hearings/',
  deadline: '/dashboard/deliverables/',
};

/** Ensure the href points to the entity detail page, not just the listing. */
function resolveNotificationHref(n: Notification): string | null {
  if (!n.href) return null;
  // If href already includes the entity id, use as-is
  if (n.entity_id && n.href.includes(n.entity_id)) return n.href;
  // For types with entity_id, build the detail URL
  const basePath = ENTITY_TYPE_PATH[n.type];
  if (basePath && n.entity_id) return `${basePath}${n.entity_id}`;
  return n.href;
}

export default function NotificationBell() {
  const router = useRouter();
  const { data: session } = useSession();
  const personId = session?.user?.notionUserId;
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);
  const [filter, setFilter] = useState<Filter>('for_you');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const containerRef = useRef<HTMLDivElement>(null);

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await fetch('/api/notifications');
      if (!res.ok) return;
      const data = await res.json();
      setNotifications(data.notifications ?? []);
      setUnreadCount(data.unreadCount ?? 0);
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loads the list on mount; state is set when the response arrives
    fetchNotifications();
  }, [fetchNotifications]);

  // Own-row Realtime subscription. RLS (notifications_own_select, firm- and
  // person-scoped) is the gate; the person_id filter keeps other people's rows
  // off the wire.
  useEffect(() => {
    if (!personId) return;

    const supabase = getSupabaseBrowserAuthClient();
    // StrictMode in dev double-mounts effects; removeChannel from the prior mount
    // hasn't necessarily resolved before this mount runs. Clear any stale channel
    // with the same topic so .on() doesn't hit an already-subscribed instance.
    const topic = `realtime:notifications:${personId}`;
    const stale = supabase.getChannels().find((c) => c.topic === topic);
    if (stale) supabase.removeChannel(stale);

    const channel = supabase
      .channel(`notifications:${personId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `person_id=eq.${personId}`,
        },
        (payload) => {
          const incoming = payload.new as Notification;
          // Prepend new notification. The red badge only tracks action-tier
          // items — FYI arrivals update the FYI tab silently.
          setNotifications((prev) => [incoming, ...prev].slice(0, 50));
          if (incoming.priority === 'action') setUnreadCount((c) => c + 1);
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'notifications',
          filter: `person_id=eq.${personId}`,
        },
        (payload) => {
          const incoming = payload.new as Notification;
          // Update existing notification (e.g., marked as read from another tab)
          setNotifications((prev) => {
            const next = prev.map((n) => (n.id === incoming.id ? { ...n, ...incoming } : n));
            setUnreadCount(next.filter((n) => !n.read && n.priority === 'action').length);
            return next;
          });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [personId]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick, true);
    return () => document.removeEventListener('mousedown', handleClick, true);
  }, [open]);

  // Tab pips show unread counts so the user sees where the fresh signal is.
  const filterCounts = useMemo(() => ({
    for_you: notifications.reduce((c, n) => c + (!n.read && n.priority === 'action' ? 1 : 0), 0),
    fyi: notifications.reduce((c, n) => c + (!n.read && n.priority === 'fyi' ? 1 : 0), 0),
    all: notifications.reduce((c, n) => c + (n.read ? 0 : 1), 0),
  }), [notifications]);

  const groups = useMemo(() => {
    let list = notifications;
    if (filter === 'for_you') list = list.filter((n) => n.priority === 'action');
    else if (filter === 'fyi') list = list.filter((n) => n.priority === 'fyi');
    return groupNotifications(list);
  }, [notifications, filter]);

  async function muteGroup(g: NotificationGroup) {
    const entityId = g.latest.entity_id;
    if (!entityId) return;
    const ids = new Set(g.items.map((i) => i.id));
    const removedActionUnread = g.items.filter(
      (i) => !i.read && i.priority === 'action',
    ).length;
    setNotifications((prev) => prev.filter((n) => !ids.has(n.id)));
    setUnreadCount((c) => Math.max(0, c - removedActionUnread));
    fetch('/api/notifications/mutes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // label is capped at 200 chars by muteCreateSchema; titles embed
      // unbounded entity names, so truncate rather than 400.
      body: JSON.stringify({ entityId, label: groupTitle(g).slice(0, 200) }),
    })
      .then((res) => {
        // Mute didn't persist — resync so the group reappears instead of
        // silently leaving the user believing the entity is muted.
        if (!res.ok) fetchNotifications();
      })
      .catch(() => fetchNotifications());
  }

  function markReadIds(ids: string[]) {
    if (ids.length === 0) return;
    fetch('/api/notifications', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    }).catch(() => {});
    const idSet = new Set(ids);
    setNotifications((prev) =>
      prev.map((n) => (idSet.has(n.id) && !n.read ? { ...n, read: true } : n)),
    );
    setUnreadCount((c) => Math.max(0, c - ids.length));
  }

  async function markAllRead() {
    setMarkingAll(true);
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    setUnreadCount(0);
    try {
      const res = await fetch('/api/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ all: true }),
      });
      if (!res.ok) fetchNotifications();
    } catch {
      fetchNotifications();
    }
    setMarkingAll(false);
  }

  function navigateTo(n: Notification) {
    const href = resolveNotificationHref(n);
    if (href) {
      setOpen(false);
      router.push(href);
    }
  }

  function handleItemClick(n: Notification) {
    if (!n.read) markReadIds([n.id]);
    navigateTo(n);
  }

  function handleGroupClick(g: NotificationGroup) {
    // Single-item group: behave like a direct notification click
    if (g.items.length === 1) {
      handleItemClick(g.latest);
      return;
    }
    // Multi-item group: toggle expand only. Marking as read happens on
    // the individual item click so the row stays visible on the Unread
    // tab while the user picks which one to open.
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(g.key)) next.delete(g.key);
      else next.add(g.key);
      return next;
    });
  }

  return (
    // Hidden whole below sm, so the empty wrapper takes no gap in the header.
    <div ref={containerRef} className="relative hidden sm:block">
      <button
        onClick={() => {
          if (!open) fetchNotifications();
          setOpen(!open);
        }}
        className="p-2 rounded-lg text-navy-400 dark:text-[#9B978F] hover:text-white hover:bg-navy-800 dark:hover:bg-[#232326] transition-colors duration-150 flex relative"
        aria-label="Notifications"
      >
        <Bell className="w-4 h-4" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 flex items-center justify-center text-[10px] font-bold text-white bg-red-500 rounded-full leading-none">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-[360px] max-h-[480px] bg-card rounded-xl shadow-[var(--shadow-elevated)] border border-[var(--border-color)] z-50 overflow-hidden flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-color)]">
            <h3 className="text-sm font-semibold text-foreground">Notifications</h3>
            {unreadCount > 0 && (
              <button
                onClick={markAllRead}
                disabled={markingAll}
                className="flex items-center gap-1 text-[11px] font-medium text-[var(--text-muted)] hover:text-foreground transition-colors disabled:opacity-50"
              >
                {markingAll ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <CheckCheck className="w-3 h-3" />
                )}
                Mark all read
              </button>
            )}
          </div>

          {/* Filter tabs */}
          <div className="flex items-center gap-1 px-3 py-2 border-b border-[var(--border-color)]">
            {(['for_you', 'fyi', 'all'] as const).map((f) => {
              const label = f === 'all' ? 'All' : f === 'for_you' ? 'For you' : 'FYI';
              const count = filterCounts[f];
              const active = filter === f;
              return (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFilter(f)}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
                    active
                      ? 'bg-[var(--subtle-bg)] text-foreground'
                      : 'text-[var(--text-muted)] hover:text-foreground'
                  }`}
                >
                  {label}
                  {count > 0 && (
                    <span className={`text-[10px] px-1 rounded ${active ? 'bg-[var(--border-color)] text-foreground' : 'text-[var(--text-muted)]'}`}>
                      {count > 99 ? '99+' : count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto overscroll-contain">
            {groups.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-[var(--text-muted)]">
                <Bell className="w-6 h-6 mb-2 opacity-40" />
                <p className="text-sm">
                  {filter === 'for_you'
                    ? "You're all caught up"
                    : filter === 'fyi'
                      ? 'Nothing to catch up on'
                      : 'No notifications yet'}
                </p>
              </div>
            ) : (
              groups.map((g) => {
                const isMulti = g.items.length > 1;
                const isOpen = expanded.has(g.key);
                const anyUnread = g.unreadCount > 0;
                const canMute = !!g.latest.entity_id;
                return (
                  <div key={g.key} className="group/row relative border-b border-[var(--border-color)] last:border-b-0">
                    <div className="flex items-stretch">
                      <button
                        onClick={() => handleGroupClick(g)}
                        className={`flex-1 min-w-0 text-left flex gap-3 px-4 py-3 transition-colors hover:bg-[var(--subtle-bg)] ${
                          !anyUnread ? 'opacity-60' : ''
                        }`}
                      >
                        <div className={`shrink-0 w-7 h-7 rounded-lg flex items-center justify-center ${typeColor(g.latest.type)}`}>
                          {typeIcon(g.latest.type)}
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <p className={`text-sm leading-snug truncate ${anyUnread ? 'text-foreground font-medium' : 'text-[var(--text-secondary)]'}`}>
                              {groupTitle(g)}
                            </p>
                            {isMulti && (
                              <span className="shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-[var(--subtle-bg)] text-[var(--text-muted)]">
                                {g.items.length}
                              </span>
                            )}
                          </div>
                          {!isMulti && g.latest.body && (
                            <p className="text-xs text-[var(--text-muted)] mt-0.5 truncate">{g.latest.body}</p>
                          )}
                          {isMulti && !isOpen && (
                            <p className="text-xs text-[var(--text-muted)] mt-0.5 truncate">
                              Latest: {g.latest.title}
                            </p>
                          )}
                          <p className="text-[10px] text-[var(--text-muted)] mt-1">{timeAgo(g.latest.created_at)}</p>
                        </div>

                        <div className="shrink-0 flex flex-col items-end gap-1 mt-1">
                          {anyUnread && <div className="w-2 h-2 rounded-full bg-blue-500" />}
                          {isMulti && (
                            <ChevronDown
                              className={`w-3.5 h-3.5 text-[var(--text-muted)] transition-transform ${isOpen ? 'rotate-180' : ''}`}
                            />
                          )}
                        </div>
                      </button>

                      {canMute && (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); muteGroup(g); }}
                          title="Mute — stop notifying me about this"
                          aria-label="Mute this"
                          className="shrink-0 px-2.5 flex items-center text-[var(--text-muted)] hover:text-foreground hover:bg-[var(--subtle-bg)] opacity-0 group-hover/row:opacity-100 focus:opacity-100 transition-opacity"
                        >
                          <BellOff className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>

                    {isMulti && isOpen && (
                      <div className="bg-[var(--subtle-bg)] border-t border-[var(--border-color)]">
                        {g.items.map((n) => (
                          <button
                            key={n.id}
                            onClick={(e) => { e.stopPropagation(); handleItemClick(n); }}
                            className="w-full text-left flex gap-3 px-4 py-2.5 pl-14 transition-colors hover:bg-[var(--border-color)]/40"
                          >
                            <div className="flex-1 min-w-0">
                              <p className={`text-xs leading-snug ${n.read ? 'text-[var(--text-secondary)]' : 'text-foreground font-medium'}`}>
                                {n.title}
                              </p>
                              {n.body && (
                                <p className="text-[11px] text-[var(--text-muted)] mt-0.5 truncate">{n.body}</p>
                              )}
                              <p className="text-[10px] text-[var(--text-muted)] mt-0.5">{timeAgo(n.created_at)}</p>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
