'use client';

import { useMemo } from 'react';
import {
  List,
  Columns,
  ArrowUpDown,
} from 'lucide-react';

import { usePersistedState } from '@/hooks/use-persisted-state';
import StatusGroup from '@/components/StatusGroup';
import ItemRow from '@/components/ItemRow';
import DateChip from '@/components/DateChip';
import KanbanView from '@/components/KanbanView';
import DeliverableActionButtons, { type DeliverableActionPatch } from '@/components/DeliverableActionButtons';
import type { NotionDeliverable } from '@/types/notion';

// ── Types ─────────────────────────────────────────────────────────

interface StatusColorSet {
  dot: string;
  text: string;
  badge: string;
}

interface DeliverableGroup {
  status: string;
  items: NotionDeliverable[];
}

type ViewMode = 'list' | 'kanban';
type SortMode = 'workflow' | 'count' | 'due-date';
type ItemSortMode = 'deadline' | 'date-received';

interface Props {
  groups: DeliverableGroup[];
  statusColors: Record<string, StatusColorSet>;
  defaultStatusColor: StatusColorSet;
  readOnly?: boolean;
  /** Notifies the parent so it can splice/regroup the row in place after an action. */
  onActionComplete?: (id: string, patch: DeliverableActionPatch) => void;
}

// ── Helpers ───────────────────────────────────────────────────────

function earliestDueDate(items: NotionDeliverable[]): string {
  const dates = items
    .map((d) => d.externalDueDate ?? (d.reviewDates.length > 0 ? d.reviewDates[d.reviewDates.length - 1] : null))
    .filter(Boolean) as string[];
  if (dates.length === 0) return '\uffff';
  return dates.sort()[0];
}

// ── Component ─────────────────────────────────────────────────────

