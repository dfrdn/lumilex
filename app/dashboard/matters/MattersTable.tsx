'use client';

import { Archive, Briefcase, MoonStar, UserX } from 'lucide-react';
import DataTable, { type ColumnDef, type FilterDef, type TableCard } from '@/components/DataTable';
import { daysFromToday, joinDetail } from '@/lib/list-cards';
import { IDLE_ARCHIVE_DAYS, IDLE_WARN_DAYS } from '@/lib/matters/archive';
import { PILL_TONE } from '@/components/ui/tone';
import { statusTone } from '@/lib/status-tone';
import Avatar from '@/components/Avatar';
import type { MatterListing } from '@/types/notion';
import { MATTER_TYPE_CODES, MATTER_TYPE_NAMES } from '@/lib/admin/entity-config';
import { MATTER_STATUS, MATTER_STATUSES } from '@/lib/matter-status';

const avatarColors = [
  'bg-navy-100 text-navy-700 dark:bg-navy-500/20 dark:text-navy-200',
  'bg-gold-100 text-gold-700 dark:bg-gold-500/15 dark:text-gold-300',
  'bg-stone-200 text-stone-700 dark:bg-stone-700 dark:text-stone-200',
  'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',
  'bg-purple-100 text-purple-700 dark:bg-purple-500/15 dark:text-purple-300',
  'bg-teal-100 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300',
];


/**
 * Parse a matter code into its three numeric segments.
 * E.g. "2025-01-003" → [2025, 1, 3] or "25.3.17" → [25, 3, 17]
 * Returns [0, 0, 0] if the code doesn't contain three numbers.
 */
function parseMatterCode(code: string): [number, number, number] {
  const nums = code.match(/\d+/g);
  if (!nums || nums.length < 3) return [0, 0, 0];
  return [Number(nums[0]), Number(nums[1]), Number(nums[2])];
}

/** Sort key: first number → third number → middle number (packed into a single numeric value). */
function matterCodeSortKey(code: string): number {
  const [first, mid, third] = parseMatterCode(code);
  // Pack into a single number: first * 10^8 + third * 10^4 + mid
  return first * 1e8 + third * 1e4 + mid;
}

/** Format a type value with its code for display */
function formatTypeWithCode(typeName: string): string {
  const code = MATTER_TYPE_CODES[typeName];
  return code != null ? `${code} — ${typeName}` : typeName;
}

const columns: ColumnDef<MatterListing>[] = [
  {
    key: 'name',
    label: 'Name',
    getValue: (m) => m.name,
    render: (m) => m.name || '(Untitled)',
  },
  {
    key: 'code',
    label: 'Code',
    headerTooltip: '1st — Client Code\n2nd — Matter Type\n  10 Retainer\n  20 Litigation\n  30 Labor\n  40 Special Project\n  50 Tax\n  60 Immigration\n  70 Incorporation\n  71 Post-Incorporation\n  72 Corporate Housekeeping\n  90 Intellectual Property\n3rd — Matter # for that client',
    getValue: (m) => m.matterCode,
    getSortValue: (m) => m.matterCode ? matterCodeSortKey(m.matterCode) : null,
    render: (m) => (
      <span className="text-xs text-stone-500 dark:text-stone-400 font-mono whitespace-nowrap">{m.matterCode || '—'}</span>
    ),
  },
  {
    key: 'client',
    label: 'Client',
    getValue: (m) => m.clientName,
    render: (m) => (
      <span className="text-sm text-stone-600 dark:text-stone-300">{m.clientName || '—'}</span>
    ),
  },
  {
    key: 'type',
    label: 'Type',
    getValue: (m) => m.type,
    render: (m) =>
      m.type ? (
        <span className="text-xs text-stone-600 dark:text-stone-300">{m.type}</span>
      ) : (
        <span className="text-xs text-stone-400 dark:text-stone-500">—</span>
      ),
    defaultVisible: true,
  },
  {
    key: 'status',
    label: 'Status',
    getValue: (m) => m.status,
    render: (m) => {
      if (!m.status) return <span className="text-xs text-stone-400 dark:text-stone-500">—</span>;
      const style = PILL_TONE[statusTone(m.status)];
      return (
        <span className={`inline-flex items-center px-2 py-0.5 text-[11px] font-medium rounded-full whitespace-nowrap border ${style}`}>
          {m.status}
        </span>
      );
    },
    defaultVisible: true,
  },
  {
    key: 'team',
    label: 'Team',
    getValue: (m) => m.teamInitials.join(', '),
    render: (m) => {
      if (m.teamMembers.length === 0) return <span className="text-xs text-stone-400 dark:text-stone-500">—</span>;
      return (
        <div className="flex items-center -space-x-1">
          {m.teamMembers.slice(0, 4).map((member, i) => (
            <Avatar
              key={member.personId}
              avatarUrl={member.avatarUrl}
              initials={member.initials}
              name={member.name}
              title={member.name || member.initials}
              size={24}
              className="ring-2 ring-white dark:ring-stone-900"
              fallbackClassName={`text-[10px] font-bold ${avatarColors[i % avatarColors.length]}`}
            />
          ))}
          {m.teamMembers.length > 4 && (
            <span className="w-6 h-6 rounded-full text-[10px] font-medium flex items-center justify-center ring-2 ring-white bg-stone-100 text-stone-500 dark:ring-stone-900 dark:bg-stone-700 dark:text-stone-300">
              +{m.teamMembers.length - 4}
            </span>
          )}
        </div>
      );
    },
    sortable: false,
    defaultVisible: true,
  },
];

