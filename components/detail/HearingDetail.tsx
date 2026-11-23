import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getSession } from '@/lib/session';
import { Mail, Scale } from 'lucide-react';
import { getHearingById } from '@/lib/queries/detail';
import { resolvePersonIds, getActiveTeamMembers, getAllTeamMembersAsMap } from '@/lib/queries/people';
import { getEntityComments } from '@/lib/queries/entity-comments';
import SubjectCrumbs from './SubjectCrumbs';
import SubjectHeader, { type HeaderTeamMember } from '@/components/ui/SubjectHeader';
import DateBadge from '@/components/ui/DateBadge';
import { MetaChip, StatusPill } from '@/components/ui/primitives';
import HearingActions from './HearingActions';
import HearingDetailBody from './HearingDetailBody';
import EditableDetailTitle from './EditableDetailTitle';
import EntityCommentsSection from './EntityCommentsSection';
import { FORMER_MEMBER } from '@/lib/former-member';
import { hearingDay, hearingOutcome } from './hearing-day';
import { calendarHref } from '@/lib/calendar/views';

export default async function HearingDetail({ id }: { id: string }) {
  const session = await getSession();
  if (!session) notFound();

  const item = await getHearingById(id, session.firmId);
  if (!item) notFound();

  const canEdit = ['admin', 'super_user', 'partner'].includes(session?.user?.role ?? '');
  const currentUserId = session?.user?.notionUserId ?? '';
  const isAttendee = !!currentUserId && item.attendeeIds.includes(currentUserId);

  const [people, teamMembers, comments, allPeopleMap] = await Promise.all([
    resolvePersonIds(session.firmId, item.attendeeIds),
    getActiveTeamMembers(session.firmId).catch(() => []),
    getEntityComments(session.firmId, 'hearing', item.id).catch(() => []),
    getAllTeamMembersAsMap(session.firmId).catch(() => new Map()),
  ]);
  const peopleForComments = Object.fromEntries(allPeopleMap);

  const { dateStr, status: dateStatus, timeStr } = hearingDay(item.date);
  const outcome = hearingOutcome(item.status, item.isAttended, dateStatus);
  const nameOf = new Map(teamMembers.map((m) => [m.personId, m.name]));
  const team: HeaderTeamMember[] = item.attendeeIds.map((pid) => {
    const p = people.get(pid);
    return { personId: pid, name: nameOf.get(pid) ?? FORMER_MEMBER, initials: p?.initials ?? '–', avatarUrl: p?.avatarUrl ?? null };
  });

  return (
    <div className="space-y-4">
      <SubjectCrumbs
        list={{ label: 'Hearings', href: calendarHref('hearings'), icon: <Scale className="w-3.5 h-3.5" /> }}
        parent={item.matterId ? { label: item.matter, href: `/dashboard/matters/${item.matterId}` } : null}
        current={item.name}
      />

      <SubjectHeader
        badge={<DateBadge day={dateStr} tone={dateStatus === 'today' ? 'today' : outcome.tone === 'rose' ? 'late' : 'default'} />}
        title={
          <div className="min-w-0 flex-1">
            <EditableDetailTitle id={item.id} initialName={item.name} endpoint="/api/hearing" canEdit={canEdit} />
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
            {item.isFiled && <MetaChip>Filed</MetaChip>}
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
            <HearingActions
              hearingId={item.id}
              hearingName={item.name}
              hearingType={item.type}
              hearingDate={item.date}
              isAttended={item.isAttended}
              status={item.status}
              attendeeIds={item.attendeeIds}
              matterId={item.matterId}
              matterName={item.matter}
            />
          )
        }
        below={
          item.statusReport && (
            <Link
              href={`/dashboard/deliverables/${item.statusReport.id}`}
              className="inline-flex items-center gap-1.5 text-[12px] text-navy-700 dark:text-navy-300 hover:underline"
            >
              <Mail className="h-3.5 w-3.5" />
              Status report · {item.statusReport.name}
              <span className="text-stone-500 dark:text-stone-400">({item.statusReport.status})</span>
            </Link>
          )
        }
      />

      <HearingDetailBody
        item={{
          id: item.id,
          name: item.name,
          matter: item.matter,
          matterId: item.matterId,
          type: item.type,
          status: item.status,
          date: item.date,
          isAttended: item.isAttended,
          isFiled: item.isFiled,
          attendeeIds: item.attendeeIds,
        }}
        people={people}
        teamMembers={teamMembers}
        canEdit={canEdit}
        footer={
          <EntityCommentsSection
            entityType="hearing"
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
