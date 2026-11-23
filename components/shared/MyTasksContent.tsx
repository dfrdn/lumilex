import { getSession } from '@/lib/session';
import {
  getTasksToday,
  getTasksThisWeek,
  getOpenTasks,
} from '@/lib/queries/tasks';

import { todayISO } from '@/lib/dates';
import { CheckSquare, AlertTriangle, Calendar } from 'lucide-react';
import AdminEntityLinkInterceptor from '@/components/admin/AdminEntityLinkInterceptor';
import SectionCard from '@/components/ui/SectionCard';
import ItemRow from '@/components/ItemRow';
import EmptyState from '@/components/ui/EmptyState';
import DateChip from '@/components/DateChip';
import TaskMarkDoneButton from '@/components/TaskMarkDoneButton';

import type { NotionTask } from '@/types/notion';

export type ShellMode = 'admin' | 'finance';

interface Props {
  shellMode: ShellMode;
  userId: string;
}

function BodyWrapper({
  shellMode,
  children,
}: {
  shellMode: ShellMode;
  children: React.ReactNode;
}) {
  if (shellMode === 'admin') {
    return <AdminEntityLinkInterceptor>{children}</AdminEntityLinkInterceptor>;
  }
  return <>{children}</>;
}

export default async function MyTasksContent({ shellMode, userId }: Props) {
  const session = await getSession();
  if (!session) return null;

  const [t, w, o] = await Promise.allSettled([
    getTasksToday(session.firmId, userId),
    getTasksThisWeek(session.firmId, userId),
    getOpenTasks(session.firmId, userId),
  ]);
  const todayTasks: NotionTask[] = t.status === 'fulfilled' ? t.value : [];
  const weekTasks: NotionTask[] = w.status === 'fulfilled' ? w.value : [];
  const openTasks: NotionTask[] = o.status === 'fulfilled' ? o.value : [];

  const today = todayISO();
  const overdue = openTasks.filter((t) => t.dueDate && t.dueDate < today);
  const upcoming = openTasks.filter((t) => !t.dueDate || t.dueDate > today);

  return (
    <>
      <div className="mb-8 animate-fade-up">
        <h1 className="font-serif text-2xl sm:text-3xl font-semibold tracking-tight text-foreground">
          My Tasks
        </h1>
        <div className="greeting-accent mt-2" />
        <p className="text-sm text-[var(--text-secondary)] mt-2.5">
          Everything assigned to you, in one place.
        </p>
      </div>

      <BodyWrapper shellMode={shellMode}>
        <div className="space-y-6">
          <SectionCard
            title="Due Today"
            icon={<CheckSquare className="w-5 h-5" />}
            count={todayTasks.length}
            className="border-l-4 border-l-gold-600"
          >
            {todayTasks.length === 0 ? (
              <EmptyState message="No tasks due today" />
            ) : (
              todayTasks.map((t) => (
                <ItemRow
                  key={t.id}
                  href={`/dashboard/tasks/${t.id}`}
                  title={t.name}
                  subtitle={t.matter || undefined}
                  badge={t.priority || undefined}
                  meta={<DateChip date={t.dueDate} />}
                  leading={<TaskMarkDoneButton taskId={t.id} done={t.done} />}
                />
              ))
            )}
          </SectionCard>

          <SectionCard
            title="Overdue"
            icon={<AlertTriangle className="w-5 h-5" />}
            count={overdue.length}
            className={
              overdue.length > 0
                ? 'border-l-4 border-l-red-400 dark:border-l-red-500/70'
                : ''
            }
          >
            {overdue.length === 0 ? (
              <EmptyState message="No overdue tasks" />
            ) : (
              overdue.map((t) => (
                <ItemRow
                  key={t.id}
                  href={`/dashboard/tasks/${t.id}`}
                  title={t.name}
                  subtitle={t.matter || undefined}
                  badge={t.priority || undefined}
                  meta={<DateChip date={t.dueDate} />}
                  leading={<TaskMarkDoneButton taskId={t.id} done={t.done} />}
                />
              ))
            )}
          </SectionCard>

          <SectionCard
            title="This Week"
            icon={<Calendar className="w-5 h-5" />}
            count={weekTasks.length}
          >
            {weekTasks.length === 0 ? (
              <EmptyState message="No tasks this week" />
            ) : (
              weekTasks.map((t) => (
                <ItemRow
                  key={t.id}
                  href={`/dashboard/tasks/${t.id}`}
                  title={t.name}
                  subtitle={t.matter || undefined}
                  badge={t.priority || undefined}
                  meta={<DateChip date={t.dueDate} />}
                  leading={<TaskMarkDoneButton taskId={t.id} done={t.done} />}
                />
              ))
            )}
          </SectionCard>

          <SectionCard
            title="Upcoming (later)"
            icon={<Calendar className="w-5 h-5" />}
            count={upcoming.length}
            collapsible
            defaultOpen={false}
          >
            {upcoming.length === 0 ? (
              <EmptyState message="No upcoming tasks" />
            ) : (
              upcoming.map((t) => (
                <ItemRow
                  key={t.id}
                  href={`/dashboard/tasks/${t.id}`}
                  title={t.name}
                  subtitle={t.matter || undefined}
                  badge={t.priority || undefined}
                  meta={<DateChip date={t.dueDate} />}
                  leading={<TaskMarkDoneButton taskId={t.id} done={t.done} />}
                />
              ))
            )}
          </SectionCard>
        </div>
      </BodyWrapper>
    </>
  );
}
