import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getSession } from '@/lib/session';
import {
  CheckSquare, Calendar, Briefcase, Users, Clock,
  AlertTriangle, AlertCircle, CheckCircle2,
} from 'lucide-react';
import { getTaskById } from '@/lib/queries/detail';
import {
  resolvePersonIds, getActiveTeamMembers, getAllTeamMembersAsMap,
} from '@/lib/queries/people';
import { getEntityComments } from '@/lib/queries/entity-comments';
import DetailShell from './DetailShell';
import PersonBadge from './PersonBadge';
import EntityCommentsSection from './EntityCommentsSection';
import TaskCompleteButton from './TaskCompleteButton';
import { FORMER_MEMBER } from '@/lib/former-member';

function formatDate(d: string | null): string {
  if (!d) return '\u2014';
  return new Date(d + 'T00:00:00Z').toLocaleDateString('en-PH', {
    year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC',
  });
}

function getStatusStyle(status: string) {
  const s = status.toLowerCase();
  if (s.includes('done') || s.includes('complete')) return 'bg-emerald-50 text-emerald-700 ring-emerald-200/60 dark:bg-emerald-500/10 dark:text-emerald-400 dark:ring-emerald-500/20';
  if (s.includes('progress')) return 'bg-blue-50 text-blue-700 ring-blue-200/60 dark:bg-blue-500/10 dark:text-blue-400 dark:ring-blue-500/20';
  if (s.includes('review')) return 'bg-violet-50 text-violet-700 ring-violet-200/60 dark:bg-violet-500/10 dark:text-violet-400 dark:ring-violet-500/20';
  if (s.includes('not started')) return 'bg-stone-50 text-stone-500 ring-stone-200/60 dark:bg-stone-500/10 dark:text-stone-400 dark:ring-stone-500/20';
  if (s.includes('blocked') || s.includes('on hold')) return 'bg-red-50 text-red-700 ring-red-200/60 dark:bg-red-500/10 dark:text-red-400 dark:ring-red-500/20';
  return 'bg-gray-50 text-gray-600 ring-gray-200/60 dark:bg-gray-500/10 dark:text-gray-400 dark:ring-gray-500/20';
}

function getPriorityStyle(priority: string) {
  const p = priority.toLowerCase();
  if (p.includes('urgent') || p.includes('high')) return 'text-red-600 dark:text-red-400';
  if (p.includes('medium')) return 'text-amber-600 dark:text-amber-400';
  return 'text-stone-500 dark:text-stone-400';
}

function getPriorityBadgeStyle(priority: string) {
  const p = priority.toLowerCase();
  if (p.includes('urgent') || p.includes('high')) return 'bg-red-50 text-red-700 ring-red-200/60 dark:bg-red-500/10 dark:text-red-400 dark:ring-red-500/20';
  if (p.includes('medium')) return 'bg-amber-50 text-amber-700 ring-amber-200/60 dark:bg-amber-500/10 dark:text-amber-400 dark:ring-amber-500/20';
  return 'bg-stone-50 text-stone-600 ring-stone-200/60 dark:bg-stone-500/10 dark:text-stone-400 dark:ring-stone-500/20';
}

function getDueStatus(dueDate: string | null, done: boolean): 'overdue' | 'today' | 'upcoming' | 'none' {
  if (!dueDate || done) return 'none';
  const now = new Date();
  const due = new Date(dueDate + 'T00:00:00Z');
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (due < today) return 'overdue';
  if (due.getTime() === today.getTime()) return 'today';
  return 'upcoming';
}

function getDaysUntil(date: string | null): string {
  if (!date) return '';
  const now = new Date();
  const d = new Date(date + 'T00:00:00Z');
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffMs = d.getTime() - today.getTime();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Tomorrow';
  if (diffDays === -1) return 'Yesterday';
  if (diffDays > 0) return `In ${diffDays} days`;
  return `${Math.abs(diffDays)} days ago`;
}

