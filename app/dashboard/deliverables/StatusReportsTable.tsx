'use client';

import { useState, useMemo, useEffect } from 'react';
import Link from 'next/link';
import { LayoutGrid, Table2, Gavel, FolderOpen, File as FileIcon } from 'lucide-react';
import { usePersistedState } from '@/hooks/use-persisted-state';
import DataTable, { type ColumnDef } from '@/components/DataTable';
import DateChip from '@/components/DateChip';
import Avatar from '@/components/Avatar';
import DeliverableActionButtons, { type DeliverableActionPatch } from '@/components/DeliverableActionButtons';
import DeliverableBoard from '@/components/DeliverableBoard';
import { useDeliverableRowSync } from '@/components/DeliverableUpdatesContext';
import EmptyState from '@/components/ui/EmptyState';
import StatusReportParentEditor from '@/components/StatusReportParentEditor';
import { STATUS_COLORS, DEFAULT_STATUS_COLOR, groupByStatus, DELIVERABLE_STATUS } from '@/lib/deliverable-status';
import type { StatusReportListing } from '@/types/notion';

const statusColors: Record<string, string> = {
  [DELIVERABLE_STATUS.NOT_STARTED]: 'bg-gray-100 text-gray-600 dark:bg-stone-500/15 dark:text-stone-300',
  [DELIVERABLE_STATUS.DRAFTING]: 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',
  [DELIVERABLE_STATUS.UNDER_REVIEW]: 'bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300',
  [DELIVERABLE_STATUS.REVISING]: 'bg-purple-100 text-purple-700 dark:bg-purple-500/15 dark:text-purple-300',
  [DELIVERABLE_STATUS.FINALIZING]: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300',
  [DELIVERABLE_STATUS.PRE_FINALIZED]: 'bg-pink-100 text-pink-700 dark:bg-pink-500/15 dark:text-pink-300',
  [DELIVERABLE_STATUS.AWAITING_CLIENT]: 'bg-gold-100 text-gold-700 dark:bg-gold-500/15 dark:text-gold-300',
  [DELIVERABLE_STATUS.OUTBOX]: 'bg-teal-100 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300',
};

function PeopleInline({ ids, initialsById, avatarsById }: { ids: string[]; initialsById: Record<string, string>; avatarsById?: Record<string, string | null> }) {
  if (ids.length === 0) return <span className="text-stone-400 dark:text-stone-500">—</span>;
  const shown = ids.slice(0, 3);
  const extra = ids.length - shown.length;
  return (
    <div className="flex items-center -space-x-1">
      {shown.map((id, i) => (
        <Avatar
          key={id + i}
          avatarUrl={avatarsById?.[id] ?? null}
          initials={initialsById[id] ?? '–'}
          title={initialsById[id] ?? id}
          size={24}
          className="ring-2 ring-white dark:ring-stone-900"
          fallbackClassName="text-[10px] font-bold bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300"
        />
      ))}
      {extra > 0 && (
        <span className="w-6 h-6 rounded-full text-[10px] font-medium flex items-center justify-center ring-2 ring-white dark:ring-stone-900 bg-stone-100 text-stone-500 dark:bg-stone-700 dark:text-stone-300">
          +{extra}
        </span>
      )}
    </div>
  );
}

