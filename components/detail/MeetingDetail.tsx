import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getSession } from '@/lib/session';
import { Handshake } from 'lucide-react';
import { getMeetingById } from '@/lib/queries/detail';
import { resolvePersonIds, getActiveTeamMembers, getAllTeamMembersAsMap } from '@/lib/queries/people';
import { getEntityComments } from '@/lib/queries/entity-comments';
import SubjectCrumbs from './SubjectCrumbs';
import SubjectHeader, { type HeaderTeamMember } from '@/components/ui/SubjectHeader';
import DateBadge from '@/components/ui/DateBadge';
import { MetaChip, StatusPill } from '@/components/ui/primitives';
import type { PillTone } from '@/components/ui/tone';
import MeetingActions from './MeetingActions';
import MeetingDetailBody from './MeetingDetailBody';
import EditableDetailTitle from './EditableDetailTitle';
import EntityCommentsSection from './EntityCommentsSection';
import MeetingNotesCard from './MeetingNotesCard';
import { FORMER_MEMBER } from '@/lib/former-member';
import { calendarHref } from '@/lib/calendar/views';

function manilaDay(iso: string | null): string | null {
  return iso ? new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' }) : null;
}

function formatTime(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleTimeString('en-PH', {
    hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Manila',
  });
}

type Outcome = { label: string; tone: PillTone };

function outcomeOf(isAttended: boolean, dateStatus: ReturnType<typeof getDateStatus>): Outcome {
  if (isAttended) return { label: 'Attended', tone: 'emerald' };
  if (dateStatus === 'past') return { label: 'Not attended', tone: 'rose' };
  if (dateStatus === 'today') return { label: 'Today', tone: 'amber' };
  if (dateStatus === 'none') return { label: 'No date set', tone: 'muted' };
  return { label: 'Scheduled', tone: 'blue' };
}

function getDateStatus(date: string | null): 'past' | 'today' | 'upcoming' | 'none' {
  if (!date) return 'none';
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
  if (date < today) return 'past';
  if (date === today) return 'today';
  return 'upcoming';
}

export default async function MeetingDetail({ id }: { id: string }) {
  const session = await getSession();
  if (!session) notFound();

  const item = await getMeetingById(id, session.firmId);
  if (!item) notFound();

  const canEdit = ['admin', 'super_user', 'partner'].includes(session?.user?.role ?? '');
  const currentUserId = session?.user?.notionUserId ?? '';
  const isAttendee = !!currentUserId && item.attendeeIds.includes(currentUserId);

  const [people, teamMembers, comments, allPeopleMap] = await Promise.all([
    resolvePersonIds(session.firmId, item.attendeeIds),
    getActiveTeamMembers(session.firmId).catch(() => []),
    getEntityComments(session.firmId, 'meeting', item.id).catch(() => []),
    getAllTeamMembersAsMap(session.firmId).catch(() => new Map()),
  ]);
  const peopleForComments = Object.fromEntries(allPeopleMap);

  const dateStr = manilaDay(item.date);
  const dateStatus = getDateStatus(dateStr);
  const startTime = formatTime(item.date);
  const endTime = formatTime(item.endDate);
  const timeStr = startTime ? `${startTime}${endTime ? ` – ${endTime}` : ''}` : null;

  const outcome = outcomeOf(item.isAttended, dateStatus);
  const nameOf = new Map(teamMembers.map((m) => [m.personId, m.name]));
  const team: HeaderTeamMember[] = item.attendeeIds.map((pid) => {
    const p = people.get(pid);
    return { personId: pid, name: nameOf.get(pid) ?? FORMER_MEMBER, initials: p?.initials ?? '–', avatarUrl: p?.avatarUrl ?? null };
  });

  return (
    <div className="space-y-4">
      <SubjectCrumbs
        list={{ label: 'Meetings', href: calendarHref('meetings'), icon: <Handshake className="w-3.5 h-3.5" /> }}
        parent={item.matterId ? { label: item.matter, href: `/dashboard/matters/${item.matterId}` } : null}
        current={item.name}
      />

      <SubjectHeader
        badge={<DateBadge day={dateStr} tone={dateStatus === 'today' ? 'today' : outcome.tone === 'rose' ? 'late' : 'default'} />}
        title={
          <div className="min-w-0 flex-1">
            <EditableDetailTitle id={item.id} initialName={item.name} endpoint="/api/meeting" canEdit={canEdit} />
          </div>
        }
        statusPill={<StatusPill label={outcome.label} tone={outcome.tone} />}
        meta={
          <>
            {item.type && <MetaChip>{item.type}</MetaChip>}
            {dateStr && (
              <MetaChip>
                {new Date(`${dateStr}T00:00:00Z`).toLocaleDateString('en-PH', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}
                {timeStr && ` · ${timeStr}`}
              </MetaChip>
            )}
            {item.matterId && (
              <Link
                href={`/dashboard/matters/${item.matterId}`}
                className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] text-navy-700 hover:bg-navy-50 dark:text-navy-300 dark:hover:bg-navy-500/10 transition-colors"
              >
                Matter · {item.matter}
              </Link>
            )}
          </>
        }
        team={team}
        actions={
          isAttendee && (
            <MeetingActions
              meetingId={item.id}
              meetingName={item.name}
              meetingType={item.type}
              meetingDate={item.date}
              isAttended={item.isAttended}
              attendeeIds={item.attendeeIds}
              matterId={item.matterId}
              matterName={item.matter}
            />
          )
        }
      />

      <MeetingDetailBody
        item={{
          id: item.id,
          name: item.name,
          matter: item.matter,
          matterId: item.matterId,
          type: item.type,
          date: item.date,
          endDate: item.endDate,
          isAttended: item.isAttended,
          attendeeIds: item.attendeeIds,
        }}
        outcome={outcome}
        people={people}
        teamMembers={teamMembers}
        canEdit={canEdit}
        notes={
          <MeetingNotesCard
            meetingId={item.id}
            notes={item.notes ?? ''}
            version={item.notesVersion ?? 0}
            updatedAt={item.notesUpdatedAt ?? null}
            updatedBy={item.notesUpdatedBy ?? null}
            names={Object.fromEntries(teamMembers.map((m) => [m.personId, m.name]))}
            currentUserId={currentUserId}
            canEdit={!!currentUserId}
          />
        }
        footer={
          <EntityCommentsSection
            entityType="meeting"
            entityId={item.id}
            initialComments={comments}
            people={peopleForComments}
            teamMembers={teamMembers}
            currentUserId={currentUserId}
          />
        }
      />
    </div>
  );
}
