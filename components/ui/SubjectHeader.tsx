'use client';

import Link from 'next/link';
import Avatar from '@/components/Avatar';
import { monogram } from './primitives';

export interface HeaderTeamMember {
  personId: string;
  name: string;
  initials: string;
  avatarUrl: string | null;
}

/**
 * The top of a company's or a mark's page: who it is, its lifecycle status,
 * the identifiers the firm quotes most, the client it is done for, and the
 * lawyers on its matters. `badge` replaces the monogram (a mark's logo).
 */
export default function SubjectHeader({
  title,
  monogramOf,
  badge,
  statusPill,
  meta,
  client,
  team,
  actions,
  below,
}: {
  title: React.ReactNode;
  /** The name the monogram is drawn from, when there is no `badge`. */
  monogramOf?: string;
  badge?: React.ReactNode;
  statusPill?: React.ReactNode;
  meta?: React.ReactNode;
  client?: { id: string; name: string } | null;
  team: HeaderTeamMember[];
  actions?: React.ReactNode;
  /** A line under the meta chips — a mark's classes. */
  below?: React.ReactNode;
}) {
  const shown = team.slice(0, 5);
  return (
    <header className="relative overflow-hidden rounded-2xl border border-stone-200 dark:border-white/10 bg-white dark:bg-card">
      <div className="absolute inset-x-0 top-0 h-16 bg-gradient-to-r from-navy-50 via-white to-gold-50 dark:from-navy-500/10 dark:via-transparent dark:to-gold-500/[0.05]" />
      <div className="relative px-5 pt-5 pb-4 flex flex-col sm:flex-row sm:items-start gap-4">
        {badge ?? (
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-navy-800 to-navy-950 text-gold-300 flex items-center justify-center font-serif text-lg tracking-wide shadow-sm ring-1 ring-gold-400/30 shrink-0">
            {monogram(monogramOf ?? '')}
          </div>
        )}

        <div className="flex-1 min-w-0">
          {/* Pill and team sit on the title's first line, however far the title wraps. */}
          <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
            {typeof title === 'string' ? (
              <h1 className="font-serif text-2xl text-stone-900 dark:text-stone-50 tracking-tight truncate">{title}</h1>
            ) : (
              title
            )}
            {statusPill && <div className="flex items-center h-8">{statusPill}</div>}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {meta}
            {client && (
              <Link
                href={`/dashboard/clients/${client.id}`}
                className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] text-navy-700 hover:bg-navy-50 dark:text-navy-300 dark:hover:bg-navy-500/10 transition-colors"
              >
                Client · {client.name}
              </Link>
            )}
          </div>
          {below && <div className="mt-2">{below}</div>}
        </div>

        <div className="flex items-center gap-4 sm:self-start sm:min-h-8">
          {team.length > 0 && (
            <div className="flex items-center gap-2" title={team.map((m) => m.name).join(', ')}>
              <span className="text-[11px] text-stone-500 dark:text-stone-400 hidden md:inline">Team</span>
              <div className="flex -space-x-2">
                {shown.map((m) => (
                  <Avatar
                    key={m.personId}
                    avatarUrl={m.avatarUrl}
                    initials={m.initials}
                    name={m.name}
                    size={28}
                    className="ring-2 ring-white dark:ring-[var(--card-bg)]"
                  />
                ))}
                {team.length > shown.length && (
                  <span className="w-7 h-7 rounded-full ring-2 ring-white dark:ring-[var(--card-bg)] bg-stone-100 dark:bg-white/10 text-[10px] font-medium text-stone-600 dark:text-stone-300 flex items-center justify-center">
                    +{team.length - shown.length}
                  </span>
                )}
              </div>
            </div>
          )}
          {actions}
        </div>
      </div>
    </header>
  );
}
