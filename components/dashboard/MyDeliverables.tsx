'use client';

import { useCallback, useMemo, useState } from 'react';
import { ChevronDown, Columns, FileText, Gavel, List } from 'lucide-react';
import SectionCard from '@/components/ui/SectionCard';
import ItemRow from '@/components/ItemRow';
import LoadError from '@/components/ui/LoadError';
import { useDetailPane } from '@/components/DetailPaneContext';
import { PILL_TONE, TONE_DOT, TONE_TEXT, type PillTone } from '@/components/ui/tone';
import { usePersistedState } from '@/hooks/use-persisted-state';
import { statusTone } from '@/lib/status-tone';
import DeliverableActionButtons, { type DeliverableActionPatch } from '@/components/DeliverableActionButtons';
import { applyDeliverablePatch, usePublishDeliverableUpdate, useDeliverableUpdates } from '@/components/DeliverableUpdatesContext';
import {
  STEP_ORDER,
  countsAsOverdue,
  groupMyDeliverables,
  isWithMe,
  myDate,
  type MyDeliverableStep,
} from '@/lib/my-deliverables';
import { dayCountdown, daysBetween, formatManila, toManilaDay, type CountdownTone } from '@/lib/dates';
import { DELIVERABLE_STATUS } from '@/lib/deliverable-status';
import type { NotionDeliverable } from '@/types/notion';

interface Props {
  /** Every active deliverable the person is involved in; null when the read failed. */
  initialItems: NotionDeliverable[] | null;
  userId: string;
  today: string;
  /** Matters that are court work: their deliverables carry a Court badge and go first on a shared date. */
  courtMatterIds: string[];
  /** When each Awaiting Client deliverable started waiting, where the workflow log knows. */
  waitingSince: Record<string, string>;
}

const STEP_LABEL: Record<MyDeliverableStep, string> = {
  review: 'To review',
  file: 'To finalize, file or send',
  draft: 'To draft or revise',
  client: 'Waiting on client',
};

/** Each step in the tone of the status that puts work there, as it reads everywhere else. */
const STEP_TONE: Record<MyDeliverableStep, PillTone> = {
  review: 'navy',
  file: 'teal',
  draft: 'blue',
  client: 'amber',
};

/** The rail beside a group's rows in the list. */
const STEP_RAIL: Record<MyDeliverableStep, string> = {
  review: 'border-navy-200 dark:border-navy-400/30',
  file: 'border-teal-200 dark:border-teal-500/25',
  draft: 'border-blue-200 dark:border-blue-500/25',
  client: 'border-amber-200 dark:border-amber-500/25',
};

type View = 'list' | 'board';

const VIEWS: { value: View; label: string; icon: typeof List }[] = [
  { value: 'list', label: 'List', icon: List },
  { value: 'board', label: 'Board', icon: Columns },
];

const SHOWN = 5;

/** Waiting on the client this long, it's time to follow up. */
const FOLLOW_UP_DAYS = 14;

const COUNTDOWN_TONE: Record<CountdownTone, string> = {
  late: 'bg-red-50 text-red-700 ring-red-200 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-500/25',
  today: 'bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/25',
  soon: 'bg-amber-50/60 text-amber-800 ring-amber-200/70 dark:bg-amber-500/[0.06] dark:text-amber-300 dark:ring-amber-500/20',
  later: 'bg-subtle text-[var(--text-secondary)] ring-[var(--border-color)]',
};

