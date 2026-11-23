'use client';

import { useMemo, useState, useEffect } from 'react';
import { AlertTriangle, Clock3, Eye, Hourglass, LayoutGrid, Table2 } from 'lucide-react';
import { usePersistedState } from '@/hooks/use-persisted-state';
import DataTable, { type ColumnDef, type TableCard } from '@/components/DataTable';
import { daysFromToday, joinDetail } from '@/lib/list-cards';
import DateChip from '@/components/DateChip';
import DeliverableActionButtons, { type DeliverableActionPatch } from '@/components/DeliverableActionButtons';
import DeliverableBoard from '@/components/DeliverableBoard';
import { useDeliverableRowSync } from '@/components/DeliverableUpdatesContext';
import EmptyState from '@/components/ui/EmptyState';
import { PILL_TONE } from '@/components/ui/tone';
import { statusTone } from '@/lib/status-tone';
import { STATUS_COLORS, DEFAULT_STATUS_COLOR, groupByStatus, DELIVERABLE_STATUS } from '@/lib/deliverable-status';
import type { DeliverableListing } from '@/types/notion';
import { manilaToday } from '@/lib/dates';

function buildColumns(
  onActionComplete: (id: string, patch: DeliverableActionPatch) => void,
): ColumnDef<DeliverableListing>[] {
  return [
  {
    key: 'name',
    label: 'Name',
    getValue: (d) => d.name,
    render: (d) => d.name || '(Untitled)',
  },
  {
    key: 'client',
    label: 'Client',
    getValue: (d) => d.client,
    render: (d) => <span className="text-sm text-stone-600 dark:text-stone-300">{d.client || '—'}</span>,
    defaultVisible: false,
  },
  {
    key: 'matter',
    label: 'Matter',
    getValue: (d) => d.matter,
    render: (d) => <span className="text-sm text-stone-600 dark:text-stone-300">{d.matter || '—'}</span>,
  },
  {
    key: 'status',
    label: 'Status',
    getValue: (d) => d.status,
    render: (d) => {
      const cls = PILL_TONE[statusTone(d.status)];
      return (
        <span className={`text-[11px] rounded-full px-2 py-0.5 font-medium whitespace-nowrap border ${cls}`}>
          {d.status || '—'}
        </span>
      );
    },
  },
  {
    key: 'priority',
    label: 'Priority',
    getValue: (d) => d.priority,
    render: (d) => {
      if (!d.priority) return <span className="text-stone-400 dark:text-stone-500">—</span>;
      const cls = PILL_TONE[statusTone(d.priority)];
      return (
        <span className={`text-[11px] rounded-full px-2 py-0.5 font-medium whitespace-nowrap border ${cls}`}>
          {d.priority}
        </span>
      );
    },
    defaultVisible: false,
  },
  {
    key: 'dueDate',
    label: 'Due Date',
    getValue: (d) => d.externalDueDate,
    render: (d) => <DateChip date={d.externalDueDate} />,
  },
  {
    key: 'nextReview',
    label: 'Next Review',
    getValue: (d) => {
      const upcoming = d.reviewDates.filter((rd): rd is string => !!rd && rd >= manilaToday());
      return upcoming[0] ?? d.reviewDates.filter(Boolean)[0] ?? '';
    },
    render: (d) => {
      const today = manilaToday();
      const upcoming = d.reviewDates.filter((rd): rd is string => !!rd && rd >= today);
      const date = upcoming[0] ?? d.reviewDates.filter(Boolean)[0] ?? null;
      return <DateChip date={date} />;
    },
    defaultVisible: false,
  },
  {
    key: 'actions',
    label: 'Actions',
    getValue: () => '',
    sortable: false,
    render: (d) => (
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
        onActionComplete={(patch) => onActionComplete(d.id, patch)}
      />
    ),
  },
  ];
}

interface Props {
  initialCard?: string | null;
  data: DeliverableListing[];
  userId: string;
  role: string;
  /** The rows are already the person's own, so the table offers no Mine / All of its own. */
  scopedToMe?: boolean;
}

const INACTIVE_DELIVERABLE_STATUSES: readonly string[] = [DELIVERABLE_STATUS.AWAITING_CLIENT];

const isMine = (d: DeliverableListing, uid: string) =>
  d.currentlyWith.includes(uid) || d.drafter.includes(uid) || d.reviewerIds.includes(uid);

