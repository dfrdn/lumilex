'use client';

import {
  Gavel, Handshake, FolderOpen, ClipboardCheck, FileText, Clock,
} from 'lucide-react';

export type PortalTimelineKind =
  | 'hearing'
  | 'meeting'
  | 'filing'
  | 'status_report'
  | 'court_record';

export interface PortalTimelineEvent {
  id: string;
  kind: PortalTimelineKind;
  /** ISO timestamp or YYYY-MM-DD; used for sorting + display. */
  date: string;
  /** Short label like "Filed: Motion to Dismiss" or "Hearing held". */
  headline: string;
  /** Optional secondary line (type, location, status). */
  subline: string;
  /** Future vs past — drives the "upcoming" highlight. */
  isUpcoming: boolean;
}

interface Props {
  events: PortalTimelineEvent[];
}

function formatDate(iso: string): string {
  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(iso);
  const d = new Date(isDateOnly ? `${iso}T00:00:00+08:00` : iso);
  return d.toLocaleDateString('en-PH', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'Asia/Manila',
  });
}

function formatTime(iso: string): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null; // date-only — no time to show
  const d = new Date(iso);
  return d.toLocaleTimeString('en-PH', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Manila',
  });
}

function formatMonthYear(iso: string): string {
  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(iso);
  const d = new Date(isDateOnly ? `${iso}T00:00:00+08:00` : iso);
  return d.toLocaleDateString('en-PH', {
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Manila',
  });
}

function monthKey(iso: string): string {
  // Anchor in Manila so events near midnight don't drift between months.
  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(iso);
  const d = new Date(isDateOnly ? `${iso}T00:00:00+08:00` : iso);
  const ym = d.toLocaleDateString('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
  });
  return ym; // "2026-05"
}

interface KindStyle {
  icon: typeof Gavel;
  label: string;
  /** Tinted icon-tile background + saturated icon color. */
  tile: string;
  iconText: string;
  /** Kind label chip (uppercase eyebrow above the headline). */
  chip: string;
  /** Thin left rail on the card so the eye can track entities at a glance. */
  rail: string;
}

const KIND: Record<PortalTimelineKind, KindStyle> = {
  hearing: {
    icon: Gavel,
    label: 'Hearing',
    tile: 'bg-red-50 dark:bg-red-500/12',
    iconText: 'text-red-700 dark:text-red-400',
    chip: 'text-red-700 dark:text-red-400',
    rail: 'before:bg-red-500/70 dark:before:bg-red-400/60',
  },
  meeting: {
    icon: Handshake,
    label: 'Meeting',
    tile: 'bg-navy-50 dark:bg-navy-500/15',
    iconText: 'text-navy-700 dark:text-navy-300',
    chip: 'text-navy-700 dark:text-navy-300',
    rail: 'before:bg-navy-500/70 dark:before:bg-navy-300/60',
  },
  filing: {
    icon: FolderOpen,
    label: 'Filing',
    tile: 'bg-teal-50 dark:bg-teal-500/12',
    iconText: 'text-teal-700 dark:text-teal-400',
    chip: 'text-teal-700 dark:text-teal-400',
    rail: 'before:bg-teal-500/70 dark:before:bg-teal-400/60',
  },
  status_report: {
    icon: ClipboardCheck,
    label: 'Status report',
    tile: 'bg-gold-50 dark:bg-gold-400/12',
    iconText: 'text-gold-700 dark:text-gold-400',
    chip: 'text-gold-700 dark:text-gold-400',
    rail: 'before:bg-gold-500/70 dark:before:bg-gold-400/60',
  },
  court_record: {
    icon: FileText,
    label: 'Court record',
    tile: 'bg-amber-50 dark:bg-amber-500/12',
    iconText: 'text-amber-700 dark:text-amber-400',
    chip: 'text-amber-700 dark:text-amber-400',
    rail: 'before:bg-amber-500/70 dark:before:bg-amber-400/60',
  },
};

