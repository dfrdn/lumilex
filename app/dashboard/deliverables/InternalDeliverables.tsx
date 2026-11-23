'use client';

import { useMemo, useState, useEffect } from 'react';
import Link from 'next/link';
import { Send, Inbox as InboxIcon } from 'lucide-react';
import DateChip from '@/components/DateChip';
import Avatar from '@/components/Avatar';
import DeliverableActionButtons, { type DeliverableActionPatch } from '@/components/DeliverableActionButtons';
import { useDeliverableRowSync } from '@/components/DeliverableUpdatesContext';
import EmptyState from '@/components/ui/EmptyState';
import type { DeliverableListing } from '@/types/notion';
import { DELIVERABLE_STATUS } from '@/lib/deliverable-status';

const statusColors: Record<string, string> = {
  [DELIVERABLE_STATUS.NOT_STARTED]: 'bg-gray-100 text-gray-600 dark:bg-stone-500/15 dark:text-stone-300',
  [DELIVERABLE_STATUS.DRAFTING]: 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',
  [DELIVERABLE_STATUS.SUBMITTED]: 'bg-teal-100 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300',
  [DELIVERABLE_STATUS.ACKNOWLEDGED]: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
};

function StatusPill({ status }: { status: string }) {
  const cls = statusColors[status] ?? 'bg-gray-100 text-gray-600 dark:bg-stone-500/15 dark:text-stone-300';
  return (
    <span className={`text-[11px] rounded-full px-2 py-0.5 font-medium ring-1 ring-inset ring-current/10 ${cls}`}>
      {status || '—'}
    </span>
  );
}

function PeopleInline({ ids, initialsById, avatarsById }: { ids: string[]; initialsById: Record<string, string>; avatarsById?: Record<string, string | null> }) {
  if (ids.length === 0) return <span className="text-stone-400 dark:text-stone-500 text-xs">—</span>;
  const shown = ids.slice(0, 3);
  const extra = ids.length - shown.length;
  return (
    <div className="flex items-center -space-x-1">
      {shown.map((id, i) => (
        <Avatar
          key={id + i}
          avatarUrl={avatarsById?.[id] ?? null}
          initials={initialsById[id] ?? '–'}
          title={initialsById[id] ?? id}
          size={24}
          className="ring-2 ring-white dark:ring-stone-900"
          fallbackClassName="text-[10px] font-bold bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300"
        />
      ))}
      {extra > 0 && (
        <span className="w-6 h-6 rounded-full text-[10px] font-medium flex items-center justify-center ring-2 ring-white dark:ring-stone-900 bg-stone-100 text-stone-500 dark:bg-stone-700 dark:text-stone-300">
          +{extra}
        </span>
      )}
    </div>
  );
}

interface RowProps {
  item: DeliverableListing;
  peopleLabel: string;
  peopleIds: string[];
  initialsById: Record<string, string>;
  avatarsById?: Record<string, string | null>;
  userId: string;
  onActionComplete: (id: string, patch: DeliverableActionPatch) => void;
}

function Row({ item, peopleLabel, peopleIds, initialsById, avatarsById, userId, onActionComplete }: RowProps) {
  const canAct = item.currentlyWith.includes(userId);
  return (
    <div className="flex items-center gap-4 px-4 py-3 border-b border-[var(--border-color)] last:border-b-0 hover:bg-[var(--subtle-bg)] transition-colors">
      <div className="flex-1 min-w-0">
        <Link
          href={`/dashboard/deliverables/${item.id}`}
          className="block text-sm font-medium text-[var(--text-primary)] hover:text-gold-600 dark:hover:text-gold-400 truncate"
        >
          {item.name || '(Untitled)'}
        </Link>
        {item.matter && (
          <p className="text-xs text-[var(--text-muted)] truncate mt-0.5">{item.matter}</p>
        )}
      </div>
      <div className="hidden sm:flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] font-semibold">{peopleLabel}</span>
        <PeopleInline ids={peopleIds} initialsById={initialsById} avatarsById={avatarsById} />
      </div>
      <div className="hidden md:block">
        <DateChip date={item.externalDueDate} />
      </div>
      <StatusPill status={item.status} />
      {canAct && (
        <DeliverableActionButtons
          deliverableId={item.id}
          deliverableName={item.name}
          status={item.status}
          type={item.type}
          matterId={item.matterId}
          matterName={item.matter}
          drafterIds={item.drafter}
          reviewerIds={item.reviewerIds}
          currentlyWithIds={item.currentlyWith}
          variant="compact"
          onActionComplete={(patch) => onActionComplete(item.id, patch)}
        />
      )}
    </div>
  );
}

interface Props {
  data: DeliverableListing[];
  userId: string;
  initialsById: Record<string, string>;
  avatarsById?: Record<string, string | null>;
}

export default function InternalDeliverables({ data, userId, initialsById, avatarsById }: Props) {
  const [rows, setRows] = useState(data);
  useEffect(() => { setRows(data); }, [data]);

  const publishDeliverableUpdate = useDeliverableRowSync(setRows);

  const { sentToMe, fromMe } = useMemo(() => {
    const sentToMe: DeliverableListing[] = [];
    const fromMe: DeliverableListing[] = [];
    for (const item of rows) {
      const isRecipient = item.reviewerIds.includes(userId);
      const isDrafter = item.drafter.includes(userId);
      if (isRecipient) sentToMe.push(item);
      if (isDrafter && !isRecipient) fromMe.push(item);
    }
    return { sentToMe, fromMe };
  }, [rows, userId]);

  return (
    <div className="space-y-8">
      <section>
        <div className="flex items-center gap-2 mb-3">
          <InboxIcon className="w-4 h-4 text-[var(--text-muted)]" />
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">Sent to me</h2>
          <span className="text-xs text-[var(--text-muted)]">({sentToMe.length})</span>
        </div>
        <div className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-xl overflow-hidden">
          {sentToMe.length === 0 ? (
            <EmptyState message="Nothing has been sent to you" />
          ) : (
            sentToMe.map((item) => (
              <Row
                key={item.id}
                item={item}
                peopleLabel="From"
                peopleIds={item.drafter}
                initialsById={initialsById}
                avatarsById={avatarsById}
                userId={userId}
                onActionComplete={publishDeliverableUpdate}
              />
            ))
          )}
        </div>
      </section>

      <section>
        <div className="flex items-center gap-2 mb-3">
          <Send className="w-4 h-4 text-[var(--text-muted)]" />
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">From me</h2>
          <span className="text-xs text-[var(--text-muted)]">({fromMe.length})</span>
        </div>
        <div className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-xl overflow-hidden">
          {fromMe.length === 0 ? (
            <EmptyState message="You haven't sent any internal deliverables" />
          ) : (
            fromMe.map((item) => (
              <Row
                key={item.id}
                item={item}
                peopleLabel="To"
                peopleIds={item.reviewerIds}
                initialsById={initialsById}
                avatarsById={avatarsById}
                userId={userId}
                onActionComplete={publishDeliverableUpdate}
              />
            ))
          )}
        </div>
      </section>
    </div>
  );
}
