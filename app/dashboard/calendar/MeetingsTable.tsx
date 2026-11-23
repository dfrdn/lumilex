'use client';

import { CalendarClock, CalendarDays, CircleAlert, Handshake } from 'lucide-react';
import DataTable, { type ColumnDef, type TableCard } from '@/components/DataTable';
import { daysFromToday, joinDetail, manilaTime } from '@/lib/list-cards';
import MeetingActionButtons from '@/components/MeetingActionButtons';
import type { MeetingListing } from '@/types/notion';
import { manilaToday, toManilaDay } from '@/lib/dates';

function formatDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-PH', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'Asia/Manila',
  });
}

function formatTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleTimeString('en-PH', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Manila',
  });
}

const typeColors: Record<string, string> = {
  'Internal': 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',
  'External': 'bg-gold-100 text-gold-700 dark:bg-gold-500/15 dark:text-gold-300',
  'Court': 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300',
};

const columns: ColumnDef<MeetingListing>[] = [
  {
    key: 'name',
    label: 'Name',
    getValue: (m) => m.name,
    render: (m) => m.name || '(Untitled)',
  },
  {
    key: 'matter',
    label: 'Matter',
    getValue: (m) => m.matter,
    render: (m) => <span className="text-sm text-stone-600 dark:text-stone-300">{m.matter || '—'}</span>,
  },
  {
    key: 'type',
    label: 'Type',
    getValue: (m) => m.type,
    render: (m) => {
      if (!m.type) return <span className="text-stone-400 dark:text-stone-500">—</span>;
      const cls = typeColors[m.type] ?? 'bg-gray-100 text-gray-600 dark:bg-stone-500/15 dark:text-stone-300';
      return (
        <span className={`text-[11px] rounded-full px-2 py-0.5 font-medium ring-1 ring-inset ring-current/10 ${cls}`}>
          {m.type}
        </span>
      );
    },
  },
  {
    key: 'date',
    label: 'Date',
    getValue: (m) => m.date,
    render: (m) => (
      <span className="text-sm text-stone-600 dark:text-stone-300 tabular-nums">{formatDate(m.date)}</span>
    ),
  },
  {
    key: 'time',
    label: 'Time',
    getValue: (m) => m.date,
    render: (m) => (
      <span className="text-sm text-stone-500 dark:text-stone-400 tabular-nums">{formatTime(m.date)}</span>
    ),
    defaultVisible: false,
  },
  {
    key: 'attended',
    label: 'Attended',
    getValue: (m) => m.isAttended,
    render: (m) => (
      <span className={`text-xs font-medium ${m.isAttended ? 'text-green-600 dark:text-emerald-400' : 'text-stone-400 dark:text-stone-500'}`}>
        {m.isAttended ? 'Yes' : '—'}
      </span>
    ),
    defaultVisible: false,
  },
  {
    key: 'actions',
    label: 'Actions',
    getValue: () => '',
    sortable: false,
    render: (m) => (
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
    ),
  },
];

const cards: TableCard<MeetingListing>[] = [
  { key: 'today', label: 'Today', sub: 'on the calendar today', icon: <Handshake className="w-4 h-4" />, accent: 'amber', match: (m) => daysFromToday(m.date) === 0 },
  {
    key: 'week',
    label: 'Next 7 days',
    sub: 'after today',
    icon: <CalendarDays className="w-4 h-4" />,
    accent: 'navy',
    match: (m) => {
      const d = daysFromToday(m.date);
      return d !== null && d >= 1 && d <= 7;
    },
  },
  {
    key: 'unmarked',
    label: 'Not marked attended',
    sub: 'past 90 days',
    icon: <CircleAlert className="w-4 h-4" />,
    accent: 'rose',
    match: (m) => {
      const d = daysFromToday(m.date);
      return d !== null && d < 0 && d >= -90 && !m.isAttended;
    },
  },
  { key: 'upcoming', label: 'Upcoming', sub: 'from today on', icon: <CalendarClock className="w-4 h-4" />, accent: 'stone', match: (m) => (daysFromToday(m.date) ?? -1) >= 0 },
];

interface Props {
  initialCard?: string | null;
  /** Whether the list opens on Upcoming; off once a person picks a window of their own. */
  upcomingOnly: boolean;
  data: MeetingListing[];
  userId: string;
  role: string;
}

export default function MeetingsTable({ initialCard, upcomingOnly, data, userId, role }: Props) {
  return (
    <DataTable
      data={data}
      cards={cards}
      initialCard={initialCard}
      getRowDetail={(m) => {
        const start = manilaTime(m.date);
        const end = manilaTime(m.endDate);
        return joinDetail(m.type, start && (end ? `${start} – ${end}` : start), m.attendeeIds.length > 0 && `${m.attendeeIds.length} attending`) || null;
      }}
      columns={columns}
      getRowHref={(m) => `/dashboard/meetings/${m.id}`}
      getRowId={(m) => m.id}
      entityLabel="Meeting"
      defaultSortKey="date"
      defaultSortDir="desc"
      userId={userId}
      isMyItem={(m, uid) => m.attendeeIds.includes(uid)}
      role={role}
      isActiveItem={(m) => m.date != null && toManilaDay(m.date) >= manilaToday()}
      initialActiveOnly={upcomingOnly}
      activeLabel="Upcoming"
    />
  );
}
