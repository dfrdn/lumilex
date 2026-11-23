'use client';

import { Calendar, Clock, Users, Gavel, Briefcase } from 'lucide-react';
import PersonBadge from '@/components/detail/PersonBadge';
import HearingActions from '@/components/detail/HearingActions';
import PaneCard from '@/components/pane/PaneCard';
import PaneLink from '@/components/pane/PaneLink';
import { daysBetween, isDateOnly, manilaToday, toManilaDay } from '@/lib/dates';
import { FORMER_MEMBER } from '@/lib/former-member';

interface Person { id: string; name: string; initials: string; position: string; avatarUrl?: string | null; }

interface HearingPaneData {
  id: string;
  name: string;
  type: string;
  status: string;
  date: string | null;
  isAttended: boolean;
  isFiled: boolean;
  attendeeIds: string[];
  matterId: string | null;
  matter: string;
  client?: string;
  clientId?: string | null;
}

interface Props {
  data: HearingPaneData;
  people: Person[];
}

function formatDate(d: string | null): string {
  if (!d) return '\u2014';
  return new Date(d).toLocaleDateString('en-PH', {
    year: 'numeric', month: 'short', day: 'numeric', timeZone: 'Asia/Manila',
  });
}

function formatTime(isoDate: string | null): string | null {
  if (!isoDate) return null;
  if (isDateOnly(isoDate)) return null;
  return new Date(isoDate).toLocaleTimeString('en-PH', {
    hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Manila',
  });
}

function getDaysUntil(d: string | null): string {
  if (!d) return '';
  const diff = daysBetween(manilaToday(), toManilaDay(d));
  if (diff < 0) return `${Math.abs(diff)}d ago`;
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  return `In ${diff}d`;
}

export default function PaneHearing({ data, people }: Props) {
  const daysLabel = getDaysUntil(data.date);
  const isPast = data.date && new Date(new Date(data.date).toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' })) < new Date(new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' }));

  return (
    <div className="space-y-4">
      {/* Type + Status */}
      <div className="flex items-center gap-2 flex-wrap">
        {data.type && (
          <span className="text-xs rounded-full px-2.5 py-1 font-medium ring-1 ring-inset bg-red-50 text-red-700 ring-red-200/60 dark:bg-red-500/10 dark:text-red-400 dark:ring-red-500/20">
            {data.type}
          </span>
        )}
        {data.status && (
          <span className={`text-xs rounded-full px-2.5 py-1 font-medium ring-1 ring-inset ${
            data.status.toLowerCase().includes('done') || data.status.toLowerCase().includes('attended')
              ? 'bg-emerald-50 text-emerald-700 ring-emerald-200/60 dark:bg-emerald-500/10 dark:text-emerald-400 dark:ring-emerald-500/20'
              : 'bg-gray-50 text-gray-600 ring-gray-200/60 dark:bg-gray-500/10 dark:text-gray-400 dark:ring-gray-500/20'
          }`}>
            {data.status}
          </span>
        )}
        {data.isAttended && (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            Attended
          </span>
        )}
        {data.isFiled && (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 dark:text-blue-400">
            <Gavel className="w-3 h-3" />
            Filed
          </span>
        )}
      </div>

      {/* Action Buttons */}
      <div className="mt-6">
        <HearingActions
        hearingId={data.id}
        hearingName={data.name}
        hearingType={data.type}
        hearingDate={data.date}
        isAttended={data.isAttended}
        status={data.status}
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
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-0.5">Date</p>
            <div className="flex items-center gap-2">
              <p className="text-sm text-foreground inline-flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-[var(--text-muted)]" />
                {formatDate(data.date)}
              </p>
              {daysLabel && (
                <span className={`text-[11px] font-medium px-2 py-0.5 rounded-md ${
                  isPast
                    ? 'bg-gray-100 text-gray-500 dark:bg-gray-500/10 dark:text-gray-400'
                    : 'bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400'
                }`}>
                  {daysLabel}
                </span>
              )}
            </div>
          </div>
          {formatTime(data.date) && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-0.5">Time</p>
              <p className="text-sm text-foreground inline-flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-[var(--text-muted)]" />
                {formatTime(data.date)}
              </p>
            </div>
          )}
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