const matterFilters: FilterDef<MatterListing>[] = [
  {
    key: 'status',
    label: 'Status',
    getValue: (m) => m.status,
    optionOrder: [...MATTER_STATUSES],
  },
  {
    key: 'type',
    label: 'Type',
    getValue: (m) => m.type,
    optionOrder: MATTER_TYPE_NAMES,
    formatOption: formatTypeWithCode,
  },
];

interface Props {
  data: MatterListing[];
  userId: string;
  role: string;
}

const ACTIVE_MATTER_STATUSES = ['Ongoing'];

const ongoing = (m: MatterListing) => m.status === 'Ongoing';

const cards: TableCard<MatterListing>[] = [
  { key: 'ongoing', label: 'Ongoing', sub: 'open engagements', icon: <Briefcase className="w-4 h-4" />, accent: 'navy', match: ongoing },
  {
    key: 'quiet',
    label: 'Going quiet',
    sub: `idle ${IDLE_WARN_DAYS}+ days, archives at ${IDLE_ARCHIVE_DAYS}`,
    icon: <MoonStar className="w-4 h-4" />,
    accent: 'amber',
    match: (m) => ongoing(m) && (daysFromToday(m.lastActivityAt) ?? 0) <= -IDLE_WARN_DAYS,
  },
  { key: 'unstaffed', label: 'No team', sub: 'ongoing, no one assigned', icon: <UserX className="w-4 h-4" />, accent: 'rose', match: (m) => ongoing(m) && m.teamPersonIds.length === 0 },
  { key: 'archived', label: 'Archived', sub: 'closed out or idle', icon: <Archive className="w-4 h-4" />, accent: 'stone', match: (m) => m.status === MATTER_STATUS.ARCHIVED },
];

export default function MattersTable({ data, userId, role }: Props) {
  return (
    <DataTable
      data={data}
      cards={cards}
      getRowDetail={(m) => joinDetail(m.teamMembers.map((t) => t.name || t.initials).join(', ')) || null}
      columns={columns}
      getRowHref={(m) => `/dashboard/matters/${m.id}`}
      getRowId={(m) => m.id}
      entityLabel="Matter"
      defaultSortKey="name"
      userId={userId}
      isMyItem={(m, uid) => m.teamPersonIds.includes(uid)}
      role={role}
      isActiveItem={(m) => ACTIVE_MATTER_STATUSES.includes(m.status)}
      filters={matterFilters}
    />
  );
}