function buildColumns(
  initialsById: Record<string, string>,
  avatarsById: Record<string, string | null>,
  canEditParent: boolean,
  onActionComplete: (id: string, patch: DeliverableActionPatch) => void,
): ColumnDef<StatusReportListing>[] {
  return [
    {
      key: 'name',
      label: 'Name',
      getValue: (d) => d.name,
      render: (d) => d.name || '(Untitled)',
    },
    {
      key: 'matter',
      label: 'Matter',
      getValue: (d) => d.matter,
      render: (d) => <span className="text-sm text-stone-600 dark:text-stone-300">{d.matter || '—'}</span>,
    },
    {
      key: 'parent',
      label: 'Parent',
      sortable: false,
      getValue: (d) => d.parentName ?? '',
      render: (d) => {
        if (canEditParent) {
          return (
            <StatusReportParentEditor
              statusReportId={d.id}
              matterId={d.matterId}
              parentKind={d.parentKind}
              parentId={d.parentId}
              parentName={d.parentName}
            />
          );
        }
        if (!d.parentKind || !d.parentId) return <span className="text-stone-400 dark:text-stone-500">—</span>;
        const href =
          d.parentKind === 'hearing'
            ? `/dashboard/hearings/${d.parentId}`
            : d.parentKind === 'file'
              ? `/dashboard/files/${d.parentId}`
              : `/dashboard/deliverables/${d.parentId}`;
        const Icon = d.parentKind === 'hearing' ? Gavel : d.parentKind === 'file' ? FileIcon : FolderOpen;
        return (
          <Link
            href={href}
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1.5 text-xs text-stone-600 hover:text-stone-900 dark:text-stone-300 dark:hover:text-stone-100 hover:underline max-w-[220px]"
          >
            <Icon className="w-3.5 h-3.5 text-stone-400 dark:text-stone-500 shrink-0" />
            <span className="truncate">{d.parentName}</span>
          </Link>
        );
      },
    },
    {
      key: 'status',
      label: 'Status',
      getValue: (d) => d.status,
      render: (d) => {
        const cls = statusColors[d.status] ?? 'bg-gray-100 text-gray-600 dark:bg-stone-500/15 dark:text-stone-300';
        return (
          <span className={`text-[11px] rounded-full px-2 py-0.5 font-medium ring-1 ring-inset ring-current/10 ${cls}`}>
            {d.status || '—'}
          </span>
        );
      },
    },
    {
      key: 'drafter',
      label: 'Drafter',
      sortable: false,
      getValue: (d) => d.drafter.join(','),
      render: (d) => <PeopleInline ids={d.drafter} initialsById={initialsById} avatarsById={avatarsById} />,
    },
    {
      key: 'reviewer',
      label: 'Final Reviewer',
      sortable: false,
      getValue: (d) => d.reviewerIds.join(','),
      render: (d) => <PeopleInline ids={d.reviewerIds} initialsById={initialsById} avatarsById={avatarsById} />,
    },
    {
      key: 'dueDate',
      label: 'Due Date',
      getValue: (d) => d.externalDueDate,
      render: (d) => <DateChip date={d.externalDueDate} />,
    },
    {
      key: 'currentlyWith',
      label: 'Currently With',
      sortable: false,
      getValue: (d) => d.currentlyWith.join(','),
      render: (d) => <PeopleInline ids={d.currentlyWith} initialsById={initialsById} avatarsById={avatarsById} />,
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
  data: StatusReportListing[];
  userId: string;
  role: string;
  initialsById: Record<string, string>;
  avatarsById?: Record<string, string | null>;
}

const INACTIVE_DELIVERABLE_STATUSES: readonly string[] = [DELIVERABLE_STATUS.AWAITING_CLIENT];

export default function StatusReportsTable({ data, userId, role, initialsById, avatarsById = {} }: Props) {
  const [view, setView] = usePersistedState<'table' | 'board'>('statusReportsTable.view', 'table');
  const [currentlyWithMe, setCurrentlyWithMe] = useState(false);

  const [rows, setRows] = useState(data);
  useEffect(() => { setRows(data); }, [data]);

  const publishDeliverableUpdate = useDeliverableRowSync(setRows);

  const canEditParent = role === 'admin' || role === 'super_user';
  const columns = useMemo(() => buildColumns(initialsById, avatarsById, canEditParent, publishDeliverableUpdate), [initialsById, avatarsById, canEditParent, publishDeliverableUpdate]);

  const filtered = useMemo(() => {
    if (!currentlyWithMe) return rows;
    return rows.filter((d) => d.currentlyWith.includes(userId));
  }, [rows, currentlyWithMe, userId]);

  const boardGroups = useMemo(() => groupByStatus(filtered), [filtered]);

  return (
    <div>
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
          columns={columns}
          getRowHref={(d) => `/dashboard/deliverables/${d.id}`}
          getRowId={(d) => d.id}
          entityLabel="Status Report"
          persistKey="statusReportsTable"
          defaultSortKey="dueDate"
          userId={userId}
          isMyItem={(d, uid) =>
            d.currentlyWith.includes(uid) ||
            d.drafter.includes(uid) ||
            d.reviewerIds.includes(uid)
          }
          role={role}
          isActiveItem={(d) => !INACTIVE_DELIVERABLE_STATUSES.includes(d.status)}
        />
      ) : boardGroups.length === 0 ? (
        <EmptyState message="No status reports match the current filter" />
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
