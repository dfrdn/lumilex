'use client';

import Link from 'next/link';
import { ArrowRight, Building2, CalendarDays, CheckCircle2, History, Sparkles } from 'lucide-react';
import type { Corporation } from '@/types/corporations';
import type { CorporationActivityEntry } from '@/lib/queries/corporations';
import {
  DUE_SOON_DAYS,
  relativeDue,
  shortDate,
  type CorporationStatus,
  type StatusItem,
  type TrackKey,
  TRACK_LABEL,
} from '@/lib/corporations/status';
import { ACTION_LABELS, formatWhen, humanizeFields } from '../CorporationActivityTab';
import { STATE_CHIP } from '@/components/ui/tone';
import { Fact, SubjectCard as Card } from '@/components/ui/primitives';
import { TRACK_TAB } from './tracks';
import { focusField } from '@/lib/focus-field';
import { addDays } from '@/lib/dates';

type Tab = (typeof TRACK_TAB)[TrackKey] | 'activity';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function ItemRow({ item, track, today, onOpen }: {
  item: StatusItem;
  track: TrackKey;
  today: string;
  onOpen: (tab: Tab) => void;
}) {
  const chip = STATE_CHIP[item.state];
  const when = relativeDue(item.dueDate, today);
  const body = (
    <>
      <span
        className={`mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 ${
          item.state === 'overdue' ? 'bg-rose-500' : item.state === 'waiting_on_client' ? 'bg-amber-500' : 'bg-navy-400'
        }`}
      />
      <span className="flex-1 min-w-0">
        <span className="block text-sm text-stone-800 dark:text-stone-100 truncate">{item.label}</span>
        <span className="block text-[11px] text-stone-500 dark:text-stone-400 truncate">
          {TRACK_LABEL[track]}
          {item.detail ? ` · ${item.detail}` : ''}
          {item.provisional ? ' · provisional date' : ''}
        </span>
      </span>
      <span className="flex flex-col items-end gap-1 shrink-0">
        <span className={`px-1.5 py-0.5 rounded-md ring-1 ring-inset text-[10px] font-medium ${chip.cls}`}>{chip.label}</span>
        {when && (
          <span className={`text-[11px] tabular-nums ${item.state === 'overdue' ? 'text-rose-600 dark:text-rose-400' : 'text-stone-500 dark:text-stone-400'}`}>
            {when}
          </span>
        )}
      </span>
    </>
  );
  const cls =
    'w-full flex items-start gap-3 px-2 -mx-2 py-2 rounded-lg text-left hover:bg-stone-50 dark:hover:bg-white/5 transition-colors';
  return item.deliverableId ? (
    <Link href={`/dashboard/deliverables/${item.deliverableId}`} className={cls}>
      {body}
    </Link>
  ) : (
    <button type="button" onClick={() => onOpen(TRACK_TAB[track])} className={cls}>
      {body}
    </button>
  );
}

const peso = (n: number | null) =>
  n === null ? null : `₱${n.toLocaleString('en-PH', { maximumFractionDigits: 2 })}`;

/**
 * The registered company's dashboard: what needs doing now, what falls due
 * next, the facts people look up, and what changed recently. Every item is
 * the status engine's reading of the record, the same one the track cards
 * and the registry use.
 */
