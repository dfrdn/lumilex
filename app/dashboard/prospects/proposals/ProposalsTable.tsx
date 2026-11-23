'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { FileText, Search } from 'lucide-react';
import type { ProposalStatus } from '@/lib/engagement-proposal/types';

export interface ProposalListRow {
  id: string;
  /** Null when the proposal was raised against an existing client directly. */
  intakeId: number | null;
  version: number;
  status: ProposalStatus;
  clientName: string;
  subject: string;
  arrangement: string | null;
  tierLabel: string | null;
  monthlyFee: number | null;
  /** Latest version in this proposal's thread — earlier ones are history. */
  isLatest: boolean;
  createdAt: string;
  updatedAt: string;
}

const STATUS_STYLES: Record<ProposalStatus, string> = {
  draft: 'bg-stone-100 text-stone-600 dark:bg-white/10 dark:text-stone-300',
  sent: 'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',
  accepted: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  declined: 'bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-300',
  superseded: 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400',
};

const FILTERS: { id: 'all' | ProposalStatus; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'draft', label: 'Drafts' },
  { id: 'sent', label: 'Sent' },
  { id: 'accepted', label: 'Accepted' },
  { id: 'declined', label: 'Declined' },
  { id: 'superseded', label: 'Superseded' },
];

const ARRANGEMENT_LABELS: Record<string, string> = {
  retainer: 'Retainer',
  hourly: 'Hourly',
  acceptance_completion: 'Acceptance + completion',
  fixed: 'Fixed fee',
  custom: 'Custom',
};

function dateLabel(iso: string): string {
  return new Date(iso).toLocaleDateString('en-PH', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Manila',
  });
}

function feeLabel(row: ProposalListRow): string {
  const arrangement = row.arrangement ? ARRANGEMENT_LABELS[row.arrangement] ?? row.arrangement : '—';
  const parts = [arrangement];
  if (row.tierLabel) parts.push(row.tierLabel);
  if (row.monthlyFee != null) {
    parts.push(`P${row.monthlyFee.toLocaleString('en-PH', { minimumFractionDigits: 2 })}/mo`);
  }
  return parts.join(' · ');
}

export default function ProposalsTable({ rows }: { rows: ProposalListRow[] }) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'all' | ProposalStatus>('all');
  // Superseded drafts pile up fast; the current version is what a partner wants.
  const [latestOnly, setLatestOnly] = useState(true);

  const counts = useMemo(() => {
    const out: Record<string, number> = { all: rows.length };
    for (const r of rows) out[r.status] = (out[r.status] ?? 0) + 1;
    return out;
  }, [rows]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (latestOnly && !r.isLatest) return false;
      if (status !== 'all' && r.status !== status) return false;
      if (!q) return true;
      return r.clientName.toLowerCase().includes(q) || r.subject.toLowerCase().includes(q);
    });
  }, [rows, query, status, latestOnly]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[14rem]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-muted)] pointer-events-none" />
          <input
            className="w-full pl-8 pr-3 py-1.5 text-sm rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-navy-500/30"
            placeholder="Search by client or subject"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setStatus(f.id)}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                status === f.id
                  ? 'bg-navy-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                  : 'border border-[var(--border-color)] text-[var(--text-muted)] hover:bg-[var(--bg-hover)]'
              }`}
            >
              {f.label}
              {counts[f.id] != null && <span className="ml-1 opacity-60">{counts[f.id]}</span>}
            </button>
          ))}
        </div>
        <label className="inline-flex items-center gap-1.5 text-xs text-[var(--text-muted)] cursor-pointer">
          <input type="checkbox" checked={latestOnly} onChange={(e) => setLatestOnly(e.target.checked)} />
          Latest version only
        </label>
      </div>

      {visible.length === 0 ? (
        <div className="rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] px-4 py-12 text-center">
          <FileText className="w-5 h-5 mx-auto text-[var(--text-muted)] mb-2" />
          <p className="text-sm text-[var(--text-muted)]">
            {rows.length === 0
              ? 'No engagement proposals have been drafted yet. Use New proposal to draft the first one.'
              : 'No proposals match this filter.'}
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border-color)] text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                <th className="text-left font-medium px-4 py-2.5">Client</th>
                <th className="text-left font-medium px-4 py-2.5 hidden lg:table-cell">Arrangement</th>
                <th className="text-left font-medium px-4 py-2.5">Status</th>
                <th className="text-right font-medium px-4 py-2.5">Ver.</th>
                <th className="text-right font-medium px-4 py-2.5 hidden sm:table-cell">Updated</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr key={r.id} className="border-b border-[var(--border-color)] last:border-0 hover:bg-[var(--bg-hover)]">
                  <td className="px-4 py-2.5">
                    <Link
                      href={`/dashboard/prospects/proposals/${r.id}`}
                      className="block text-[var(--text-primary)] hover:underline"
                    >
                      <span className="font-medium">{r.clientName}</span>
                      {r.intakeId == null && (
                        <span className="ml-1.5 text-[10px] text-[var(--text-muted)] align-middle">existing client</span>
                      )}
                      <span className="block text-xs text-[var(--text-muted)] truncate max-w-md">{r.subject}</span>
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-[var(--text-muted)] hidden lg:table-cell">{feeLabel(r)}</td>
                  <td className="px-4 py-2.5">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-medium capitalize ${STATUS_STYLES[r.status]}`}>
                      {r.status}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right text-xs text-[var(--text-muted)] tabular-nums">{r.version}</td>
                  <td className="px-4 py-2.5 text-right text-xs text-[var(--text-muted)] hidden sm:table-cell whitespace-nowrap">
                    {dateLabel(r.updatedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