export default async function TaskDetail({ id }: { id: string }) {
  const session = await getSession();
  if (!session) notFound();
  const currentUserId = session?.user?.notionUserId ?? '';

  const item = await getTaskById(id, session.firmId);
  if (!item) notFound();

  const [people, teamMembers, comments, allPeopleMap] = await Promise.all([
    resolvePersonIds(session.firmId, item.assigneeIds),
    getActiveTeamMembers(session.firmId).catch(() => []),
    getEntityComments(session.firmId, 'task', item.id).catch(() => []),
    getAllTeamMembersAsMap(session.firmId).catch(() => new Map()),
  ]);
  const peopleForComments = Object.fromEntries(allPeopleMap);

  const dueStatus = getDueStatus(item.dueDate, item.done);
  const daysLabel = getDaysUntil(item.dueDate);

  return (
    <DetailShell
      title={item.name}
      icon={<CheckSquare className="w-5 h-5" />}
      entityType="Task"
      breadcrumbs={item.matterId ? [{ label: item.matter, href: `/dashboard/matters/${item.matterId}` }] : undefined}
    >
      {/* ── Status badges row ────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3 mb-6 animate-fade-up">
        {item.done ? (
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-full ring-1 ring-inset bg-emerald-50 text-emerald-700 ring-emerald-200/60 dark:bg-emerald-500/10 dark:text-emerald-400 dark:ring-emerald-500/20">
            <CheckCircle2 className="w-3 h-3" />
            Complete
          </span>
        ) : item.status ? (
          <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-full ring-1 ring-inset ${getStatusStyle(item.status)}`}>
            <span className="w-1.5 h-1.5 rounded-full bg-current opacity-60" />
            {item.status}
          </span>
        ) : null}
        {item.priority && (
          <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-full ring-1 ring-inset ${getPriorityBadgeStyle(item.priority)}`}>
            <AlertCircle className="w-3 h-3" />
            {item.priority}
          </span>
        )}
        {item.dueDate && (
          <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${
            dueStatus === 'overdue' ? 'text-red-600 dark:text-red-400' :
            dueStatus === 'today' ? 'text-amber-600 dark:text-amber-400' :
            'text-[var(--text-secondary)]'
          }`}>
            <Calendar className="w-3.5 h-3.5" />
            Due {formatDate(item.dueDate)}
            {dueStatus === 'overdue' && (
              <span className="text-[10px] font-bold uppercase tracking-wider bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400 px-1.5 py-0.5 rounded">Overdue</span>
            )}
            {dueStatus === 'today' && (
              <span className="text-[10px] font-bold uppercase tracking-wider bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400 px-1.5 py-0.5 rounded">Today</span>
            )}
          </span>
        )}
        <div className="w-full sm:w-auto sm:ml-auto">
          <TaskCompleteButton taskId={item.id} initialDone={item.done} />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 stagger-children">
        {/* ── Left column ──────────────────────────────────────────── */}
        <div className="lg:col-span-2 space-y-6">

          {/* Case & Assignment Card */}
          <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] shadow-[var(--shadow-card)] overflow-hidden animate-fade-up">
            <div className="px-6 py-4 border-b border-[var(--border-color)]">
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">Case & Assignment</h2>
            </div>
            <div className="p-6 space-y-5">
              {/* Matter */}
              <div className="flex items-start gap-3">
                <div className="mt-0.5 w-8 h-8 rounded-lg bg-navy-50 dark:bg-navy-500/10 flex items-center justify-center shrink-0">
                  <Briefcase className="w-4 h-4 text-navy-500 dark:text-navy-400" />
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-wider mb-0.5">Matter</p>
                  {item.matterId ? (
                    <Link href={`/dashboard/matters/${item.matterId}`} className="text-sm font-medium text-navy-600 dark:text-navy-400 hover:text-navy-800 dark:hover:text-navy-300 transition-colors">
                      {item.matter}
                    </Link>
                  ) : (
                    <p className="text-sm text-[var(--text-primary)]">{item.matter || '\u2014'}</p>
                  )}
                </div>
              </div>

              <div className="border-t border-[var(--border-color)]" />

              {/* Details grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <Clock className="w-3.5 h-3.5 text-[var(--text-muted)]" />
                    <p className="text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-wider">Status</p>
                  </div>
                  <p className="text-sm font-medium text-[var(--text-primary)]">{item.done ? 'Done' : (item.status || '\u2014')}</p>
                </div>
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <AlertCircle className="w-3.5 h-3.5 text-[var(--text-muted)]" />
                    <p className="text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-wider">Priority</p>
                  </div>
                  <p className={`text-sm font-medium ${item.priority ? getPriorityStyle(item.priority) : 'text-[var(--text-primary)]'}`}>
                    {item.priority || '\u2014'}
                  </p>
                </div>
              </div>

              <div className="border-t border-[var(--border-color)]" />

              {/* Assignees */}
              <div>
                <div className="flex items-center gap-2 mb-2.5">
                  <Users className="w-3.5 h-3.5 text-[var(--text-muted)]" />
                  <p className="text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-wider">Assignees</p>
                </div>
                {item.assigneeIds.length === 0 ? (
                  <p className="text-sm text-[var(--text-muted)]">{'\u2014'}</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {item.assigneeIds.map((pid) => {
                      const p = people.get(pid);
                      return <PersonBadge key={pid} initials={p?.initials ?? FORMER_MEMBER} position={p?.position} avatarUrl={p?.avatarUrl} />;
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>

          <EntityCommentsSection
            entityType="task"
            entityId={item.id}
            initialComments={comments}
            people={peopleForComments}
            teamMembers={teamMembers}
            currentUserId={currentUserId}
          />
        </div>

        {/* ── Right column ─────────────────────────────────────────── */}
        <div className="space-y-6">

          {/* Due Date Card */}
          <div className={`rounded-xl border overflow-hidden animate-fade-up ${
            dueStatus === 'today'
              ? 'border-amber-200 bg-amber-50/50 dark:border-amber-500/20 dark:bg-amber-500/5'
              : dueStatus === 'overdue'
                ? 'border-red-200 bg-red-50/30 dark:border-red-500/20 dark:bg-red-500/5'
                : item.done
                  ? 'border-emerald-200 bg-emerald-50/30 dark:border-emerald-500/20 dark:bg-emerald-500/5'
                  : 'border-[var(--border-color)] bg-[var(--card-bg)]'
          } shadow-[var(--shadow-card)]`}>
            <div className="p-6 text-center">
              {item.done ? (
                <>
                  <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-4 bg-emerald-100 dark:bg-emerald-500/20">
                    <CheckCircle2 className="w-7 h-7 text-emerald-600 dark:text-emerald-400" />
                  </div>
                  <p className="text-[11px] font-bold uppercase tracking-wider mb-2 text-emerald-600 dark:text-emerald-400">
                    Complete
                  </p>
                  <p className="text-sm text-[var(--text-secondary)]">This task is done</p>
                </>
              ) : item.dueDate ? (
                <>
                  <div className={`inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-4 ${
                    dueStatus === 'today'
                      ? 'bg-amber-100 dark:bg-amber-500/20'
                      : dueStatus === 'overdue'
                        ? 'bg-red-100 dark:bg-red-500/20'
                        : 'bg-blue-50 dark:bg-blue-500/10'
                  }`}>
                    <Calendar className={`w-7 h-7 ${
                      dueStatus === 'today'
                        ? 'text-amber-600 dark:text-amber-400'
                        : dueStatus === 'overdue'
                          ? 'text-red-500 dark:text-red-400'
                          : 'text-blue-500 dark:text-blue-400'
                    }`} />
                  </div>
                  <p className={`text-[11px] font-bold uppercase tracking-wider mb-2 ${
                    dueStatus === 'today'
                      ? 'text-amber-600 dark:text-amber-400'
                      : dueStatus === 'overdue'
                        ? 'text-red-600 dark:text-red-400'
                        : 'text-[var(--text-muted)]'
                  }`}>
                    {daysLabel}
                  </p>
                  <p className="text-lg font-semibold text-[var(--text-primary)] mb-1">
                    {new Date(item.dueDate + 'T00:00:00Z').toLocaleDateString('en-PH', {
                      month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC',
                    })}
                  </p>
                  <p className="text-xs text-[var(--text-secondary)]">
                    {new Date(item.dueDate + 'T00:00:00Z').toLocaleDateString('en-PH', {
                      weekday: 'long', timeZone: 'UTC',
                    })}
                  </p>
                  {dueStatus === 'overdue' && (
                    <div className="mt-3 inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-red-600 dark:text-red-400">
                      <AlertTriangle className="w-3 h-3" />
                      Overdue
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-4 bg-[var(--subtle-bg)]">
                    <Calendar className="w-7 h-7 text-[var(--text-muted)]" />
                  </div>
                  <p className="text-sm text-[var(--text-muted)]">No due date</p>
                </>
              )}
            </div>
          </div>

          {/* Quick Info Card */}
          <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] shadow-[var(--shadow-card)] overflow-hidden animate-fade-up">
            <div className="px-5 py-4 border-b border-[var(--border-color)]">
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">Details</h2>
            </div>
            <div className="divide-y divide-[var(--border-color)]">
              <div className="px-5 py-4 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-500/10 flex items-center justify-center">
                    <Clock className="w-4 h-4 text-blue-500 dark:text-blue-400" />
                  </div>
                  <span className="text-sm text-[var(--text-secondary)]">Status</span>
                </div>
                <span className={`text-xs font-semibold rounded-full px-2.5 py-1 ring-1 ring-inset ${getStatusStyle(item.done ? 'Done' : item.status)}`}>
                  {item.done ? 'Done' : (item.status || '\u2014')}
                </span>
              </div>
              <div className="px-5 py-4 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-amber-50 dark:bg-amber-500/10 flex items-center justify-center">
                    <AlertCircle className="w-4 h-4 text-amber-500 dark:text-amber-400" />
                  </div>
                  <span className="text-sm text-[var(--text-secondary)]">Priority</span>
                </div>
                <span className={`text-sm font-medium ${item.priority ? getPriorityStyle(item.priority) : 'text-[var(--text-muted)]'}`}>
                  {item.priority || '\u2014'}
                </span>
              </div>
              <div className="px-5 py-4 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-emerald-50 dark:bg-emerald-500/10 flex items-center justify-center">
                    <CheckSquare className="w-4 h-4 text-emerald-500 dark:text-emerald-400" />
                  </div>
                  <span className="text-sm text-[var(--text-secondary)]">Completion</span>
                </div>
                <span className={`text-sm font-medium ${item.done ? 'text-emerald-600 dark:text-emerald-400' : 'text-[var(--text-muted)]'}`}>
                  {item.done ? 'Done' : 'Pending'}
                </span>
              </div>
              <div className="px-5 py-4 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-violet-50 dark:bg-violet-500/10 flex items-center justify-center">
                    <Users className="w-4 h-4 text-violet-500 dark:text-violet-400" />
                  </div>
                  <span className="text-sm text-[var(--text-secondary)]">Assignees</span>
                </div>
                <span className="text-lg font-semibold text-[var(--text-primary)] tabular-nums">{item.assigneeIds.length}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

    </DetailShell>
  );
}
