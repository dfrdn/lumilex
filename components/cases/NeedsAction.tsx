'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, CalendarClock, CheckCircle2, FileText } from 'lucide-react';
import { DueChip, StatusPill } from '@/components/ui/primitives';
import { BTN_OUTLINE, CARD } from '@/components/ui/tone';
import type { CaseHearingEntry, CaseNeedsAction as Needs } from '@/lib/queries/cases';
import { HEARING_HORIZON_DAYS } from '@/lib/cases/view';
import { filingTone, hearingWhen, manilaDay } from './ui';

const COLLAPSED = 5;

/**
 * What needs a lawyer now, split by the work it asks for: what to file or
 * submit (deliverables due on a case's matters, and MR due dates), and
 * hearings — the next fortnight's, and recent ones with no outcome recorded.
 */
export default function CaseNeedsAction({ needs }: { needs: Needs }) {
  return (
    <div id="needs-action" className="scroll-mt-20 grid gap-4 lg:grid-cols-2 items-start">
      <Column
        title="To file"
        icon={<FileText className="w-4 h-4" />}
        entries={needs.filings}
        late={needs.filingsOverdue}
        lateLabel="past due"
        empty={`Nothing to file in the next ${HEARING_HORIZON_DAYS} days.`}
        row={(e) => (
          <>
            <Body e={e} sub={[e.kind === 'mr' ? 'Motion for reconsideration' : null, e.forum].filter(Boolean).join(' · ')} />
            <div className="flex items-center gap-2 shrink-0">
              {e.kind === 'filing' && e.status && <StatusPill label={e.status} tone={filingTone(e.status)} size="sm" />}
              <DueChip due={e.date} />
              <OpenLink href={e.kind === 'mr' ? `/dashboard/cases/${e.caseId}` : `/dashboard/deliverables/${e.id}`} />
            </div>
          </>
        )}
      />
      <Column
        title="Hearings"
        icon={<CalendarClock className="w-4 h-4" />}
        entries={needs.hearings}
        late={needs.unrecorded}
        lateLabel="with no outcome"
        empty={`No hearing in the next ${HEARING_HORIZON_DAYS} days.`}
        row={(e) => (
          <>
            <Body e={e} sub={`${e.forum} · ${hearingWhen(e.date)}`} />
            <div className="flex items-center gap-2 shrink-0">
              {e.outcome === 'unrecorded' ? (
                <span className="inline-flex items-center px-1.5 py-px text-[10px] font-medium rounded-full border bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:border-rose-500/20">
                  Record outcome
                </span>
              ) : (
                <DueChip due={manilaDay(e.date)} showDate={false} />
              )}
              <OpenLink href={`/dashboard/hearings/${e.id}`} />
            </div>
          </>
        )}
      />
    </div>
  );
}

function Column({
  title,
  icon,
  entries,
  late,
  lateLabel,
  empty,
  row,
}: {
  title: string;
  icon: React.ReactNode;
  entries: CaseHearingEntry[];
  late: number;
  lateLabel: string;
  empty: string;
  row: (e: CaseHearingEntry) => React.ReactNode;
}) {
  const [all, setAll] = useState(false);
  const shown = all ? entries : entries.slice(0, COLLAPSED);
  return (
    <section className={`${CARD} overflow-hidden`}>
      <header className={`px-5 py-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-stone-100 dark:border-white/[0.06] ${late ? 'bg-rose-50/60 dark:bg-rose-500/[0.06]' : ''}`}>
        <span className={late ? 'text-rose-500' : 'text-stone-400 dark:text-stone-500'}>{icon}</span>
        <h2 className="font-serif text-base text-stone-900 dark:text-stone-50">{title}</h2>
        <span className="text-[11px] text-stone-500 dark:text-stone-400">
          {late > 0 && <span className="text-rose-600 dark:text-rose-400 font-medium">{late} {lateLabel}</span>}
          {late > 0 && entries.length > late && ' · '}
          {entries.length > late && `${entries.length - late} in the next ${HEARING_HORIZON_DAYS} days`}
        </span>
      </header>
      {entries.length === 0 ? (
        <p className="flex items-center gap-2 px-5 py-3 text-sm text-stone-600 dark:text-stone-300">
          <CheckCircle2 className="pop w-4 h-4 text-emerald-500 shrink-0" />
          {empty}
        </p>
      ) : (
        <ul className="divide-y divide-stone-100 dark:divide-white/[0.06]">
          {shown.map((e, i) => (
            <li
              key={`${e.kind}:${e.id}`}
              style={{ '--i': Math.min(i, 8) } as React.CSSProperties}
              className="rise-in px-5 py-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 hover:bg-stone-50/70 dark:hover:bg-white/[0.02] transition-colors"
            >
              {row(e)}
            </li>
          ))}
        </ul>
      )}
      {entries.length > COLLAPSED && (
        <button
          type="button"
          onClick={() => setAll((v) => !v)}
          className="w-full px-5 py-2 text-xs font-medium text-navy-700 dark:text-navy-300 hover:bg-stone-50 dark:hover:bg-white/5 border-t border-stone-100 dark:border-white/[0.06] transition-colors"
        >
          {all ? 'Show fewer' : `Show all ${entries.length}`}
        </button>
      )}
    </section>
  );
}

function Body({ e, sub }: { e: CaseHearingEntry; sub: string }) {
  return (
    <div className="flex-1 min-w-0">
      <span className="block text-[13px] font-medium text-stone-900 dark:text-stone-50 truncate" title={e.name}>
        {e.name}
      </span>
      <span className="block text-[11px] text-stone-500 dark:text-stone-400 truncate">
        <Link href={`/dashboard/cases/${e.caseId}`} className="hover:text-navy-700 dark:hover:text-navy-300">
          {e.caseTitle}
        </Link>
        {sub && ` · ${sub}`}
      </span>
    </div>
  );
}

function OpenLink({ href }: { href: string }) {
  return (
    <Link href={href} className={`${BTN_OUTLINE} px-2.5 py-1`}>
      Open <ArrowUpRight className="w-3 h-3" />
    </Link>
  );
}
