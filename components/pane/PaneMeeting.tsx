'use client';

import { Calendar, Users, Clock, Briefcase } from 'lucide-react';
import PersonBadge from '@/components/detail/PersonBadge';
import MeetingActions from '@/components/detail/MeetingActions';
import PaneCard from '@/components/pane/PaneCard';
import PaneLink from '@/components/pane/PaneLink';
import { toManilaInstant } from '@/lib/dates';
import { FORMER_MEMBER } from '@/lib/former-member';

interface Person { id: string; name: string; initials: string; position: string; avatarUrl?: string | null; }

interface MeetingPaneData {
  id: string;
  name: string;
  type: string;
  date: string | null;
  endDate: string | null;
  isAttended: boolean;
  attendeeIds: string[];
  matterId: string | null;
  matter: string;
  client?: string;
  clientId?: string | null;
}

interface Props {
  data: MeetingPaneData;
  people: Person[];
}

function formatDate(d: string | null): string {
  if (!d) return '\u2014';
  return new Date(toManilaInstant(d)).toLocaleDateString('en-PH', {
    year: 'numeric', month: 'short', day: 'numeric', timeZone: 'Asia/Manila',
  });
}

function formatTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Manila' });
}

export default function PaneMeeting({ data, people }: Props) {
  return (
    <div className="space-y-4">
      {/* Type + Attended */}
      <div className="flex items-center gap-2 flex-wrap">
        {data.type && (
          <span className="text-xs rounded-full px-2.5 py-1 font-medium ring-1 ring-inset bg-violet-50 text-violet-700 ring-violet-200/60 dark:bg-violet-500/10 dark:text-violet-400 dark:ring-violet-500/20">
            {data.type}
          </span>
        )}
        {data.isAttended && (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 rounded-full px-2.5 py-1 ring-1 ring-inset ring-emerald-200/60 dark:ring-emerald-500/20">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            Attended
          </span>
        )}
      </div>

      {/* Action Buttons */}
      <div className="mt-6">
        <MeetingActions
        meetingId={data.id}
        meetingName={data.name}
        meetingType={data.type}
        meetingDate={data.date}
        isAttended={data.isAttended}
        attendeeIds={data.attendeeIds}
        matterId={data.matterId}
        matterName={data.matter}
      />
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
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-0.5">Date & Time</p>
            <p className="text-sm text-foreground inline-flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-[var(--text-muted)]" />
              {formatDate(data.date)}
            </p>
            {data.date?.includes('T') && (
              <p className="text-[13px] text-[var(--text-secondary)] mt-0.5 inline-flex items-center gap-1.5 ml-5">
                <Clock className="w-3 h-3 text-[var(--text-muted)]" />
                {formatTime(data.date)}
                {data.endDate && ` \u2013 ${formatTime(data.endDate)}`}
              </p>
            )}
          </div>
        </div>
      </PaneCard>

      {/* Attendees */}
      {data.attendeeIds && data.attendeeIds.length > 0 && (
        <PaneCard title="Attendees" icon={<Users className="w-3.5 h-3.5" />} count={data.attendeeIds.length}>
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
