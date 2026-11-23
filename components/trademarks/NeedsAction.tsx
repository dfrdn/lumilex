'use client';

import Link from 'next/link';
import type { Trademark, TrademarkListing } from '@/types/notion';
import type { DeadlineEntry } from '@/lib/trademark-deadlines';
import { addDays, manilaToday } from '@/lib/dates';
import { TONE_TEXT } from '@/components/ui/tone';
import { formatDateShort } from '@/lib/format-date';
import { DueChip, urgencyFor } from '@/components/ui/primitives';
import { TrademarkActionButton, recordedToast } from './actions';
import { actionForDeadline, deadlineLabel } from '@/lib/trademarks/actions';
import NeedsActionPanel from '@/components/ui/NeedsActionPanel';

/** Owed within this many days (or already overdue) counts as needing action. */
export const NEEDS_ACTION_DAYS = 30;

export interface NeedsActionEntry {
  trademark: Pick<TrademarkListing, 'id' | 'mark' | 'clientName'>;
  deadline: DeadlineEntry;
}

/**
 * Every deadline that needs recording now, across all marks, each with the
 * one button that satisfies it — so the urgent work can be done from the
 * list without opening each mark.
 */
export default function NeedsAction({
  entries, onUpdated,
}: {
  entries: NeedsActionEntry[];
  onUpdated: (t: Trademark) => void;
}) {
  const today = manilaToday();
  const overdue = entries.filter((e) => urgencyFor(e.deadline.due, today).days < 0).length;
  // A pending extension stays listed however far off its deadline; it is counted apart from what falls due soon.
  const horizon = addDays(today, NEEDS_ACTION_DAYS);
  const waiting = entries.filter((e) => e.deadline.extension === 'pending' && e.deadline.due > horizon).length;

  return (
    <NeedsActionPanel
      entries={entries}
      overdue={overdue}
      withinDays={NEEDS_ACTION_DAYS}
      waiting={waiting}
      waitingLabel={`awaiting IPOPHL’s decision on an extension`}
      rowKey={(e) => `${e.trademark.id}|${e.deadline.label}|${e.deadline.officeAction?.id ?? ''}`}
      renderRow={({ trademark: t, deadline: d }) => {
        const spec = actionForDeadline(d.label, d.officeAction);
        const notOpen = !!d.opens && d.opens > today;
        return (
          <>
            <Link href={`/dashboard/trademarks/${t.id}`} className="min-w-0 sm:w-56 shrink-0 group">
              <span className="block text-[13px] font-medium text-stone-900 dark:text-stone-50 truncate group-hover:text-navy-700 dark:group-hover:text-navy-300 transition-colors">
                {t.mark || '(Untitled)'}
              </span>
              {t.clientName && <span className="block text-[11px] text-stone-500 dark:text-stone-400 truncate">{t.clientName}</span>}
            </Link>
            <div className="flex-1 min-w-0 flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="text-sm text-stone-800 dark:text-stone-100">{d.officeAction || d.label === 'Revival' ? deadlineLabel(d.label, d.officeAction) : d.label}</span>
              <DueChip due={d.due} />
              {d.extendedDue && (
                <span className="text-[11px] text-stone-400 dark:text-stone-500">
                  {d.extensionBasis === 'surcharge' ? 'late filing to' : 'extendible to'} {formatDateShort(d.extendedDue)}
                </span>
              )}
              {d.extension === 'pending' && (
                <span className={`text-[11px] ${TONE_TEXT.amber}`}>Extended — awaiting IPOPHL’s decision</span>
              )}
              {d.extension === 'denied' && (
                <span className={`text-[11px] ${TONE_TEXT.rose}`}>Extension denied — original period</span>
              )}
            </div>
            <div className="shrink-0">
              {notOpen ? (
                <span className="text-xs text-stone-400 dark:text-stone-500">Opens {formatDateShort(d.opens!)}</span>
              ) : spec ? (
                <TrademarkActionButton
                  trademarkId={t.id}
                  spec={spec}
                  size="sm"
                  onDone={(updated) => {
                    onUpdated(updated);
                    recordedToast(`${spec.label} — ${t.mark}`, {
                      trademarkId: t.id,
                      action: spec.action,
                      officeActionId: spec.officeActionId,
                      onUndone: onUpdated,
                    });
                  }}
                />
              ) : null}
            </div>
          </>
        );
      }}
    />
  );
}
