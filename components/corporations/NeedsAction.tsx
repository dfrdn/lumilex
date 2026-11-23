'use client';

import { useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { ArrowUpRight } from 'lucide-react';
import { TRACK_LABEL } from '@/lib/corporations/status';
import { DELIVERABLE_STATUS } from '@/lib/deliverable-status';
import type { UpcomingItem } from '@/lib/queries/registry';
import NeedsActionPanel from '@/components/ui/NeedsActionPanel';
import DatedActionButton from '@/components/ui/DatedActionButton';
import { DueChip } from '@/components/ui/primitives';
import { BTN_OUTLINE, STATE_CHIP } from '@/components/ui/tone';
import { TRACK_TAB } from '@/components/detail/corporation/tracks';

/**
 * The companies' Needs action panel: every item overdue or due within the
 * month. A compliance filing records as filed from here, on the day it went
 * in; anything else opens where its work lives. A recorded filing drops out
 * at once — the stored reading catches up on the next refresh.
 */
export default function CompanyNeedsAction({ items: initial, withinDays }: { items: UpcomingItem[]; withinDays: number }) {
  const [items, setItems] = useState(initial);
  const [synced, setSynced] = useState(initial);
  if (synced !== initial) {
    setSynced(initial);
    setItems(initial);
  }

  async function recordFiled(item: UpcomingItem, filedOn: string): Promise<boolean> {
    const res = await fetch(`/api/corporation/${item.subjectId}/compliance/${item.deliverableId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: DELIVERABLE_STATUS.FILED_OR_SENT_OUT, dateDone: filedOn }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(data.error || 'Could not record the filing');
      return false;
    }
    setItems((prev) => prev.filter((i) => i !== item));
    toast.success(`Filed — ${item.label}, ${item.company}`);
    return true;
  }

  return (
    <NeedsActionPanel
      entries={items}
      overdue={items.filter((i) => i.state === 'overdue').length}
      withinDays={withinDays}
      rowKey={(i) => `${i.subjectId}|${i.label}|${i.dueDate}`}
      renderRow={(i) => {
        const chip = STATE_CHIP[i.state];
        const canFile = i.track === 'compliance' && !!i.deliverableId;
        const href = i.deliverableId
          ? `/dashboard/deliverables/${i.deliverableId}`
          : `/dashboard/corporations/${i.subjectId}?tab=${TRACK_TAB[i.track]}`;
        return (
          <>
            <Link href={`/dashboard/corporations/${i.subjectId}`} className="min-w-0 sm:w-56 shrink-0 group">
              <span className="block text-[13px] font-medium text-stone-900 dark:text-stone-50 truncate group-hover:text-navy-700 dark:group-hover:text-navy-300 transition-colors">
                {i.company}
              </span>
              <span className="block text-[11px] text-stone-500 dark:text-stone-400 truncate">{TRACK_LABEL[i.track]}</span>
            </Link>
            <div className="flex-1 min-w-0 flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="text-sm text-stone-800 dark:text-stone-100">{i.label}</span>
              <DueChip due={i.dueDate} />
              {i.state !== 'overdue' && i.state !== 'not_started' && (
                <span className={`px-1.5 py-0.5 rounded-md ring-1 ring-inset text-[10px] font-medium ${chip.cls}`}>{chip.label}</span>
              )}
              {i.provisional && <span className="text-[11px] text-stone-400 dark:text-stone-500">provisional date</span>}
            </div>
            <div className="shrink-0 flex items-center gap-2">
              {canFile && (
                <DatedActionButton
                  label="Filed"
                  primary
                  size="sm"
                  fields={[{ key: 'filedOn', label: 'Filed on' }]}
                  onRun={(d) => recordFiled(i, d.filedOn!)}
                />
              )}
              <Link href={href} className={`${BTN_OUTLINE} px-2.5 py-1.5`}>
                Open <ArrowUpRight className="w-3 h-3" />
              </Link>
            </div>
          </>
        );
      }}
    />
  );
}
