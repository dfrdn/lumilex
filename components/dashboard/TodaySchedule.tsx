import { CalendarCheck2, CalendarClock, ChevronRight } from 'lucide-react';
import SectionCard from '@/components/ui/SectionCard';
import ItemRow from '@/components/ItemRow';
import LoadError from '@/components/ui/LoadError';
import MeetingActionButtons from '@/components/MeetingActionButtons';
import HearingActionButtons from '@/components/HearingActionButtons';
import FilingActionButtons from '@/components/FilingActionButtons';
import { formatManilaTime } from '@/lib/dates';
import type { NotionFiling, NotionHearing, NotionMeeting } from '@/types/notion';

interface Props {
  /** Each null when its read failed. */
  meetings: NotionMeeting[] | null;
  hearings: NotionHearing[] | null;
  filings: NotionFiling[] | null;
  /** The render's clock, for telling what is over. */
  now: number;
}

/** A meeting or hearing still counts as ahead for half an hour after it starts. */
const GRACE_MS = 30 * 60 * 1000;

/**
 * Today's meetings, hearings and filings in one list, by time: what is still
 * ahead, with what's over folded into one line. A day with none is a single
 * line rather than three empty cards.
 */
export default function TodaySchedule({ meetings, hearings, filings, now }: Props) {
  const failed = !meetings || !hearings || !filings;
  const count = failed ? undefined : meetings.length + hearings.length + filings.length;

  // Timed events by start; filings have only a day, so they follow.
  const timed = [
    ...(meetings ?? []).map((m) => ({ kind: 'meeting' as const, at: m.date ?? '', item: m })),
    ...(hearings ?? []).map((h) => ({ kind: 'hearing' as const, at: h.date ?? '', item: h })),
  ].sort((a, b) => a.at.localeCompare(b.at));
  // Folded once it's over and dealt with. One that's over but not yet marked
  // attended (or cancelled) stays in view: it still asks for something.
  const done = (e: (typeof timed)[number]) =>
    !!e.at &&
    new Date(e.at).getTime() < now - GRACE_MS &&
    (e.item.isAttended || (e.kind === 'hearing' && (e.item as NotionHearing).status === 'Cancelled'));
  const earlier = timed.filter(done);
  const ahead = timed.filter((e) => !done(e));

  const row = (e: (typeof timed)[number]) => {
    const time = formatManilaTime(e.at);
    if (e.kind === 'meeting') {
      const m = e.item as NotionMeeting;
      return (
        <ItemRow
          key={`m-${m.id}`}
          href={`/dashboard/meetings/${m.id}`}
          openPane={{ entity: 'meetings', id: m.id }}
          title={m.name}
          subtitle={time ? `Meeting · ${time}` : 'Meeting'}
          right={
            <MeetingActionButtons
              meetingId={m.id}
              meetingName={m.name}
              meetingType={m.type}
              meetingDate={m.date}
              isAttended={m.isAttended}
              attendeeIds={m.attendeeIds}
              matterId={m.matterId}
              matterName={m.matter}
            />
          }
        />
      );
    }
    const h = e.item as NotionHearing;
    return (
      <ItemRow
        key={`h-${h.id}`}
        href={`/dashboard/hearings/${h.id}`}
        openPane={{ entity: 'hearings', id: h.id }}
        title={h.name}
        subtitle={time ? `Hearing · ${time}` : 'Hearing'}
        right={
          <HearingActionButtons
            hearingId={h.id}
            hearingName={h.name}
            hearingType={h.type}
            hearingDate={h.date}
            isAttended={h.isAttended}
            status={h.status}
            attendeeIds={h.attendeeIds}
            matterId={h.matterId}
            matterName={h.matter}
          />
        }
      />
    );
    };

  return (
    <SectionCard id="today" title="Today's schedule" icon={<CalendarClock className="w-5 h-5" />} count={count}>
      {failed && <LoadError />}
      {count === 0 && (
        <p className="flex items-center gap-2 py-2 px-1 text-sm text-[var(--text-secondary)]">
          <CalendarCheck2 className="w-4 h-4 text-[var(--text-muted)]" aria-hidden="true" />
          No meetings, hearings or filings today
        </p>
      )}
      {ahead.map(row)}
      {count !== 0 && !failed && ahead.length === 0 && (filings ?? []).length === 0 && (
        <p className="flex items-center gap-2 py-2 px-1 text-sm text-[var(--text-secondary)]">
          <CalendarCheck2 className="w-4 h-4 text-[var(--text-muted)]" aria-hidden="true" />
          Nothing else today
        </p>
      )}
      {(filings ?? []).map((f) => (
        <ItemRow
          key={`f-${f.id}`}
          href={`/dashboard/deliverables/${f.id}`}
          openPane={{ entity: 'filings', id: f.id }}
          title={f.name}
          subtitle={f.matter ? `Filing · ${f.matter}` : 'Filing'}
          right={<FilingActionButtons filingId={f.id} filingName={f.name} status={f.status} />}
        />
      ))}
      {earlier.length > 0 && (
        <details className="group mt-1">
          <summary className="flex cursor-pointer list-none items-center gap-1 px-1 py-1 max-sm:min-h-9 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] [&::-webkit-details-marker]:hidden">
            <ChevronRight className="w-3.5 h-3.5 transition-transform group-open:rotate-90" aria-hidden="true" />
            {earlier.length} earlier today
          </summary>
          <div className="opacity-75">{earlier.map(row)}</div>
        </details>
      )}
    </SectionCard>
  );
}
