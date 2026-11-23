'use client';

import { AlertTriangle, Calendar, Users, Briefcase } from 'lucide-react';
import PersonBadge from '@/components/detail/PersonBadge';
import PaneCard from '@/components/pane/PaneCard';
import PaneLink from '@/components/pane/PaneLink';
import { FORMER_MEMBER } from '@/lib/former-member';

interface Person { id: string; name: string; initials: string; position: string; avatarUrl?: string | null; }

interface Props {
  data: any;
  people: Person[];
}

function formatDate(d: string | null): string {
  if (!d) return '\u2014';
  return new Date(d + 'T00:00:00Z').toLocaleDateString('en-PH', {
    year: 'numeric', month: 'short', day: 'numeric', timeZone: 'Asia/Manila',
  });
}

function isOverdue(date: string | null): boolean {
  if (!date) return false;
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
  return date < today;
}

function getStatusStyle(status: string) {
  const s = status.toLowerCase();
  if (s.includes('done') || s.includes('complete')) return 'bg-emerald-50 text-emerald-700 ring-emerald-200/60 dark:bg-emerald-500/10 dark:text-emerald-400 dark:ring-emerald-500/20';
  if (s.includes('progress')) return 'bg-blue-50 text-blue-700 ring-blue-200/60 dark:bg-blue-500/10 dark:text-blue-400 dark:ring-blue-500/20';
  if (s.includes('not started')) return 'bg-stone-50 text-stone-500 ring-stone-200/60 dark:bg-stone-500/10 dark:text-stone-400 dark:ring-stone-500/20';
  return 'bg-gray-50 text-gray-600 ring-gray-200/60 dark:bg-gray-500/10 dark:text-gray-400 dark:ring-gray-500/20';
}

export default function PaneTask({ data, people }: Props) {
  const overdue = !data.done && isOverdue(data.dueDate);

  return (
    <div className="space-y-4">
      {/* Status row */}
      <div className="flex items-center gap-2 flex-wrap">
        {data.done ? (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 rounded-full px-2.5 py-1 ring-1 ring-inset ring-emerald-200/60 dark:ring-emerald-500/20">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            Done
          </span>
        ) : data.status ? (
          <span className={`text-xs rounded-full px-2.5 py-1 font-medium ring-1 ring-inset ${getStatusStyle(data.status)}`}>
            {data.status}
          </span>
        ) : null}
        {data.priority && (
          <span className={`text-xs rounded-full px-2.5 py-1 font-medium ring-1 ring-inset ${
            data.priority.toLowerCase().includes('high') || data.priority.toLowerCase().includes('urgent')
              ? 'bg-red-50 text-red-600 ring-red-200/60 dark:bg-red-500/10 dark:text-red-400 dark:ring-red-500/20'
              : 'bg-gray-50 text-gray-600 ring-gray-200/60 dark:bg-gray-500/10 dark:text-gray-400 dark:ring-gray-500/20'
          }`}>
            {data.priority}
          </span>
        )}
      </div>

      {/* Details */}
      <PaneCard title="Details" icon={<Briefcase className="w-3.5 h-3.5" />}>
        <div className="space-y-3">
          {data.matter && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-0.5">Matter</p>
              <PaneLink
                href={data.matterId ? `/dashboard/matters/${data.matterId}` : null}
                label={data.matter}
              />
            </div>
          )}
          {data.client && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-0.5">Client</p>
              <PaneLink
                href={data.clientId ? `/dashboard/clients/${encodeURIComponent(data.clientId)}` : null}
                label={data.client}
              />
            </div>
          )}
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-0.5">Due Date</p>
            <p className={`text-sm font-medium inline-flex items-center gap-1.5 ${
              overdue ? 'text-red-600 dark:text-red-400' : 'text-foreground'
            }`}>
              {overdue && <AlertTriangle className="w-3.5 h-3.5" />}
              <Calendar className="w-3.5 h-3.5 text-[var(--text-muted)]" />
              {formatDate(data.dueDate)}
            </p>
          </div>
        </div>
      </PaneCard>

      {/* Assignees */}
      {data.assigneeIds && data.assigneeIds.length > 0 && (
        <PaneCard title="Assignees" icon={<Users className="w-3.5 h-3.5" />} count={data.assigneeIds.length}>
          <div className="flex flex-wrap gap-1.5">
            {data.assigneeIds.map((id: string) => {
              const person = people.find(p => p.id === id);
              return <PersonBadge key={id} initials={person?.initials ?? FORMER_MEMBER} position={person?.position} avatarUrl={person?.avatarUrl} name={person?.name} />;
            })}
          </div>
        </PaneCard>
      )}
    </div>
  );
}