export default function CorporationOverview({
  corporation: c,
  status,
  today,
  activity,
  retainerName,
  onOpen,
  setupChecklist,
}: {
  corporation: Corporation;
  status: CorporationStatus;
  today: string;
  activity: CorporationActivityEntry[];
  retainerName: string | null;
  onOpen: (tab: Tab) => void;
  setupChecklist: React.ReactNode;
}) {
  const soon = addDays(today, DUE_SOON_DAYS);
  const horizon = addDays(today, 120);
  const open = status.tracks.flatMap((t) =>
    t.items
      .filter((i) => !['done', 'filed', 'not_ours'].includes(i.state))
      .map((item) => ({ item, track: t.key })),
  );
  const byDue = (a: { item: StatusItem }, b: { item: StatusItem }) =>
    (a.item.dueDate ?? '9999').localeCompare(b.item.dueDate ?? '9999');

  const attention = open
    .filter(({ item }) => item.state === 'overdue' || item.state === 'waiting_on_client' || (item.dueDate && item.dueDate <= soon))
    .sort((a, b) => (a.item.state === 'overdue' ? 0 : 1) - (b.item.state === 'overdue' ? 0 : 1) || byDue(a, b));
  const attentionKeys = new Set(attention.map(({ item }) => item.key));
  const upcoming = open
    .filter(({ item }) => item.dueDate && item.dueDate > today && item.dueDate <= horizon && !attentionKeys.has(item.key))
    .sort(byDue);

  const byMonth = new Map<string, typeof upcoming>();
  for (const u of upcoming) {
    const key = u.item.dueDate!.slice(0, 7);
    byMonth.set(key, [...(byMonth.get(key) ?? []), u]);
  }

  const meeting = c.annualMeetingMonth && c.annualMeetingDay ? `${MONTHS[c.annualMeetingMonth - 1]} ${c.annualMeetingDay}` : null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className="lg:col-span-2 space-y-4">
        <Card
          title="Needs attention"
          icon={<Sparkles className="w-4 h-4" />}
          action={
            attention.length > 0 ? (
              <span className="text-[11px] text-stone-500 dark:text-stone-400">{attention.length} item{attention.length === 1 ? '' : 's'}</span>
            ) : null
          }
        >
          {attention.length === 0 ? (
            <div className="flex items-center gap-3 py-3">
              <span className="w-9 h-9 rounded-full bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                <CheckCircle2 className="w-5 h-5" />
              </span>
              <div>
                <p className="text-sm font-medium text-stone-800 dark:text-stone-100">All clear</p>
                <p className="text-xs text-stone-500 dark:text-stone-400">Nothing is overdue or due in the next {DUE_SOON_DAYS} days.</p>
              </div>
            </div>
          ) : (
            <div className="divide-y divide-stone-100 dark:divide-white/[0.06]">
              {attention.slice(0, 8).map(({ item, track }) => (
                <ItemRow key={item.key} item={item} track={track} today={today} onOpen={onOpen} />
              ))}
              {attention.length > 8 && (
                <p className="pt-2 text-[11px] text-stone-500 dark:text-stone-400">+ {attention.length - 8} more across the tracks above</p>
              )}
            </div>
          )}
        </Card>

        {setupChecklist}

        <Card title="Coming up" icon={<CalendarDays className="w-4 h-4" />} action={<span className="text-[11px] text-stone-500 dark:text-stone-400">Next 4 months</span>}>
          {upcoming.length === 0 ? (
            <p className="py-2 text-sm text-stone-500 dark:text-stone-400">No other deadlines in the next four months.</p>
          ) : (
            <div className="space-y-3">
              {[...byMonth.entries()].map(([month, items]) => (
                <div key={month}>
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500 mb-1">
                    {MONTHS[Number(month.slice(5)) - 1]} {month.slice(0, 4)}
                  </div>
                  <div className="divide-y divide-stone-100 dark:divide-white/[0.06]">
                    {items.map(({ item, track }) => (
                      <ItemRow key={item.key} item={item} track={track} today={today} onOpen={onOpen} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <div className="space-y-4">
        <Card title="At a glance" icon={<Building2 className="w-4 h-4" />}>
          <dl>
            <Fact label="SEC registered" value={c.secRegistrationDate ? shortDate(c.secRegistrationDate) : null} />
            <Fact label="Fiscal year ends" value={MONTHS[(c.fiscalYearEndMonth || 12) - 1]} />
            <Fact
              label="Annual meeting"
              value={
                meeting ?? (
                  <button
                    type="button"
                    onClick={() => focusField('annualMeetingMonth')}
                    className="text-navy-700 dark:text-navy-300 hover:underline text-[12px]"
                  >
                    Set in details below
                  </button>
                )
              }
            />
            <Fact label="Authorized capital" value={peso(c.authorizedCapitalStock)} />
            <Fact label="Paid-up capital" value={peso(c.paidUpCapital)} />
            <Fact label="External auditor" value={c.externalAuditorName} />
            <Fact
              label="Retainer"
              value={
                c.retainerMatterId && retainerName ? (
                  <Link href={`/dashboard/matters/${c.retainerMatterId}`} className="text-navy-700 dark:text-navy-300 hover:underline">
                    {retainerName}
                  </Link>
                ) : null
              }
            />
          </dl>
        </Card>

        <Card
          title="Recent activity"
          icon={<History className="w-4 h-4" />}
          action={
            activity.length > 0 ? (
              <button type="button" onClick={() => onOpen('activity')} className="inline-flex items-center gap-1 text-[11px] text-navy-700 dark:text-navy-300 hover:underline">
                All <ArrowRight className="w-3 h-3" />
              </button>
            ) : null
          }
        >
          {activity.length === 0 ? (
            <p className="py-1 text-sm text-stone-500 dark:text-stone-400">No changes recorded yet.</p>
          ) : (
            <ol className="relative space-y-3 before:absolute before:left-[3px] before:top-1.5 before:bottom-1.5 before:w-px before:bg-stone-200 dark:before:bg-white/10">
              {activity.slice(0, 5).map((e) => (
                <li key={e.id} className="relative pl-4">
                  <span className="absolute left-0 top-1.5 w-[7px] h-[7px] rounded-full bg-white dark:bg-card ring-2 ring-navy-300 dark:ring-navy-400/60" />
                  <p className="text-[12px] text-stone-700 dark:text-stone-200 leading-snug">
                    <span className="font-medium">{e.performedByName ?? 'Someone'}</span> {ACTION_LABELS[e.action] ?? e.action}
                    {e.fieldChanged ? <span className="text-stone-500 dark:text-stone-400"> — {humanizeFields(e.fieldChanged)}</span> : null}
                  </p>
                  <p className="text-[11px] text-stone-400 dark:text-stone-500">{formatWhen(e.createdAt)}</p>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>
    </div>
  );
}
