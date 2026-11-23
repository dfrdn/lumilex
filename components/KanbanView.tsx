'use client';

import Link from 'next/link';
import DateChip from '@/components/DateChip';
import DeliverableActionButtons, { type DeliverableActionPatch } from '@/components/DeliverableActionButtons';
import type { NotionDeliverable } from '@/types/notion';

// Priority badge colors (matches ItemRow colorMap)
const priorityColors: Record<string, string> = {
  High: 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300',
  Medium: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-500/20 dark:text-yellow-300',
  Low: 'bg-gray-100 text-gray-500 dark:bg-stone-800 dark:text-stone-400',
};

interface StatusColorSet {
  dot: string;
  text: string;
  badge: string;
}

interface StatusGroup {
  status: string;
  items: NotionDeliverable[];
}

interface Props {
  groups: StatusGroup[];
  statusColors: Record<string, StatusColorSet>;
  defaultStatusColor: StatusColorSet;
  readOnly?: boolean;
  onActionComplete?: (id: string, patch: DeliverableActionPatch) => void;
}

// ── Kanban Card ───────────────────────────────────────────────────

function KanbanCard({
  d,
  readOnly,
  onActionComplete,
}: {
  d: NotionDeliverable;
  readOnly?: boolean;
  onActionComplete?: (id: string, patch: DeliverableActionPatch) => void;
}) {
  return (
    <div className="relative bg-white border border-stone-200/70 rounded-lg p-3 hover:shadow-md hover:border-stone-300 transition-all duration-150 group dark:bg-stone-900 dark:border-stone-700/70 dark:hover:border-stone-600">
      <Link
        href={`/dashboard/deliverables/${d.id}`}
        className="block"
      >
        <p className="text-sm font-medium text-stone-800 group-hover:text-gold-700 line-clamp-2 transition-colors duration-150 dark:text-stone-100">
          {d.name || '(Untitled)'}
        </p>
        {d.client && (
          <p className="text-xs text-stone-500 mt-1 truncate dark:text-stone-400">{d.client}</p>
        )}
        <div className="flex items-center justify-between mt-2">
          {d.priority ? (
            <span
              className={`text-[10px] rounded-full px-1.5 py-0.5 font-medium ring-1 ring-inset ring-current/10 ${
                priorityColors[d.priority] ?? 'bg-gray-100 text-gray-500 dark:bg-stone-800 dark:text-stone-400'
              }`}
            >
              {d.priority}
            </span>
          ) : (
            <span />
          )}
          <DateChip date={d.externalDueDate ?? (d.reviewDates.length > 0 ? d.reviewDates[d.reviewDates.length - 1] : null)} />
        </div>
      </Link>
      {!readOnly && (
        <div className="mt-2 pt-2 border-t border-stone-100 dark:border-stone-800">
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
            variant="compact"
            stacked
            onActionComplete={onActionComplete ? (patch) => onActionComplete(d.id, patch) : undefined}
          />
        </div>
      )}
    </div>
  );
}

// ── Kanban Column ─────────────────────────────────────────────────

function KanbanColumn({
  group,
  colors,
  readOnly,
  onActionComplete,
}: {
  group: StatusGroup;
  colors: StatusColorSet;
  readOnly?: boolean;
  onActionComplete?: (id: string, patch: DeliverableActionPatch) => void;
}) {
  return (
    <div className="min-w-[220px] w-[220px] shrink-0 flex flex-col">
      {/* Column header */}
      <div className="flex items-center gap-2 mb-2.5 px-1">
        <span className={`w-2 h-2 rounded-full shrink-0 ${colors.dot}`} />
        <span className={`text-xs font-semibold uppercase tracking-wider ${colors.text}`}>
          {group.status}
        </span>
        <span
          className={`text-[10px] tabular-nums font-medium rounded-full px-1.5 py-px ${colors.badge}`}
        >
          {group.items.length}
        </span>
      </div>

      {/* Cards */}
      <div className="space-y-2 flex-1">
        {group.items.map((d) => (
          <KanbanCard key={d.id} d={d} readOnly={readOnly} onActionComplete={onActionComplete} />
        ))}
      </div>
    </div>
  );
}

// ── Main Kanban View ──────────────────────────────────────────────

export default function KanbanView({ groups, statusColors, defaultStatusColor, readOnly, onActionComplete }: Props) {
  return (
    <div className="flex gap-3 overflow-x-auto pb-2 -mx-5 px-5 scrollbar-thin">
      {groups.map((group) => (
        <KanbanColumn
          key={group.status}
          group={group}
          colors={statusColors[group.status] ?? defaultStatusColor}
          readOnly={readOnly}
          onActionComplete={onActionComplete}
        />
      ))}
    </div>
  );
}
