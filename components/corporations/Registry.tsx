import PrefetchLink from '@/components/PrefetchLink';
import { AlertTriangle, ArrowUpRight, CalendarClock, Clock3, Hourglass, Layers } from 'lucide-react';
import Avatar from '@/components/Avatar';
import { relativeDue, shortDate, TRACK_LABEL, type Phase } from '@/lib/corporations/status';
import type { RegistryFilter, RegistryRow, RegistrySummary, UpcomingItem } from '@/lib/queries/registry';
import { HEALTH_STYLE, STATE_CHIP } from '@/components/ui/tone';
import { RowThumb } from '@/components/ui/primitives';
import { addDays } from '@/lib/dates';
import SummaryCards, { type SummaryCard } from '@/components/ui/SummaryCards';
import ListSection from '@/components/ui/ListSection';

const PHASES: { key: Exclude<Phase, 'dissolved'>; label: string }[] = [
  { key: 'application', label: 'Application' },
  { key: 'post_registration', label: 'Set-up' },
  { key: 'ongoing', label: 'Ongoing' },
];

export function hrefWith(params: Record<string, string | undefined>, patch: Record<string, string | undefined>): string {
  const next = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...params, ...patch })) if (v) next.set(k, v);
  const qs = next.toString();
  return `/dashboard/corporations${qs ? `?${qs}` : ''}`;
}

// ── Summary strip ──────────────────────────────────────────────────────────

export function SummaryStrip({
  summary,
  active,
  params,
}: {
  summary: RegistrySummary;
  active: RegistryFilter;
  params: Record<string, string | undefined>;
}) {
  const cards: SummaryCard[] = [
    {
      key: 'overdue',
      label: 'Overdue',
      value: summary.overdueCompanies,
      sub: `companies · ${summary.overdueItems} item${summary.overdueItems === 1 ? '' : 's'} past due`,
      icon: <AlertTriangle className="w-4 h-4" />,
      accent: 'rose',
    },
    {
      key: 'soon',
      label: 'Due in 30 days',
      value: summary.dueSoonItems,
      sub: 'filings and meetings',
      icon: <Clock3 className="w-4 h-4" />,
      accent: 'amber',
    },
    {
      key: 'waiting',
      label: 'Waiting on client',
      value: summary.waiting,
      sub: 'open file requests',
      icon: <Hourglass className="w-4 h-4" />,
      accent: 'gold',
    },
    {
      key: 'setup',
      label: 'In set-up',
      value: summary.inSetup,
      sub: 'application or post-registration',
      icon: <Layers className="w-4 h-4" />,
      accent: 'navy',
    },
  ];
  return (
    <SummaryCards
      cards={cards.map((c) => ({
        ...c,
        active: active === c.key,
        href: hrefWith(params, { f: active === c.key ? undefined : c.key, page: undefined, view: undefined }),
      }))}
    />
  );
}

// ── Companies ──────────────────────────────────────────────────────────────

function PhaseDots({ phase }: { phase: Phase | null }) {
  if (!phase || phase === 'dissolved') {
    return <span className="text-[11px] text-stone-400 dark:text-stone-500">{phase === 'dissolved' ? 'Dissolved' : '—'}</span>;
  }
  const at = PHASES.findIndex((p) => p.key === phase);
  return (
    <span className="inline-flex items-center gap-2">
      <span className="inline-flex items-center gap-1">
        {PHASES.map((p, i) => (
          <span
            key={p.key}
            className={`h-1.5 rounded-full transition-all ${
              i < at
                ? 'w-3 bg-emerald-400 dark:bg-emerald-500/70'
                : i === at
                  ? 'w-5 bg-navy-600 dark:bg-navy-300'
                  : 'w-3 bg-stone-200 dark:bg-white/10'
            }`}
          />
        ))}
      </span>
      <span className="text-[12px] text-stone-600 dark:text-stone-300">{PHASES[at]?.label}</span>
    </span>
  );
}

function TrackChip({ track }: { track: RegistryRow['focus'][number] }) {
  const h = HEALTH_STYLE[track.health];
  const inProgress = track.health === 'green' && track.done < track.total;
  return (
    <span
      className="inline-flex items-center gap-1.5 max-w-full px-2 py-0.5 rounded-full bg-stone-50 dark:bg-white/[0.05] ring-1 ring-inset ring-stone-200 dark:ring-white/10 text-[11px]"
      title={`${track.label}: ${track.summary}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${inProgress ? 'bg-navy-500 dark:bg-navy-300' : h.dot}`} />
      <span className="font-medium text-stone-700 dark:text-stone-200">{track.label}</span>
      <span className="text-stone-500 dark:text-stone-400 truncate">
        {track.health === 'red' ? track.summary : track.total ? `${track.done}/${track.total}` : track.summary}
      </span>
    </span>
  );
}

