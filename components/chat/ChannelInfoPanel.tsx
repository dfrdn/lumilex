'use client';

import { useState, useEffect } from 'react';
import { X, Search, FileText, CheckSquare, Gavel, Handshake, FolderOpen, Paperclip, Loader2, Users } from 'lucide-react';
import { useDetailPane } from '@/components/DetailPaneContext';
import type { ChatEntityType, EntityRef } from '@/types/chat';
import { daysBetween, formatManila, manilaToday, toManilaDay, toManilaInstant } from '@/lib/dates';

const ENTITY_TABS: { type: ChatEntityType; label: string; icon: typeof FileText; color: string }[] = [
  { type: 'deliverable', label: 'Deliverables', icon: FileText, color: 'text-purple-500 bg-purple-500/10' },
  { type: 'task', label: 'Tasks', icon: CheckSquare, color: 'text-blue-500 bg-blue-500/10' },
  { type: 'hearing', label: 'Hearings', icon: Gavel, color: 'text-emerald-500 bg-emerald-500/10 dark:text-emerald-400' },
  { type: 'meeting', label: 'Meetings', icon: Handshake, color: 'text-cyan-500 bg-cyan-500/10' },
  { type: 'filing', label: 'Filings', icon: FolderOpen, color: 'text-amber-500 bg-amber-500/10' },
  { type: 'file', label: 'Files', icon: Paperclip, color: 'text-rose-500 bg-rose-500/10' },
];

const PANE_ENTITY: Record<ChatEntityType, string> = {
  deliverable: 'deliverables',
  task: 'tasks',
  hearing: 'hearings',
  meeting: 'meetings',
  filing: 'deliverables',
  file: 'files',
};

function formatDate(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null;
  const d = new Date(toManilaInstant(dateStr));
  if (isNaN(d.getTime())) return null;
  const days = daysBetween(manilaToday(), toManilaDay(d));
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days === -1) return 'Yesterday';
  return formatManila(d);
}

function isWithinWeek(dateStr: string | null | undefined): boolean {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return false;
  const now = Date.now();
  const diff = d.getTime() - now;
  return diff >= 0 && diff <= 7 * 86_400_000;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  matterId: string;
  matterName: string;
  matterCode?: string | null;
  memberIds?: string[];
  team?: Record<string, { name: string; initials: string; role?: string; position?: string }>;
}

