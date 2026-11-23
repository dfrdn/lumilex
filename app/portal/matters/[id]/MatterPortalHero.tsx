'use client';

import { Calendar, Gavel, Handshake, Users } from 'lucide-react';

export interface PortalTeamMember {
  personId: string;
  name: string;
  initials: string;
  position: string;
  avatarUrl: string | null;
}

export interface PortalNextEvent {
  kind: 'meeting' | 'hearing';
  name: string;
  date: string;       // ISO
  subline: string;    // type · location (meeting) | type · status (hearing)
}

interface Props {
  team: PortalTeamMember[];
  next: PortalNextEvent | null;
}

function formatDateLong(iso: string): string {
  return new Date(iso).toLocaleDateString('en-PH', {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'Asia/Manila',
  });
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-PH', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Manila',
  });
}

/** Whole-day countdown in Asia/Manila so "tomorrow" matches the client's calendar, not UTC. */
function daysUntil(iso: string): number {
  const tz = 'Asia/Manila';
  const target = new Date(iso);
  const now = new Date();
  // Use locale-formatted YYYY-MM-DD to anchor to Manila day boundaries.
  const fmt = (d: Date) =>
    d.toLocaleDateString('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
  const t = new Date(`${fmt(target)}T00:00:00+08:00`).getTime();
  const n = new Date(`${fmt(now)}T00:00:00+08:00`).getTime();
  return Math.round((t - n) / (1000 * 60 * 60 * 24));
}

function countdownLabel(iso: string): string {
  const days = daysUntil(iso);
  if (days < 0) return `${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} ago`;
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days < 7) return `In ${days} days`;
  if (days < 14) return 'Next week';
  if (days < 30) return `In ${Math.round(days / 7)} weeks`;
  if (days < 365) return `In ${Math.round(days / 30)} ${Math.round(days / 30) === 1 ? 'month' : 'months'}`;
  return `In ${Math.round(days / 365)} year${Math.round(days / 365) === 1 ? '' : 's'}`;
}

function isImminent(iso: string): boolean {
  const days = daysUntil(iso);
  return days >= 0 && days <= 7;
}

export default function MatterPortalHero({ team, next }: Props) {
  if (team.length === 0 && !next) return null;

  return (
    <section className="mt-6 grid gap-4 md:grid-cols-2">
      {team.length > 0 && <YourTeamCard team={team} />}
      {next && <OnTheHorizonCard event={next} />}
    </section>
  );
}

// ── Your legal team ─────────────────────────────────────────────────────

function YourTeamCard({ team }: { team: PortalTeamMember[] }) {
  return (
    <div className="border border-[var(--border-color)] rounded-2xl bg-card p-5">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] flex items-center gap-1.5 mb-4">
        <Users className="w-3.5 h-3.5" />
        Your legal team
      </h2>
      <ul className="space-y-3">
        {team.map((m) => (
          <li key={m.personId} className="flex items-center gap-3">
            <Avatar member={m} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground truncate">{m.name}</p>
              {m.position && (
                <p className="text-[11px] text-[var(--text-muted)] truncate">{m.position}</p>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Avatar({ member }: { member: PortalTeamMember }) {
  if (member.avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={member.avatarUrl}
        alt={member.name}
        className="w-9 h-9 rounded-full object-cover shrink-0 border border-[var(--border-color)]"
      />
    );
  }
  return (
    <div className="w-9 h-9 rounded-full bg-navy-100 dark:bg-navy-500/15 text-navy-700 dark:text-navy-300 flex items-center justify-center text-[11px] font-semibold shrink-0">
      {member.initials || '??'}
    </div>
  );
}

// ── On the horizon ──────────────────────────────────────────────────────

function OnTheHorizonCard({ event }: { event: PortalNextEvent }) {
  const Icon = event.kind === 'hearing' ? Gavel : Handshake;
  const imminent = isImminent(event.date);

  return (
    <div
      className={`border rounded-2xl p-5 ${
        imminent
          ? 'border-gold-200 dark:border-gold-400/30 bg-gold-50/40 dark:bg-gold-400/5'
          : 'border-[var(--border-color)] bg-card'
      }`}
    >
      <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] flex items-center gap-1.5 mb-4">
        <Calendar className="w-3.5 h-3.5" />
        On the horizon
      </h2>
      <div className="flex items-start gap-3">
        <div
          className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
            imminent ? 'bg-gold-100 dark:bg-gold-400/10' : 'bg-subtle'
          }`}
        >
          <Icon className="w-5 h-5 text-[var(--text-secondary)]" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span
              className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                imminent
                  ? 'bg-gold-500 dark:bg-gold-400 text-white dark:text-navy-900'
                  : 'bg-subtle text-[var(--text-secondary)]'
              }`}
            >
              {countdownLabel(event.date)}
            </span>
            <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
              {event.kind === 'hearing' ? 'Hearing' : 'Meeting'}
            </span>
          </div>
          <p className="text-sm font-medium text-foreground truncate">{event.name}</p>
          <p className="text-xs text-[var(--text-secondary)] mt-0.5">
            {formatDateLong(event.date)} · {formatTime(event.date)}
          </p>
          {event.subline && (
            <p className="text-xs text-[var(--text-muted)] mt-0.5 truncate">{event.subline}</p>
          )}
        </div>
      </div>
    </div>
  );
}
