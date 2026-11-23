import { todayISO, thisWeekRange } from '@/lib/dates';
import { CheckSquare } from 'lucide-react';
import SectionCard from '@/components/ui/SectionCard';
import ItemRow from '@/components/ItemRow';
import EmptyState from '@/components/ui/EmptyState';
import LoadError from '@/components/ui/LoadError';
import DateChip from '@/components/DateChip';
import TaskMarkDoneButton from '@/components/TaskMarkDoneButton';
import type { NotionTask } from '@/types/notion';

/** `openTasks` is null when they failed to load. */
export default function DashboardMyTasks({ openTasks }: { openTasks: NotionTask[] | null }) {
  if (!openTasks) {
    return (
      <SectionCard id="my-tasks" title="My Tasks" icon={<CheckSquare className="w-5 h-5" />}>
        <LoadError />
      </SectionCard>
    );
  }

  const today = todayISO();
  const { end: weekEnd } = thisWeekRange();

  // Partition every open task into exactly one bucket (undated tasks fall to "Upcoming").
  const overdue = openTasks.filter((t) => t.dueDate && t.dueDate < today);
  const dueToday = openTasks.filter((t) => t.dueDate === today);
  const thisWeek = openTasks.filter((t) => t.dueDate && t.dueDate > today && t.dueDate <= weekEnd);
  const later = openTasks.filter((t) => !t.dueDate || t.dueDate > weekEnd);

  const groups = [
    { key: 'overdue', label: 'Overdue', tasks: overdue, accent: 'text-red-600 dark:text-red-400' },
    { key: 'today', label: 'Due Today', tasks: dueToday, accent: 'text-amber-600 dark:text-amber-400' },
    { key: 'week', label: 'This Week', tasks: thisWeek, accent: 'text-[var(--text-secondary)]' },
    { key: 'later', label: 'Upcoming', tasks: later, accent: 'text-[var(--text-secondary)]' },
  ].filter((g) => g.tasks.length > 0);

  return (
    <SectionCard
      id="my-tasks"
      title="My Tasks"
      icon={<CheckSquare className="w-5 h-5" />}
      count={openTasks.length}
      collapsible
      defaultOpen={openTasks.length > 0}
      className={overdue.length > 0 ? 'border-rose-200 dark:border-rose-500/25' : ''}
    >
      {openTasks.length === 0 ? (
        <EmptyState message="No open tasks — you're all caught up!" />
      ) : (
        <div className="space-y-5">
          {groups.map((g) => (
            <div key={g.key}>
              <div className="flex items-center gap-2 mb-1.5 px-1">
                <span className={`text-[11px] font-semibold uppercase tracking-wider ${g.accent}`}>{g.label}</span>
                <span className="text-[11px] font-mono text-[var(--text-muted)] tabular-nums">{g.tasks.length}</span>
              </div>
              <div className="space-y-0.5">
                {g.tasks.map((t) => (
                  <ItemRow
                    key={t.id}
                    href={`/dashboard/tasks/${t.id}`}
                    openPane={{ entity: 'tasks', id: t.id }}
                    title={t.name}
                    subtitle={t.matter || undefined}
                    badge={t.priority || undefined}
                    meta={<DateChip date={t.dueDate} />}
                    leading={<TaskMarkDoneButton taskId={t.id} done={t.done} />}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}