const ROW_COLS = 'lg:grid-cols-[minmax(0,2.4fr)_minmax(0,1fr)_minmax(0,2.2fr)_minmax(0,1.8fr)_88px]';

/** One compact row per company, worst news first: two lines at any width. */
export function CompanyRows({ rows, today }: { rows: RegistryRow[]; today: string }) {
  return (
    <div className="rounded-2xl border border-stone-200 dark:border-white/10 bg-white dark:bg-card overflow-hidden">
      <div className={`hidden lg:grid ${ROW_COLS} gap-4 px-4 py-2 border-b border-stone-100 dark:border-white/[0.06] text-[11px] font-medium uppercase tracking-wider text-stone-400 dark:text-stone-500`}>
        <span>Company</span>
        <span>Phase</span>
        <span>In focus</span>
        <span>Next</span>
        <span className="text-right">Team</span>
      </div>
      <ul className="divide-y divide-stone-100 dark:divide-white/[0.06]">
        {rows.map((r, i) => {
          const overdue = r.next?.state === 'overdue';
          return (
            <li key={r.id} className="rise-in" style={{ '--i': i } as React.CSSProperties}>
              <PrefetchLink
                href={`/dashboard/corporations/${r.id}`}
                className={`group grid grid-cols-[minmax(0,1fr)_auto] ${ROW_COLS} gap-x-4 items-center px-4 py-2 group-data-[density=comfortable]/rows:py-3.5 hover:bg-stone-50/70 dark:hover:bg-white/[0.03] transition-colors`}
              >
                <span className="flex items-center gap-2.5 min-w-0">
                  <RowThumb name={r.name} health={r.health} />
                  <span className="min-w-0">
                    <span className="block text-[13px] group-data-[density=comfortable]/rows:text-sm font-medium leading-tight text-stone-900 dark:text-stone-50 truncate group-hover:text-navy-800 dark:group-hover:text-navy-200" title={r.name}>
                      {r.name}
                    </span>
                    {/* Narrow: the phase rides on this line, in place of its column. */}
                    <span className="flex items-center gap-1.5 mt-0.5 text-[11px] leading-tight text-stone-500 dark:text-stone-400 min-w-0">
                      <span className="lg:hidden shrink-0">
                        <PhaseDots phase={r.phase} />
                      </span>
                      <span className="truncate">
                        {[r.clientName, r.companyType, r.identifier ? `SEC ${r.identifier}` : null].filter(Boolean).join(' · ') || '—'}
                      </span>
                    </span>
                    {/* Comfortable, narrow: the tracks in focus get their own line. */}
                    {r.focus.length > 0 && (
                      <span className="hidden group-data-[density=comfortable]/rows:max-lg:flex flex-wrap gap-1.5 mt-1.5">
                        {r.focus.map((t) => <TrackChip key={t.key} track={t} />)}
                      </span>
                    )}
                  </span>
                </span>

                <span className="hidden lg:flex items-center">
                  <PhaseDots phase={r.phase} />
                </span>

                <span className="hidden lg:flex flex-wrap items-center gap-1.5 min-w-0">
                  {r.focus.length ? r.focus.map((t) => <TrackChip key={t.key} track={t} />) : <span className="text-[11px] text-stone-400">—</span>}
                </span>

                <span className="min-w-0 max-w-[45vw] lg:max-w-none flex flex-col justify-center text-right lg:text-left">
                  {r.next ? (
                    <>
                      <span className="text-[12px] font-medium leading-tight text-stone-800 dark:text-stone-100 truncate" title={r.next.label}>{r.next.label}</span>
                      <span className={`mt-0.5 text-[11px] leading-tight ${overdue ? 'text-rose-600 dark:text-rose-400' : 'text-stone-500 dark:text-stone-400'}`}>
                        {relativeDue(r.next.dueDate, today) ?? (r.next.track ? TRACK_LABEL[r.next.track] : '')}
                      </span>
                    </>
                  ) : (
                    <span className="text-[12px] text-emerald-600 dark:text-emerald-400">All current</span>
                  )}
                </span>

                <span className="hidden lg:flex items-center justify-end gap-2">
                  <span className="flex -space-x-1.5">
                    {r.team.slice(0, 3).map((m) => (
                      <Avatar key={m.name} avatarUrl={m.avatarUrl} initials={m.initials} name={m.name} size={22} className="ring-2 ring-white dark:ring-[var(--card-bg)]" />
                    ))}
                  </span>
                  <ArrowUpRight className="w-3.5 h-3.5 text-stone-300 dark:text-stone-600 group-hover:text-navy-600 dark:group-hover:text-navy-300 transition-colors" />
                </span>
              </PrefetchLink>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ── Upcoming ───────────────────────────────────────────────────────────────

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function UpcomingRow({ item, today }: { item: UpcomingItem; today: string }) {
  const chip = STATE_CHIP[item.state];
  return (
    <li className="rise-in grid grid-cols-[64px_minmax(0,1fr)_auto] items-center gap-4 px-5 py-3 hover:bg-stone-50/70 dark:hover:bg-white/[0.03] transition-colors">
      <span className="text-center">
        <span className="block font-serif text-xl leading-none tabular-nums text-stone-900 dark:text-stone-50">{Number(item.dueDate.slice(8, 10))}</span>
        <span className="block text-[10px] uppercase tracking-wider text-stone-500 dark:text-stone-400">
          {MONTHS[Number(item.dueDate.slice(5, 7)) - 1].slice(0, 3)} {item.dueDate.slice(2, 4)}
        </span>
      </span>
      <span className="min-w-0">
        <PrefetchLink href={`/dashboard/corporations/${item.subjectId}`} className="block text-sm font-medium text-stone-900 dark:text-stone-50 truncate hover:text-navy-700 dark:hover:text-navy-300">
          {item.company}
        </PrefetchLink>
        <span className="block text-[12px] text-stone-600 dark:text-stone-300 truncate">
          {item.deliverableId ? (
            <PrefetchLink href={`/dashboard/deliverables/${item.deliverableId}`} className="hover:underline">
              {item.label}
            </PrefetchLink>
          ) : (
            item.label
          )}
          <span className="text-stone-400 dark:text-stone-500">
            {' '}· {TRACK_LABEL[item.track]}
            {item.provisional ? ' · provisional date' : ''}
            {item.detail ? ` · ${item.detail}` : ''}
          </span>
        </span>
      </span>
      <span className="flex flex-col items-end gap-1">
        <span className={`px-1.5 py-0.5 rounded-md ring-1 ring-inset text-[10px] font-medium ${chip.cls}`}>{chip.label}</span>
        <span className={`text-[11px] tabular-nums ${item.state === 'overdue' ? 'text-rose-600 dark:text-rose-400' : 'text-stone-500 dark:text-stone-400'}`}>
          {relativeDue(item.dueDate, today)}
        </span>
      </span>
    </li>
  );
}

export function UpcomingList({
  overdue,
  upcoming,
  overdueTotal,
  upcomingTotal,
  today,
}: {
  overdue: UpcomingItem[];
  upcoming: UpcomingItem[];
  overdueTotal: number;
  upcomingTotal: number;
  today: string;
}) {
  const byMonth = new Map<string, UpcomingItem[]>();
  for (const u of upcoming) byMonth.set(u.dueDate.slice(0, 7), [...(byMonth.get(u.dueDate.slice(0, 7)) ?? []), u]);
  return (
    <div className="space-y-4">
      {overdue.length > 0 && (
        <ListSection
          title="Overdue"
          count={overdueTotal > overdue.length ? `showing ${overdue.length} of ${overdueTotal}` : `${overdueTotal} item${overdueTotal === 1 ? '' : 's'}`}
          tone="bg-rose-50/60 dark:bg-rose-500/[0.06]"
        >
          <ul className="divide-y divide-stone-100 dark:divide-white/[0.06]">
            {overdue.map((i) => (
              <UpcomingRow key={`${i.subjectId}-${i.label}-${i.dueDate}`} item={i} today={today} />
            ))}
          </ul>
        </ListSection>
      )}
      {[...byMonth.entries()].map(([month, items]) => (
        <ListSection key={month} title={`${MONTHS[Number(month.slice(5)) - 1]} ${month.slice(0, 4)}`} count={`${items.length} due`}>
          <ul className="divide-y divide-stone-100 dark:divide-white/[0.06]">
            {items.map((i) => (
              <UpcomingRow key={`${i.subjectId}-${i.label}-${i.dueDate}`} item={i} today={today} />
            ))}
          </ul>
        </ListSection>
      ))}
      {upcoming.length === 0 && overdue.length === 0 && (
        <div className="rounded-2xl border border-dashed border-stone-200 dark:border-white/10 px-6 py-10 text-center">
          <CalendarClock className="w-6 h-6 mx-auto text-stone-300 dark:text-stone-600" />
          <p className="mt-2 text-sm text-stone-600 dark:text-stone-300">Nothing due in the next 90 days.</p>
        </div>
      )}
      {upcomingTotal > upcoming.length && (
        <p className="text-center text-[11px] text-stone-500 dark:text-stone-400">
          Showing the first {upcoming.length} of {upcomingTotal} upcoming items — narrow with search.
        </p>
      )}
      <p className="text-center text-[11px] text-stone-400 dark:text-stone-500">Through {shortDate(addDays(today, 90))}</p>
    </div>
  );
}