export default function ChannelInfoPanel({
  isOpen,
  onClose,
  matterId,
  matterName,
  matterCode,
  memberIds = [],
  team = {},
}: Props) {
  const { openPane } = useDetailPane();
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<ChatEntityType | 'all' | 'members'>('all');
  const [entities, setEntities] = useState<EntityRef[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    fetch(`/api/chat/entities?all=1&matterId=${matterId}`)
      .then((r) => r.json())
      .then((data) => setEntities(data.entities ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [isOpen, matterId]);

  if (!isOpen) return null;

  const filtered = entities.filter((e) => {
    if (activeTab === 'all' || activeTab === 'members') return true;
    const matchesTab = e.type === activeTab;
    const matchesSearch = !search || e.name.toLowerCase().includes(search.toLowerCase());
    return matchesTab && matchesSearch;
  }).filter((e) => {
    if (activeTab === 'all') {
      return !search || e.name.toLowerCase().includes(search.toLowerCase());
    }
    return true;
  });

  const grouped: Record<string, EntityRef[]> = activeTab === 'all'
    ? ENTITY_TABS.reduce<Record<string, EntityRef[]>>((acc, tab) => {
        const items = filtered.filter((e) => e.type === tab.type);
        if (items.length > 0) acc[tab.type] = items;
        return acc;
      }, {})
    : activeTab !== 'members'
      ? { [activeTab]: filtered }
      : {};

  const handleEntityClick = (entity: EntityRef) => {
    openPane(PANE_ENTITY[entity.type], entity.id);
    onClose();
  };

  return (
    <div className="absolute inset-0 z-10 bg-card flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--border-color)]">
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-foreground hover:bg-[var(--subtle-bg)] transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-semibold text-foreground truncate">{matterName}</h2>
          {matterCode && (
            <p className="text-[10px] text-[var(--text-muted)]">{matterCode}</p>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="px-3 py-2 border-b border-[var(--border-color)] flex gap-1 overflow-x-auto">
        <button
          onClick={() => setActiveTab('all')}
          className={`shrink-0 px-2.5 py-1 rounded-lg text-[10px] font-semibold transition-colors ${
            activeTab === 'all'
              ? 'bg-blue-500/10 text-blue-500'
              : 'text-[var(--text-muted)] hover:bg-[var(--subtle-bg)]'
          }`}
        >
          All
        </button>
        {ENTITY_TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.type}
              onClick={() => setActiveTab(tab.type)}
              className={`shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-semibold transition-colors ${
                activeTab === tab.type
                  ? 'bg-blue-500/10 text-blue-500'
                  : 'text-[var(--text-muted)] hover:bg-[var(--subtle-bg)]'
              }`}
            >
              <Icon className="w-3 h-3" />
              {tab.label}
            </button>
          );
        })}
        <button
          onClick={() => setActiveTab('members')}
          className={`shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-semibold transition-colors ${
            activeTab === 'members'
              ? 'bg-blue-500/10 text-blue-500'
              : 'text-[var(--text-muted)] hover:bg-[var(--subtle-bg)]'
          }`}
        >
          <Users className="w-3 h-3" />
          Members
        </button>
      </div>

      {/* Search — only for entity tabs */}
      {activeTab !== 'members' && (
        <div className="px-4 py-2 border-b border-[var(--border-color)]">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-muted)]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search entities..."
              autoFocus
              className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg bg-[var(--subtle-bg)] border border-[var(--border-color)] text-foreground placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-1 focus:ring-blue-500/40"
            />
          </div>
        </div>
      )}

      {/* Members list */}
      {activeTab === 'members' && (
        <div className="flex-1 overflow-y-auto px-3 py-2">
          {memberIds.length === 0 ? (
            <div className="flex items-center justify-center py-8 text-[var(--text-muted)]">
              <p className="text-xs">No members</p>
            </div>
          ) : (
            memberIds.map((id) => {
              const member = team[id];
              const name = member?.name ?? id;
              const initials = member?.initials ?? name.charAt(0);
              return (
                <div key={id} className="flex items-center gap-2.5 px-2 py-2 rounded-lg">
                  <div className="shrink-0 w-7 h-7 rounded-full bg-[var(--subtle-bg)] flex items-center justify-center text-[10px] font-semibold text-[var(--text-muted)]">
                    {initials}
                  </div>
                  <p className="text-xs text-foreground font-medium">{name}</p>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Entity list */}
      {activeTab !== 'members' && (
        <div className="flex-1 overflow-y-auto px-3 py-2">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-[var(--text-muted)]" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex items-center justify-center py-8 text-[var(--text-muted)]">
              <p className="text-xs">No entities found</p>
            </div>
          ) : (
            Object.entries(grouped).map(([type, items]) => {
              const tab = ENTITY_TABS.find((t) => t.type === type)!;
              const Icon = tab.icon;
              return (
                <div key={type} className="mb-3">
                  {activeTab === 'all' && (
                    <p className="px-1 py-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                      {tab.label}
                    </p>
                  )}
                  {(items as EntityRef[])
                    .slice()
                    .sort((a, b) => {
                      if (!['hearing', 'meeting', 'filing'].includes(a.type)) return 0;
                      if (!a.date) return 1;
                      if (!b.date) return -1;
                      return new Date(a.date).getTime() - new Date(b.date).getTime();
                    })
                    .map((entity) => {
                      const showDate = ['hearing', 'meeting', 'filing'].includes(entity.type);
                      const showStatus = ['deliverable', 'task'].includes(entity.type);
                      const dateLabel = showDate ? formatDate(entity.date) : null;
                      const urgent = showDate && isWithinWeek(entity.date);
                      return (
                        <button
                          key={`${entity.type}-${entity.id}`}
                          onClick={() => handleEntityClick(entity)}
                          className="w-full flex items-center gap-2.5 px-2 py-2 rounded-lg hover:bg-[var(--subtle-bg)] transition-colors text-left"
                        >
                          <div className={`shrink-0 w-7 h-7 rounded-lg flex items-center justify-center ${tab.color}`}>
                            <Icon className="w-3.5 h-3.5" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium text-foreground truncate">{entity.name}</p>
                            <div className="flex items-center gap-2">
                              {showStatus && entity.status && (
                                <span className="text-[10px] text-[var(--text-muted)] truncate">{entity.status}</span>
                              )}
                              {showDate && dateLabel && (
                                <span className={`text-[10px] ${urgent ? 'text-red-500 font-medium dark:text-red-400' : 'text-[var(--text-muted)]'}`}>
                                  {dateLabel}
                                </span>
                              )}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
