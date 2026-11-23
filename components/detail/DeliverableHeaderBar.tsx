'use client';

import Link from 'next/link';
import { FileText, Info } from 'lucide-react';
import SubjectHeader, { type HeaderTeamMember } from '@/components/ui/SubjectHeader';
import { DueChip, Fact, MetaChip, StatusPill, SubjectCard } from '@/components/ui/primitives';
import type { PillTone } from '@/components/ui/tone';
import { deliverableTypeLabel } from '@/lib/document-type';
import { formatDateShort } from '@/lib/format-date';
import type { PersonInfo } from '@/lib/queries/people';
import { statusTone } from '@/lib/status-tone';
import EditableStatusPill from './EditableStatusPill';
import EditableSubtypePill from './EditableSubtypePill';
import { useDeliverable } from './DeliverableShellProvider';
import { isClosed } from '@/lib/deliverable-status';
import { toManilaDay } from '@/lib/dates';
import { FORMER_MEMBER } from '@/lib/former-member';

const AUDIENCE: Record<string, string> = {
  External: 'External',
  Internal: 'Internal',
  'For Client': 'For client',
};

export function priorityTone(priority: string): PillTone {
  const p = priority.toLowerCase();
  if (p.includes('urgent') || p.includes('high')) return 'rose';
  if (p.includes('medium')) return 'amber';
  return 'neutral';
}

/** Drafters first, then whoever has it now, each once. */
function headerTeam(
  ids: string[],
  people: Record<string, PersonInfo>,
  names: Record<string, string>,
): HeaderTeamMember[] {
  return [...new Set(ids)].map((pid) => {
    const p = people[pid];
    return {
      personId: pid,
      name: names[pid] ?? FORMER_MEMBER,
      initials: p?.initials ?? '–',
      avatarUrl: p?.avatarUrl ?? null,
    };
  });
}

export default function DeliverableHeaderBar({
  canEditStatus,
  canEditSubtype,
  people,
  names,
  client,
  below,
}: {
  canEditStatus: boolean;
  canEditSubtype: boolean;
  people: Record<string, PersonInfo>;
  names: Record<string, string>;
  client?: { id: string; name: string } | null;
  below?: React.ReactNode;
}) {
  const { item } = useDeliverable();
  // Once the work is closed the deadline is history: shown plainly, never as overdue.
  const done = isClosed(item.status);
  const audience = AUDIENCE[item.type];

  return (
    <SubjectHeader
      badge={
        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-navy-800 to-navy-950 text-gold-300 flex items-center justify-center shadow-sm ring-1 ring-gold-400/30 shrink-0">
          <FileText className="w-5 h-5" />
        </div>
      }
      title={item.name}
      statusPill={<EditableStatusPill canEdit={canEditStatus} />}
      meta={
        <>
          {item.type && <MetaChip>{deliverableTypeLabel(item.type)}</MetaChip>}
          {audience && <MetaChip>{audience}</MetaChip>}
          {canEditSubtype ? <EditableSubtypePill canEdit /> : item.subtype && <MetaChip>{item.subtype}</MetaChip>}
          {item.priority && <StatusPill label={item.priority} tone={priorityTone(item.priority)} hint="Priority" />}
          {item.externalDueDate &&
            (done ? (
              <MetaChip>Due {formatDateShort(item.externalDueDate)}</MetaChip>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-stone-100/80 dark:bg-white/[0.06]">
                <span className="text-[11px] text-stone-500 dark:text-stone-400">Due</span>
                <DueChip due={item.externalDueDate} />
              </span>
            ))}
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
      client={client}
      team={headerTeam([...item.drafter, ...item.currentlyWith], people, names)}
      below={below}
    />
  );
}

/** The right-hand summary: what it is, where it stands, and how much has happened on it. */
export function DeliverableAtAGlance({
  versions,
  files,
  actions,
  createdTime,
}: {
  versions: number;
  files: number;
  actions: number;
  createdTime: string | null;
}) {
  const { item } = useDeliverable();
  const done = isClosed(item.status);
  return (
    <SubjectCard title="At a glance" icon={<Info className="w-4 h-4" />}>
      <dl>
        <Fact label="Status" value={<StatusPill label={item.status || 'Unknown'} tone={statusTone(item.status)} size="sm" />} />
        <Fact label="Kind" value={item.type ? deliverableTypeLabel(item.type) : null} />
        <Fact label="Audience" value={AUDIENCE[item.type] ?? null} />
        <Fact label="Subtype" value={item.subtype || null} />
        <Fact
          label="Priority"
          value={item.priority ? <StatusPill label={item.priority} tone={priorityTone(item.priority)} size="sm" /> : null}
        />
        <Fact
          label="Due"
          value={item.externalDueDate ? done ? formatDateShort(item.externalDueDate) : <DueChip due={item.externalDueDate} /> : null}
        />
        <Fact label="Versions" value={versions || null} />
        <Fact label="Files" value={files || null} />
        <Fact label="Actions" value={actions || null} />
        <Fact label="Created" value={createdTime ? formatDateShort(toManilaDay(createdTime)) : null} />
      </dl>
    </SubjectCard>
  );
}