/** "3 days late", "Today", "in 4 days" — the date itself on hover. */
function Countdown({ date, today }: { date: string | null; today: string }) {
  if (!date) return null;
  const c = dayCountdown(date, today);
  return (
    <span
      title={formatManila(`${date}T00:00:00+08:00`, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
      className={`text-[11px] font-medium rounded-md px-2 py-0.5 ring-1 ring-inset whitespace-nowrap tabular-nums ${COUNTDOWN_TONE[c.tone]}`}
    >
      {c.label}
    </span>
  );
}

/** A group's heading: a band in the step's tone, so the groups part at a glance. */
function StepHeading({
  step,
  count,
  late,
  stale,
  folded,
  open,
  onToggle,
  stacked = false,
}: {
  step: MyDeliverableStep;
  count: number;
  late: number;
  stale: number;
  /** Folded groups open and close from the heading. */
  folded: boolean;
  open: boolean;
  onToggle: () => void;
  /** On the board: the flags go on a line of their own, kept even when empty, so the columns' cards line up. */
  stacked?: boolean;
}) {
  const tone = STEP_TONE[step];
  const flags = (
    <>
      {late > 0 && (
        <span className="rounded-full bg-white/80 px-1.5 py-px text-[11px] font-medium text-red-700 ring-1 ring-inset ring-red-200 tabular-nums dark:bg-black/20 dark:text-red-300 dark:ring-red-500/30">
          {late} overdue
        </span>
      )}
      {stale > 0 && (
        <span className="text-[11px] font-medium text-amber-800 dark:text-amber-200 tabular-nums">
          {stale} waiting 2+ weeks — follow up
        </span>
      )}
    </>
  );
  return (
    <button
      type="button"
      onClick={folded ? onToggle : undefined}
      className={`w-full rounded-lg border px-2.5 py-1.5 max-sm:min-h-9 text-left ${PILL_TONE[tone]} ${folded ? 'cursor-pointer' : 'cursor-default'}`}
      aria-expanded={folded ? open : undefined}
    >
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className={`w-2 h-2 rounded-full shrink-0 ${TONE_DOT[tone]}`} aria-hidden="true" />
        <span title={STEP_LABEL[step]} className={`text-xs font-semibold uppercase tracking-wider ${stacked ? 'min-w-0 flex-1 truncate' : ''}`}>{STEP_LABEL[step]}</span>
        <span className="text-xs font-medium tabular-nums opacity-70">{count}</span>
        {!stacked && flags}
        {folded && <ChevronDown className={`ml-auto w-3.5 h-3.5 transition-transform ${open ? '' : '-rotate-90'}`} />}
      </span>
      {stacked && <span className="mt-1 flex min-h-[19px] flex-wrap items-center gap-1.5 pl-4">{flags}</span>}
    </button>
  );
}

/** One deliverable as a board card; it opens in the side pane like a list row. */
function BoardCard({
  title,
  subtitle,
  badge,
  meta,
  action,
  onOpen,
}: {
  title: string;
  subtitle: string;
  badge?: string;
  meta: React.ReactNode;
  action: React.ReactNode;
  onOpen: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        if (e.currentTarget !== e.target) return;
        e.preventDefault();
        onOpen();
      }}
      className="group rounded-lg border border-stone-200 bg-white p-3 text-left shadow-[0_1px_0_rgba(0,0,0,0.02)] transition-colors cursor-pointer hover:border-stone-300 hover:shadow-sm dark:border-white/10 dark:bg-white/[0.03] dark:hover:border-white/20"
    >
      <p className="text-sm font-medium leading-snug text-foreground sm:line-clamp-3 max-sm:break-words group-hover:text-navy-800 dark:group-hover:text-navy-200">
        {title || '(Untitled)'}
      </p>
      {subtitle && <p className="mt-0.5 text-xs text-[var(--text-secondary)] truncate">{subtitle}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {badge && (
          <span className={`text-[11px] rounded-full px-2 py-0.5 font-medium whitespace-nowrap border ${PILL_TONE[statusTone(badge)]}`}>
            {badge}
          </span>
        )}
        {meta}
      </div>
      <div className="mt-2.5 flex justify-end" onClick={(e) => e.stopPropagation()}>
        {action}
      </div>
    </div>
  );
}

/**
 * The deliverables on the person's desk, grouped by the step they wait on
 * them for, overdue first, each with its next workflow action. Rows open in
 * the side pane. An action here or anywhere else on the page moves or drops
 * the row at once. Work waiting on the client sits apart, folded in the list
 * and as the last column on the board.
 */
export default function MyDeliverables({ initialItems, userId, today, courtMatterIds, waitingSince }: Props) {
  const [items, setItems] = useState<NotionDeliverable[]>(initialItems ?? []);
  // A fresh server read replaces the local rows (set during render, not in an effect).
  const [seen, setSeen] = useState(initialItems);
  if (seen !== initialItems) {
    setSeen(initialItems);
    setItems(initialItems ?? []);
  }
  const [expanded, setExpanded] = useState<Set<MyDeliverableStep>>(new Set());
  const [view, setView] = usePersistedState<View>('myDeliverables.view', 'list', { afterMount: true });
  // Something sent to the client from this page starts waiting now.
  const [since, setSince] = useState(waitingSince);
  const { openPane } = useDetailPane();

  const applyPatch = useCallback((id: string, patch: DeliverableActionPatch) => {
    setItems((prev) => prev.map((it) => (it.id === id ? applyDeliverablePatch(it, patch) : it)));
    if (patch.status === DELIVERABLE_STATUS.AWAITING_CLIENT) setSince((prev) => ({ ...prev, [id]: new Date().toISOString() }));
  }, []);
  useDeliverableUpdates(applyPatch);
  const publish = usePublishDeliverableUpdate();

  const court = useMemo(() => new Set(courtMatterIds), [courtMatterIds]);
  const isCourt = useCallback((d: NotionDeliverable) => !!d.matterId && court.has(d.matterId), [court]);
  const groups = useMemo(() => groupMyDeliverables(items, userId, today, isCourt), [items, userId, today, isCourt]);
  const waitedDays = (id: string) => (since[id] ? daysBetween(toManilaDay(since[id]), today) : null);
  const total = useMemo(() => items.filter((d) => isWithMe(d, userId)).length, [items, userId]);
  const overdue = useMemo(() => items.filter((d) => countsAsOverdue(d, userId, today)).length, [items, userId, today]);

  if (!initialItems) {
    return (
      <SectionCard id="my-deliverables" title="My deliverables" icon={<FileText className="w-5 h-5" />}>
        <LoadError />
      </SectionCard>
    );
  }

  const toggle = (step: MyDeliverableStep) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(step)) next.delete(step);
      else next.add(step);
      return next;
    });

  const summary = (step: MyDeliverableStep) => {
    const rows = groups[step];
    const waiting = step === 'client';
    return {
      rows,
      waiting,
      late: rows.filter((d) => countsAsOverdue(d, userId, today)).length,
      stale: waiting ? rows.filter((d) => (waitedDays(d.id) ?? 0) >= FOLLOW_UP_DAYS).length : 0,
      // A status pill says something only where the group mixes statuses: To review is Under Review.
      mixed: new Set(rows.map((d) => d.status)).size > 1,
    };
  };

  const subtitleOf = (d: NotionDeliverable, waiting: boolean) => {
    const waited = waiting ? waitedDays(d.id) : null;
    return [
      d.client || d.matter || null,
      waiting ? (waited === null ? 'Waiting' : `Waiting ${waited} ${waited === 1 ? 'day' : 'days'}`) : null,
    ]
      .filter(Boolean)
      .join(' · ');
  };

  const metaOf = (d: NotionDeliverable, waiting: boolean) => (
    <>
      {isCourt(d) && (
        <span className="inline-flex items-center gap-1 rounded-full border border-violet-200 bg-violet-50 px-1.5 py-px text-[11px] font-medium text-violet-700 dark:border-violet-500/25 dark:bg-violet-500/10 dark:text-violet-300">
          <Gavel className="w-3 h-3" aria-hidden="true" />
          Court
        </span>
      )}
      {/* Not late on the person while it waits on the client: the date, not a countdown. */}
      {waiting ? (
        <span className="text-[11px] text-[var(--text-muted)] whitespace-nowrap">
          {myDate(d, userId) ? formatManila(`${myDate(d, userId)}T00:00:00+08:00`, { month: 'short', day: 'numeric' }) : ''}
        </span>
      ) : (
        <Countdown date={myDate(d, userId)} today={today} />
      )}
    </>
  );

  const actionOf = (d: NotionDeliverable) => (
    <DeliverableActionButtons
      deliverableId={d.id}
      deliverableName={d.name}
      status={d.status}
      type={d.type}
      matterId={d.matterId}
      matterName={d.matter}
      drafterIds={d.drafter}
      reviewerIds={d.reviewerIds}
      currentlyWithIds={d.currentlyWith}
      variant="menu"
      onActionComplete={(patch) => publish(d.id, patch)}
    />
  );

  const moreButton = (step: MyDeliverableStep, count: number) =>
    count > SHOWN && (
      <button
        type="button"
        onClick={() => toggle(step)}
        className="mt-1 px-2.5 py-1 max-sm:min-h-9 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
      >
        {expanded.has(step) ? 'Show fewer' : `Show ${count - SHOWN} more`}
      </button>
    );

  const list = (
    <div className="space-y-4">
      {STEP_ORDER.filter((step) => groups[step].length > 0).map((step) => {
        const { rows, waiting, late, stale, mixed } = summary(step);
        const open = expanded.has(step);
        // Waiting on client is folded until opened; the others show their first few.
        const visible = waiting ? (open ? rows : []) : open ? rows : rows.slice(0, SHOWN);
        return (
          <div key={step}>
            <StepHeading
              step={step}
              count={rows.length}
              late={late}
              stale={stale}
              folded={waiting}
              open={open}
              onToggle={() => toggle(step)}
            />
            {visible.length > 0 && (
              <div className={`mt-1.5 ml-[13px] border-l-2 pl-1.5 space-y-0.5 ${STEP_RAIL[step]}`}>
                {visible.map((d) => (
                  <ItemRow
                    key={d.id}
                    href={`/dashboard/deliverables/${d.id}`}
                    openPane={{ entity: 'deliverables', id: d.id }}
                    title={d.name}
                    wrapTitle
                    subtitle={subtitleOf(d, waiting)}
                    badge={mixed ? d.status : undefined}
                    meta={metaOf(d, waiting)}
                    right={actionOf(d)}
                  />
                ))}
              </div>
            )}
            {!waiting && moreButton(step, rows.length)}
          </div>
        );
      })}
    </div>
  );

  // Every step is a column, empty ones too, so a card's place on the board always means the same thing.
  const board = (
    <div className="-mx-5 overflow-x-auto px-5 pb-1">
      <div className="grid grid-flow-col auto-cols-[minmax(250px,1fr)] gap-3 max-sm:grid-flow-row max-sm:grid-cols-[minmax(0,1fr)]">
        {STEP_ORDER.map((step) => {
          const { rows, waiting, late, stale, mixed } = summary(step);
          const visible = expanded.has(step) ? rows : rows.slice(0, SHOWN);
          return (
            <div key={step} className="flex min-w-0 flex-col rounded-xl bg-stone-50 p-2 dark:bg-white/[0.02]">
              <StepHeading
                step={step}
                count={rows.length}
                late={late}
                stale={stale}
                folded={false}
                open
                onToggle={() => toggle(step)}
                stacked
              />
              <div className="mt-2 space-y-2">
                {visible.map((d) => (
                  <BoardCard
                    key={d.id}
                    title={d.name}
                    subtitle={subtitleOf(d, waiting)}
                    badge={mixed ? d.status : undefined}
                    meta={metaOf(d, waiting)}
                    action={actionOf(d)}
                    onOpen={() => openPane('deliverables', d.id)}
                  />
                ))}
                {rows.length === 0 && (
                  <p className={`px-1 py-3 text-center text-xs ${TONE_TEXT[STEP_TONE[step]]} opacity-60`}>Nothing here</p>
                )}
              </div>
              {moreButton(step, rows.length)}
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <SectionCard
      id="my-deliverables"
      title="My deliverables"
      icon={<FileText className="w-5 h-5" />}
      count={total}
      className={overdue > 0 ? 'border-rose-200 dark:border-rose-500/25' : ''}
      actions={
        <div className="flex items-center gap-3">
          {overdue > 0 && (
            <span className="text-xs font-medium text-red-600 dark:text-red-400 tabular-nums">{overdue} overdue</span>
          )}
          {total > 0 && (
            <div role="radiogroup" aria-label="Layout" className="inline-flex rounded-lg border border-stone-200 dark:border-white/10 p-0.5 text-xs">
              {VIEWS.map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={view === value}
                  onClick={() => setView(value)}
                  className={`inline-flex items-center gap-1 px-2 py-1 max-sm:min-h-9 max-sm:px-3 rounded-md font-medium transition-colors cursor-pointer ${
                    view === value
                      ? 'bg-stone-100 text-stone-900 dark:bg-white/10 dark:text-stone-50'
                      : 'text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-200'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" aria-hidden="true" />
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
      }
    >
      {total === 0 ? (
        <p className="py-2 px-1 text-sm text-[var(--text-secondary)]">Nothing is with you right now.</p>
      ) : view === 'board' ? (
        board
      ) : (
        list
      )}
    </SectionCard>
  );
}
