'use client';

import DataTable, { type ColumnDef } from '@/components/DataTable';
import type { MatterGroupListing } from '@/types/matter-group';

const columns: ColumnDef<MatterGroupListing>[] = [
  {
    key: 'name',
    label: 'Group',
    getValue: (g) => g.name,
    render: (g) => <span className="font-medium text-[var(--text-primary)]">{g.name}</span>,
  },
  {
    key: 'client',
    label: 'Client',
    getValue: (g) => g.clientName,
    render: (g) => <span className="text-sm text-stone-600 dark:text-[#9B978F]">{g.clientName || '—'}</span>,
  },
  {
    key: 'matters',
    label: 'Matters',
    getValue: (g) => g.memberCount,
    render: (g) => (
      <span className="inline-flex items-center px-2 py-0.5 text-[11px] font-semibold rounded-full bg-navy-50 text-navy-700 dark:bg-navy-500/10 dark:text-navy-400 tabular-nums">
        {g.memberCount}
      </span>
    ),
  },
  {
    key: 'types',
    label: 'Types',
    getValue: (g) => g.types.join(', '),
    render: (g) => {
      if (g.types.length === 0) return <span className="text-xs text-stone-400 dark:text-stone-500">—</span>;
      return (
        <div className="flex flex-wrap gap-1">
          {g.types.slice(0, 3).map((t) => (
            <span key={t} className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-stone-100 text-stone-600 dark:bg-stone-500/10 dark:text-stone-300">
              {t}
            </span>
          ))}
          {g.types.length > 3 && (
            <span className="text-[10px] font-medium text-stone-400 dark:text-stone-500">+{g.types.length - 3}</span>
          )}
        </div>
      );
    },
    sortable: false,
  },
  {
    key: 'open_tasks',
    label: 'Open Tasks',
    getValue: (g) => g.openTaskCount,
    render: (g) => (
      <span className={`text-sm tabular-nums ${g.openTaskCount > 0 ? 'text-[var(--text-primary)]' : 'text-stone-400 dark:text-stone-500'}`}>
        {g.openTaskCount}
      </span>
    ),
  },
  {
    key: 'upcoming_hearings',
    label: 'Upcoming Hearings',
    getValue: (g) => g.upcomingHearingCount,
    render: (g) => (
      <span className={`text-sm tabular-nums ${g.upcomingHearingCount > 0 ? 'text-[var(--text-primary)]' : 'text-stone-400 dark:text-stone-500'}`}>
        {g.upcomingHearingCount}
      </span>
    ),
  },
  {
    key: 'active_deliverables',
    label: 'Active Deliverables',
    getValue: (g) => g.activeDeliverableCount,
    render: (g) => (
      <span className={`text-sm tabular-nums ${g.activeDeliverableCount > 0 ? 'text-[var(--text-primary)]' : 'text-stone-400 dark:text-stone-500'}`}>
        {g.activeDeliverableCount}
      </span>
    ),
  },
  {
    key: 'last_activity',
    label: 'Last Activity',
    getValue: (g) => g.lastActivityAt ?? '',
    render: (g) => {
      if (!g.lastActivityAt) return <span className="text-xs text-stone-400 dark:text-stone-500">—</span>;
      const d = new Date(g.lastActivityAt);
      return <span className="text-xs text-stone-500 dark:text-stone-400">{d.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' })}</span>;
    },
    defaultVisible: true,
  },
];

interface Props {
  data: MatterGroupListing[];
  role: string;
}

export default function MatterGroupsTable({ data, role }: Props) {
  return (
    <DataTable
      data={data}
      columns={columns}
      getRowHref={(g) => `/dashboard/matter-groups/${g.rootId}`}
      getRowId={(g) => g.rootId}
      entityLabel="Matter Group"
      defaultSortKey="name"
      role={role}
    />
  );
}
