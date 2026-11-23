'use client';

import { Calendar, Users, FileText, Briefcase } from 'lucide-react';
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
  return new Date(d.split('T')[0] + 'T00:00:00Z').toLocaleDateString('en-PH', {
    year: 'numeric', month: 'short', day: 'numeric', timeZone: 'Asia/Manila',
  });
}

function getStatusStyle(status: string) {
  const s = status.toLowerCase();
  if (s.includes('filed') || s.includes('done') || s.includes('complete')) return 'bg-emerald-50 text-emerald-700 ring-emerald-200/60 dark:bg-emerald-500/10 dark:text-emerald-400 dark:ring-emerald-500/20';
  if (s.includes('draft')) return 'bg-sky-50 text-sky-700 ring-sky-200/60 dark:bg-sky-500/10 dark:text-sky-400 dark:ring-sky-500/20';
  if (s.includes('review')) return 'bg-violet-50 text-violet-700 ring-violet-200/60 dark:bg-violet-500/10 dark:text-violet-400 dark:ring-violet-500/20';
  return 'bg-gray-50 text-gray-600 ring-gray-200/60 dark:bg-gray-500/10 dark:text-gray-400 dark:ring-gray-500/20';
}

export default function PaneFiling({ data, people }: Props) {
  return (
    <div className="space-y-4">
      {/* Status */}
      <div className="flex items-center gap-2 flex-wrap">
        {data.status && (
          <span className={`text-xs rounded-full px-2.5 py-1 font-medium ring-1 ring-inset ${getStatusStyle(data.status)}`}>
            {data.status}
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
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-0.5">Date</p>
            <p className="text-sm text-foreground inline-flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-[var(--text-muted)]" />
              {formatDate(data.date)}
            </p>
          </div>
          {data.relatedDeliverableId && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-0.5">Related Deliverable</p>
              <PaneLink
                href={`/dashboard/deliverables/${data.relatedDeliverableId}`}
                label="View Deliverable"
                icon={<FileText className="w-3.5 h-3.5 text-[var(--text-muted)]" />}
              />
            </div>
          )}
        </div>
      </PaneCard>

      {/* Attendees */}
      {data.attendeeIds && data.attendeeIds.length > 0 && (
        <PaneCard title="Assigned To" icon={<Users className="w-3.5 h-3.5" />} count={data.attendeeIds.length}>
          <div className="flex flex-wrap gap-1.5">
            {data.attendeeIds.map((id: string) => {
              const person = people.find(p => p.id === id);
              return <PersonBadge key={id} initials={person?.initials ?? FORMER_MEMBER} position={person?.position} avatarUrl={person?.avatarUrl} name={person?.name} />;
            })}
          </div>
        </PaneCard>
      )}
    </div>
  );
}