const cards: TableCard<DeliverableListing>[] = [
  {
    key: 'overdue',
    label: 'Overdue',
    sub: 'past the due date',
    icon: <AlertTriangle className="w-4 h-4" />,
    accent: 'rose',
    match: (d) => (daysFromToday(d.externalDueDate) ?? 0) < 0 && d.status !== DELIVERABLE_STATUS.AWAITING_CLIENT,
  },
  {
    key: 'soon',
    label: 'Due in 7 days',
    sub: 'today included',
    icon: <Clock3 className="w-4 h-4" />,
    accent: 'amber',
    match: (d) => {
      const n = daysFromToday(d.externalDueDate);
      return n !== null && n >= 0 && n <= 7 && d.status !== DELIVERABLE_STATUS.AWAITING_CLIENT;
    },
  },
  { key: 'review', label: 'In review', sub: 'with a reviewer', icon: <Eye className="w-4 h-4" />, accent: 'navy', match: (d) => d.status === DELIVERABLE_STATUS.UNDER_REVIEW },
  { key: 'client', label: 'Awaiting client', sub: 'sent for comment or sign-off', icon: <Hourglass className="w-4 h-4" />, accent: 'gold', match: (d) => d.status === DELIVERABLE_STATUS.AWAITING_CLIENT },
];

export default function DeliverablesTable({ initialCard, data, userId, role, scopedToMe = false }: Props) {
  const [view, setView] = usePersistedState<'table' | 'board'>('deliverablesTable.view', 'table');
  const [currentlyWithMe, setCurrentlyWithMe] = usePersistedState<boolean>('deliverablesTable.currentlyWithMe', false);

  const [rows, setRows] = useState(data);
  useEffect(() => { setRows(data); }, [data]);

  const publishDeliverableUpdate = useDeliverableRowSync(setRows);

  const columns = useMemo(() => buildColumns(publishDeliverableUpdate), [publishDeliverableUpdate]);

  const filtered = useMemo(() => {
    if (!currentlyWithMe) return rows;
    return rows.filter((d) => d.currentlyWith.includes(userId));
  }, [rows, currentlyWithMe, userId]);

  const boardGroups = useMemo(() => groupByStatus(filtered), [filtered]);

  return (
    <div>
      {/* View toggle + Currently with me filter */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setCurrentlyWithMe(!currentlyWithMe)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-all cursor-pointer ${
              currentlyWithMe
                ? 'bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-500/30'
                : 'bg-[var(--card-bg)] text-[var(--text-muted)] border-[var(--border-color)] hover:text-[var(--text-secondary)]'
            }`}
          >
            Currently with me
          </button>
        </div>
        <div className="flex items-center gap-1 bg-[var(--subtle-bg)] rounded-lg p-0.5">
          <button
            onClick={() => setView('table')}
            className={`p-1.5 rounded-md transition-all cursor-pointer ${
              view === 'table'
                ? 'bg-[var(--card-bg)] text-[var(--text-primary)] shadow-sm'
                : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
            }`}
            title="Table view"
          >
            <Table2 className="w-4 h-4" />
          </button>
          <button
            onClick={() => setView('board')}
            className={`p-1.5 rounded-md transition-all cursor-pointer ${
              view === 'board'
                ? 'bg-[var(--card-bg)] text-[var(--text-primary)] shadow-sm'
                : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
            }`}
            title="Board view"
          >
            <LayoutGrid className="w-4 h-4" />
          </button>
        </div>
      </div>

      {view === 'table' ? (
        <DataTable
          data={filtered}
          cards={cards}
          initialCard={initialCard}
          getRowDetail={(d) => joinDetail(d.client, d.type) || null}
          columns={columns}
          getRowHref={(d) => `/dashboard/deliverables/${d.id}`}
          getRowId={(d) => d.id}
          entityLabel="Deliverable"
          persistKey="deliverablesTable"
          defaultSortKey="dueDate"
          userId={userId}
          isMyItem={scopedToMe ? undefined : isMine}
          role={role}
          isActiveItem={(d) => !INACTIVE_DELIVERABLE_STATUSES.includes(d.status)}
        />
      ) : boardGroups.length === 0 ? (
        <EmptyState message="No deliverables match the current filter" />
      ) : (
        <DeliverableBoard
          groups={boardGroups}
          statusColors={STATUS_COLORS}
          defaultStatusColor={DEFAULT_STATUS_COLOR}
          onActionComplete={publishDeliverableUpdate}
        />
      )}
    </div>
  );
}
