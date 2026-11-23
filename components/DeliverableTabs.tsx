'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import DeliverableBoard from '@/components/DeliverableBoard';
import EmptyState from '@/components/ui/EmptyState';
import { groupByStatus } from '@/lib/deliverable-status';
import { applyDeliverablePatch, usePublishDeliverableUpdate, useDeliverableUpdates } from '@/components/DeliverableUpdatesContext';
import type { DeliverableActionPatch } from '@/components/DeliverableActionButtons';
import type { NotionDeliverable } from '@/types/notion';

interface StatusGroup {
  status: string;
  items: NotionDeliverable[];
}

interface Props {
  myGroups: StatusGroup[];
  myCount: number;
  teamGroups: StatusGroup[];
  teamCount: number;
  /** Current user's person_id — drives "drop from My Queue when no longer with me". */
  currentUserId: string;
  statusColors: Record<string, { dot: string; text: string; badge: string }>;
  defaultStatusColor: { dot: string; text: string; badge: string };
}

export default function DeliverableTabs({
  myGroups,
  myCount,
  teamGroups,
  teamCount,
  currentUserId,
  statusColors,
  defaultStatusColor,
}: Props) {
  const [tab, setTab] = useState<'my' | 'team'>('my');

  // Lift the rows into local state so workflow actions reflect immediately,
  // without a full RSC refresh. Mirror from props when the server re-fetches.
  const [myItems, setMyItems] = useState<NotionDeliverable[]>(() => myGroups.flatMap((g) => g.items));
  const [teamItems, setTeamItems] = useState<NotionDeliverable[]>(() => teamGroups.flatMap((g) => g.items));
  useEffect(() => { setMyItems(myGroups.flatMap((g) => g.items)); }, [myGroups]);
  useEffect(() => { setTeamItems(teamGroups.flatMap((g) => g.items)); }, [teamGroups]);

  // Apply a workflow patch to local state. Driven by the shared channel, so it
  // fires for actions taken here AND from the detail pane / "Due Today" list.
  const applyPatch = useCallback((id: string, patch: DeliverableActionPatch) => {
    const apply = (it: NotionDeliverable): NotionDeliverable =>
      it.id === id ? applyDeliverablePatch(it, patch) : it;

    // My Queue is filtered to deliverables currently with me — once an action
    // hands it off, drop it out of the queue. Team keeps it, just regrouped.
    setMyItems((prev) =>
      prev
        .map(apply)
        .filter((it) => it.id !== id || it.currentlyWith.includes(currentUserId)),
    );
    setTeamItems((prev) => prev.map(apply));
  }, [currentUserId]);

  useDeliverableUpdates(applyPatch);
  const publishDeliverableUpdate = usePublishDeliverableUpdate();

  const myGroupsLive = useMemo(() => groupByStatus(myItems), [myItems]);
  const teamGroupsLive = useMemo(() => groupByStatus(teamItems), [teamItems]);

  const groups = tab === 'my' ? myGroupsLive : teamGroupsLive;
  const count = tab === 'my' ? myItems.length : teamItems.length;

  return (
    <div>
      <div className="flex items-center gap-1 mb-4 bg-[var(--subtle-bg)] rounded-lg p-0.5 w-fit">
        <button
          onClick={() => setTab('my')}
          className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all duration-150 cursor-pointer ${
            tab === 'my'
              ? 'bg-[var(--card-bg)] text-[var(--text-primary)] shadow-sm'
              : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
          }`}
        >
          My Queue
          <span className="ml-1.5 text-[10px] opacity-60">{myItems.length}</span>
        </button>
        <button
          onClick={() => setTab('team')}
          className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all duration-150 cursor-pointer ${
            tab === 'team'
              ? 'bg-[var(--card-bg)] text-[var(--text-primary)] shadow-sm'
              : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
          }`}
        >
          Team
          <span className="ml-1.5 text-[10px] opacity-60">{teamItems.length}</span>
        </button>
      </div>

      {count === 0 ? (
        <EmptyState message={tab === 'my' ? 'No active deliverables' : 'No team deliverables'} />
      ) : (
        <DeliverableBoard
          groups={groups}
          statusColors={statusColors}
          defaultStatusColor={defaultStatusColor}
          onActionComplete={publishDeliverableUpdate}
        />
      )}
    </div>
  );
}