export default function PortalTimeline({ events }: Props) {
  if (events.length === 0) {
    return (
      <div className="border border-[var(--border-color)] rounded-xl bg-card px-5 py-12 text-center">
        <Clock className="w-6 h-6 mx-auto text-[var(--text-muted)] mb-2" />
        <p className="text-sm text-[var(--text-secondary)]">
          The case timeline will populate as work progresses.
        </p>
      </div>
    );
  }

  // Reverse chronological — most recent first.
  const sorted = [...events].sort((a, b) => (a.date < b.date ? 1 : -1));

  // Group by month for serif headers.
  const groups = new Map<string, PortalTimelineEvent[]>();
  for (const ev of sorted) {
    const k = monthKey(ev.date);
    const arr = groups.get(k) ?? [];
    arr.push(ev);
    groups.set(k, arr);
  }

  return (
    <div className="relative">
      {/* Spine — center at left=15.5px */}
      <div className="absolute left-[15px] top-2 bottom-2 w-px bg-gold-200/60 dark:bg-gold-400/15" />

      <div className="space-y-8">
        {Array.from(groups.entries()).map(([k, evs]) => (
          <div key={k}>
            <h3 className="font-serif text-base text-foreground tracking-tight ml-10 mb-3">
              {formatMonthYear(evs[0].date)}
            </h3>
            <ul className="space-y-3">
              {evs.map((ev) => (
                <TimelineRow key={`${ev.kind}-${ev.id}`} event={ev} />
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

function TimelineRow({ event }: { event: PortalTimelineEvent }) {
  const cfg = KIND[event.kind];
  const Icon = cfg.icon;
  const time = formatTime(event.date);

  // Small outline dot in the kind color, sitting on the spine. Background
  // matches the page so the spine appears to pass behind it.
  const dotBorder: Record<PortalTimelineKind, string> = {
    hearing:       'border-red-500   dark:border-red-400',
    meeting:       'border-navy-500  dark:border-navy-300',
    filing:        'border-teal-500  dark:border-teal-400',
    status_report: 'border-gold-500  dark:border-gold-400',
    court_record:  'border-amber-500 dark:border-amber-400',
  };

  // Card has px-4 py-3 + an icon-tile of h-9 (36px) at items-center. Icon
  // center sits at: py-3 (12px) + 18px = 30px from card top, which equals
  // card_height/2 only when the card is exactly 60px tall. For multi-line
  // headlines the card grows, so we anchor the dot to py-3 + 18px = 30px from
  // li top — that tracks the icon, not the geometric center.
  return (
    <li className="relative pl-10">
      {/* Dot — sibling of the card so the card's overflow-hidden (which
          rounds the left-rail ::before) doesn't clip it. Top is fixed at
          (icon-tile-top + half-tile-height − half-dot-height) so it always
          aligns to the icon regardless of card height. */}
      <span
        className={`absolute left-[11px] top-[27.5px] w-[9px] h-[9px] rounded-full bg-[var(--background)] border-[1.5px] ${dotBorder[event.kind]} ${
          event.isUpcoming ? 'shadow-[0_0_0_3px_rgba(184,150,58,0.12)]' : ''
        }`}
      />
      <div
        className={`relative rounded-xl border overflow-hidden ${
          event.isUpcoming
            ? 'border-gold-200 dark:border-gold-400/30 bg-gold-50/40 dark:bg-gold-400/5'
            : 'border-[var(--border-color)] bg-card'
        } before:absolute before:left-0 before:top-0 before:bottom-0 before:w-[3px] ${cfg.rail}`}
      >
        <div className="flex items-center gap-3 px-4 py-3">
          <div
            className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${cfg.tile}`}
          >
            <Icon className={`w-[18px] h-[18px] ${cfg.iconText}`} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2 flex-wrap">
              <p className="text-sm font-medium text-foreground">{event.headline}</p>
              <span className={`text-[10px] font-semibold uppercase tracking-wider ${cfg.chip}`}>
                {cfg.label}
              </span>
              {event.isUpcoming && (
                <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-gold-500 dark:bg-gold-400 text-white dark:text-navy-900">
                  Upcoming
                </span>
              )}
            </div>
            <p className="text-xs text-[var(--text-secondary)] mt-0.5">
              {formatDate(event.date)}
              {time && <> · {time}</>}
              {event.subline && <> · {event.subline}</>}
            </p>
          </div>
        </div>
      </div>
    </li>
  );
}
