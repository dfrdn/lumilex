'use client';

import DataTable, { type ColumnDef } from '@/components/DataTable';
import DateChip from '@/components/DateChip';
import TaskMarkDoneButton from '@/components/TaskMarkDoneButton';
import type { TaskListing } from '@/types/notion';
import { TASK_STATUS } from '@/lib/task-status';

const statusColors: Record<string, string> = {
  [TASK_STATUS.NOT_STARTED]: 'bg-gray-100 text-gray-600 dark:bg-stone-500/15 dark:text-stone-300',
  [TASK_STATUS.IN_PROGRESS]: 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',
  [TASK_STATUS.DONE]: 'bg-green-100 text-green-700 dark:bg-emerald-500/15 dark:text-emerald-300',
};

const priorityColors: Record<string, string> = {
  High: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300',
  Medium: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-500/15 dark:text-yellow-300',
  Low: 'bg-gray-100 text-gray-500 dark:bg-stone-500/15 dark:text-stone-400',
};

const columns: ColumnDef<TaskListing>[] = [
  {
    key: 'name',
    label: 'Name',
    getValue: (t) => t.name,
    render: (t) => t.name || '(Untitled)',
  },
  {
    key: 'done',
    label: 'Done',
    sortable: false,
    getValue: (t) => t.done,
    render: (t) => <TaskMarkDoneButton taskId={t.id} done={t.done} />,
  },
  {
    key: 'matter',
    label: 'Matter',
    getValue: (t) => t.matter,
    render: (t) => <span className="text-sm text-stone-600 dark:text-stone-300">{t.matter || '—'}</span>,
  },
  {
    key: 'status',
    label: 'Status',
    getValue: (t) => t.status,
    render: (t) => {
      const cls = statusColors[t.status] ?? 'bg-gray-100 text-gray-600 dark:bg-stone-500/15 dark:text-stone-300';
      return (
        <span className={`text-[11px] rounded-full px-2 py-0.5 font-medium ring-1 ring-inset ring-current/10 ${cls}`}>
          {t.status || '—'}
        </span>
      );
    },
  },
  {
    key: 'priority',
    label: 'Priority',
    getValue: (t) => t.priority,
    render: (t) => {
      if (!t.priority) return <span className="text-stone-400 dark:text-stone-500">—</span>;
      const cls = priorityColors[t.priority] ?? 'bg-gray-100 text-gray-500 dark:bg-stone-500/15 dark:text-stone-400';
      return (
        <span className={`text-[11px] rounded-full px-2 py-0.5 font-medium ring-1 ring-inset ring-current/10 ${cls}`}>
          {t.priority}
        </span>
      );
    },
  },
  {
    key: 'dueDate',
    label: 'Due Date',
    getValue: (t) => t.dueDate,
    render: (t) => <DateChip date={t.dueDate} />,
  },
];

interface Props {
  data: TaskListing[];
  userId: string;
  role: string;
}

export default function TasksTable({ data, userId, role }: Props) {
  return (
    <DataTable
      data={data}
      columns={columns}
      getRowHref={(t) => `/dashboard/tasks/${t.id}`}
      getRowId={(t) => t.id}
      entityLabel="Task"
      defaultSortKey="dueDate"
      userId={userId}
      isMyItem={(t, uid) => t.assigneeIds.includes(uid)}
      role={role}
    />
  );
}
