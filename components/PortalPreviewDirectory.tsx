'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Eye, ExternalLink, Search, Users, Building2 } from 'lucide-react';

export interface PreviewClientRow {
  id: string;
  name: string;
  fullCompanyName: string;
  clientCode: string;
  portalUserCount: number;
  status: string;
}

interface Props {
  rows: PreviewClientRow[];
  /**
   * Base path for the secondary "Client page" link, with the client id
   * appended (e.g. `/dashboard/clients` → `/dashboard/clients/{id}`).
   * Pass `null` to hide the link entirely — used by the admin surface,
   * which keeps admins out of the dashboard tree.
   */
  clientHrefBase?: string | null;
}

const STATUS_FILTERS = ['Active', 'Inactive', 'Prospective'] as const;
type StatusFilter = 'all' | (typeof STATUS_FILTERS)[number];

const STATUS_CHIP: Record<string, string> = {
  Active: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 ring-emerald-500/20',
  Inactive: 'bg-zinc-500/10 text-zinc-500 dark:text-zinc-400 ring-zinc-500/20',
  Prospective: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 ring-amber-500/20',
};

export default function PortalPreviewDirectory({ rows, clientHrefBase = '/dashboard/clients' }: Props) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>('Active');

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: rows.length };
    for (const r of rows) c[r.status] = (c[r.status] ?? 0) + 1;
    return c;
  }, [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (status !== 'all' && r.status !== status) return false;
      if (!q) return true;
      return (
        r.name.toLowerCase().includes(q) ||
        r.fullCompanyName.toLowerCase().includes(q) ||
        r.clientCode.toLowerCase().includes(q)
      );
    });
  }, [rows, query, status]);

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-4">
        <div className="relative max-w-sm w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search clients…"
            className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-gold-400 focus:ring-2 focus:ring-gold-400/20"
          />
        </div>

        <div className="flex items-center gap-1 rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] p-1 self-start">
          {(['all', ...STATUS_FILTERS] as StatusFilter[]).map((s) => {
            const isActive = status === s;
            return (
              <button
                key={s}
                type="button"
                onClick={() => setStatus(s)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                  isActive
                    ? 'bg-navy-600 text-white'
                    : 'text-[var(--text-secondary)] hover:text-foreground hover:bg-subtle'
                }`}
              >
                {s === 'all' ? 'All' : s}
                <span className={`ml-1.5 ${isActive ? 'text-white/70' : 'text-[var(--text-muted)]'}`}>
                  {counts[s] ?? 0}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <p className="text-xs text-[var(--text-muted)] mb-3">
        {filtered.length} {filtered.length === 1 ? 'client' : 'clients'}
      </p>

      {filtered.length === 0 ? (
        <div className="border border-[var(--border-color)] rounded-xl bg-[var(--card-bg)] p-10 text-center text-sm text-[var(--text-secondary)]">
          No clients match your filters.
        </div>
      ) : (
        <ul className="space-y-2">
          {filtered.map((c) => (
            <li
              key={c.id}
              className="flex items-center justify-between gap-4 border border-[var(--border-color)] rounded-xl bg-[var(--card-bg)] px-4 py-3"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-semibold text-[var(--text-primary)] truncate">{c.name}</p>
                  {c.clientCode && (
                    <span className="text-[10px] font-mono text-[var(--text-muted)]">{c.clientCode}</span>
                  )}
                  {c.status && (
                    <span
                      className={`inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded-full ring-1 ring-inset ${
                        STATUS_CHIP[c.status] ?? 'bg-zinc-500/10 text-zinc-500 ring-zinc-500/20'
                      }`}
                    >
                      {c.status}
                    </span>
                  )}
                  <span className="inline-flex items-center gap-1 text-[10px] text-[var(--text-muted)]">
                    <Users className="w-3 h-3" />
                    {c.portalUserCount > 0
                      ? `${c.portalUserCount} portal user${c.portalUserCount === 1 ? '' : 's'}`
                      : 'No portal users yet'}
                  </span>
                </div>
                {c.fullCompanyName && (
                  <p className="text-xs text-[var(--text-secondary)] truncate mt-0.5">{c.fullCompanyName}</p>
                )}
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {clientHrefBase && (
                  <Link
                    href={`${clientHrefBase}/${c.id}`}
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--text-secondary)] hover:text-foreground border border-[var(--border-color)] bg-[var(--card-bg)] hover:bg-subtle rounded-lg px-3 py-1.5 transition-all"
                  >
                    <Building2 className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Client page</span>
                  </Link>
                )}
                <Link
                  href={`/client-portal-preview/${c.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-white bg-navy-600 hover:bg-navy-700 rounded-lg px-3 py-1.5 transition-colors"
                >
                  <Eye className="w-3.5 h-3.5" />
                  Preview
                  <ExternalLink className="w-3 h-3 opacity-70" />
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