export default function DeliverableBoard({
  groups,
  statusColors,
  defaultStatusColor,
  readOnly = false,
  onActionComplete,
}: Props) {
  const [view, setView] = usePersistedState<ViewMode>('deliverableBoard.view', 'list');
  const [sortBy, setSortBy] = usePersistedState<SortMode>('deliverableBoard.sortBy', 'workflow');
  const [itemSort, setItemSort] = usePersistedState<ItemSortMode>('deliverableBoard.itemSort', 'deadline');

  const sortedGroups = useMemo(() => {
    const base = sortBy === 'workflow'
      ? groups
      : sortBy === 'count'
        ? [...groups].sort((a, b) => b.items.length - a.items.length)
        : [...groups].sort((a, b) =>
            earliestDueDate(a.items).localeCompare(earliestDueDate(b.items)),
          );

    return base.map((group) => ({
      ...group,
      items: [...group.items].sort((a, b) => {
        if (itemSort === 'deadline') {
          const aDate = a.externalDueDate ?? (a.reviewDates.length > 0 ? a.reviewDates[a.reviewDates.length - 1] : null) ?? '\uffff';
          const bDate = b.externalDueDate ?? (b.reviewDates.length > 0 ? b.reviewDates[b.reviewDates.length - 1] : null) ?? '\uffff';
          return aDate.localeCompare(bDate);
        }
        // date-received: last modified, newest first (so deliverables recently
        // transferred / updated float to the top). Brand-new rows with no
        // synced timestamps yet are treated as "just now" (sentinel '\uffff')
        // so they sort to the top, not the bottom.
        const aDate = a.lastEditedAt ?? a.createdTime ?? '\uffff';
        const bDate = b.lastEditedAt ?? b.createdTime ?? '\uffff';
        return bDate.localeCompare(aDate);
      }),
    }));
  }, [groups, sortBy, itemSort]);

  return (
    <div>
      {/* ── Toolbar ──────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-3 pb-3 border-b border-[var(--border-color)]">
        {/* View toggle */}
        <div className="flex items-center gap-0.5 bg-subtle rounded-lg p-0.5">
          <button
            type="button"
            onClick={() => setView('list')}
            className={`flex items-center gap-1 px-2.5 py-1 max-sm:min-h-9 text-xs font-medium rounded-md transition-all duration-150 cursor-pointer ${
              view === 'list'
                ? 'bg-card text-foreground shadow-sm border border-[var(--border-color)]'
                : 'text-[var(--text-muted)] hover:text-foreground'
            }`}
          >
            <List className="w-3.5 h-3.5" />
            List
          </button>
          <button
            type="button"
            onClick={() => setView('kanban')}
            className={`flex items-center gap-1 px-2.5 py-1 max-sm:min-h-9 text-xs font-medium rounded-md transition-all duration-150 cursor-pointer ${
              view === 'kanban'
                ? 'bg-card text-foreground shadow-sm border border-[var(--border-color)]'
                : 'text-[var(--text-muted)] hover:text-foreground'
            }`}
          >
            <Columns className="w-3.5 h-3.5" />
            Board
          </button>
        </div>

        {/* Sort selects */}
        <div className="flex items-center gap-3 text-[var(--text-secondary)]">
          <div className="flex items-center gap-1.5">
            <ArrowUpDown className="w-3.5 h-3.5" />
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortMode)}
              className="text-xs bg-transparent border border-[var(--border-color)] rounded-md px-2 py-1 hover:border-[var(--border-hover)] focus:outline-none focus:ring-1 focus:ring-gold-400/30 cursor-pointer text-foreground"
            >
              <option value="workflow">Groups: Workflow</option>
              <option value="count">Groups: By Count</option>
              <option value="due-date">Groups: By Due Date</option>
            </select>
          </div>
          <select
            value={itemSort}
            onChange={(e) => setItemSort(e.target.value as ItemSortMode)}
            className="text-xs bg-transparent border border-[var(--border-color)] rounded-md px-2 py-1 hover:border-[var(--border-hover)] focus:outline-none focus:ring-1 focus:ring-gold-400/30 cursor-pointer text-foreground"
          >
            <option value="deadline">Items: By Deadline</option>
            <option value="date-received">Items: Newest First</option>
          </select>
        </div>
      </div>

      {/* ── Content ──────────────────────────────────────────── */}
      {view === 'list' ? (
        <div className="space-y-3">
          {sortedGroups.map((group) => {
            const colors = statusColors[group.status] ?? defaultStatusColor;
            return (
              <StatusGroup
                key={group.status}
                label={group.status}
                count={group.items.length}
                dotClass={colors.dot}
                textClass={colors.text}
                badgeClass={colors.badge}
              >
                {group.items.map((d) => (
                  <ItemRow
                    key={d.id}
                    href={`/dashboard/deliverables/${d.id}`}
                    openPane={{ entity: 'deliverables', id: d.id }}
                    title={d.name}
                    subtitle={d.client || undefined}
                    meta={<DateChip date={d.externalDueDate ?? (d.reviewDates.length > 0 ? d.reviewDates[d.reviewDates.length - 1] : null)} />}
                    right={
                      readOnly ? undefined : (
                        <DeliverableActionButtons
                          deliverableId={d.id}
                          deliverableName={d.name}
                          status={d.status}
                          type={d.type}
                          matterId={d.matterId}
                          matterName={d.matter}
                          drafterIds={d.drafter}
                          reviewerIds={d.reviewerIds}
                          currentlyWithIds={d.currentlyWith}
                          variant="menu"
                          onActionComplete={onActionComplete ? (patch) => onActionComplete(d.id, patch) : undefined}
                        />
                      )
                    }
                  />
                ))}
              </StatusGroup>
            );
          })}
        </div>
      ) : (
        <KanbanView
          groups={sortedGroups}
          statusColors={statusColors}
          defaultStatusColor={defaultStatusColor}
          readOnly={readOnly}
          onActionComplete={onActionComplete}
        />
      )}
    </div>
  );
}
