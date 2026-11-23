'use client';

import { CalendarClock, CalendarDays, CircleAlert, Scale } from 'lucide-react';
import DataTable, { type ColumnDef, type TableCard } from '@/components/DataTable';
import { daysFromToday, joinDetail, manilaTime } from '@/lib/list-cards';
import { PILL_TONE } from '@/components/ui/tone';
import { statusTone } from '@/lib/status-tone';
import DateChip from '@/components/DateChip';
import HearingActionButtons from '@/components/HearingActionButtons';
import type { HearingListing } from '@/types/notion';
import { manilaToday, toManilaDay } from '@/lib/dates';

const columns: ColumnDef<HearingListing>[] = [
  {
    key: 'name',
    label: 'Name',
    getValue: (h) => h.name,
    render: (h) => h.name || '(Untitled)',
  },
  {
    key: 'matter',
    label: 'Matter',
    getValue: (h) => h.matter,
    render: (h) => <span className="text-sm text-stone-600 dark:text-stone-300">{h.matter || '—'}</span>,
  },
  {
    key: 'status',
    label: 'Status',
    getValue: (h) => h.status,
    render: (h) => {
      if (!h.status) return <span className="text-stone-400 dark:text-stone-500">—</span>;
      const cls = PILL_TONE[statusTone(h.status)];
      return (
        <span className={`text-[11px] rounded-full px-2 py-0.5 font-medium whitespace-nowrap border ${cls}`}>
          {h.status}
        </span>
      );
    },
  },
  {
    key: 'date',
    label: 'Date',
    getValue: (h) => h.date,
    render: (h) => <DateChip date={h.date ? toManilaDay(h.date) : null} />,
  },
  {
    key: 'actions',
    label: 'Actions',
    getValue: () => '',
    sortable: false,
    render: (h) => (
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
    ),
  },
];

const CLOSED = ['cancelled', 'canceled', 'postponed', 'reset', 'attended', 'done', 'completed'];

/** Past, not attended, and not cancelled or reset: the outcome still needs recording. */
const unrecorded = (h: HearingListing) => {
  const d = daysFromToday(h.date);
  return d !== null && d < 0 && d >= -90 && !h.isAttended && !CLOSED.includes((h.status ?? '').toLowerCase());
};

const cards: TableCard<HearingListing>[] = [
  { key: 'today', label: 'Today', sub: 'on the calendar today', icon: <Scale className="w-4 h-4" />, accent: 'amber', match: (h) => daysFromToday(h.date) === 0 },
  {
    key: 'week',
    label: 'Next 7 days',
    sub: 'after today',
    icon: <CalendarDays className="w-4 h-4" />,
    accent: 'navy',
    match: (h) => {
      const d = daysFromToday(h.date);
      return d !== null && d >= 1 && d <= 7;
    },
  },
  { key: 'unrecorded', label: 'No outcome recorded', sub: 'past 90 days', icon: <CircleAlert className="w-4 h-4" />, accent: 'rose', match: unrecorded },
  {
    key: 'upcoming',
    label: 'Upcoming',
    sub: 'from today on',
    icon: <CalendarClock className="w-4 h-4" />,
    accent: 'stone',
    match: (h) => (daysFromToday(h.date) ?? -1) >= 0,
  },
];

interface Props {
  initialCard?: string | null;
  /** Whether the list opens on Upcoming; off once a person picks a window of their own. */
  upcomingOnly: boolean;
  data: HearingListing[];
  userId: string;
  role: string;
}

export default function HearingsTable({ initialCard, upcomingOnly, data, userId, role }: Props) {
  return (
    <DataTable
      data={data}
      cards={cards}
      initialCard={initialCard}
      getRowDetail={(h) =>
        joinDetail(h.type, manilaTime(h.date), h.attendeeIds.length > 0 && `${h.attendeeIds.length} attending`) || null
      }
      columns={columns}
      getRowHref={(h) => `/dashboard/hearings/${h.id}`}
      getRowId={(h) => h.id}
      entityLabel="Hearing"
      defaultSortKey="date"
      defaultSortDir="desc"
      userId={userId}
      isMyItem={(h, uid) => h.attendeeIds.includes(uid)}
      role={role}
      isActiveItem={(h) => h.date != null && toManilaDay(h.date) >= manilaToday()}
      initialActiveOnly={upcomingOnly}
      activeLabel="Upcoming"
    />
  );
}
