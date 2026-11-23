'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { Loader2, Search, X, BookOpen, Receipt, Banknote, Wallet, AlertTriangle, ArrowUpRight } from 'lucide-react';
import ClientCombobox from '@/components/finance/ClientCombobox';
import MonthSelect from '@/components/finance/MonthSelect';
import { manilaMonth } from '@/lib/dates';
import { formatDate } from '@/lib/format-date';
import useSWR from 'swr';

interface LedgerEntry {
  id: string;
  kind: 'billing' | 'payment' | 'deposit';
  subtype: string;
  date: string;
  clientName: string;
  description: string;
  reference: string | null;
  method: string | null;
  amount: number;
  recordedBy: string | null;
  runningBalance?: number;
}

interface LedgerResponse {
  entries: LedgerEntry[];
  totalCount: number;
  summary: { billed: number; paid: number; deposits: number };
  clients: string[];
  truncated?: boolean;
  openingBalance?: number | null;
  currentBalance?: number | null;
}

function fmt(n: number): string {
  const v = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(Math.abs(n));
  return n < 0 ? `−${v}` : v;
}

function currentMonthInPH(): string {
  return manilaMonth();
}

const TYPE_TABS: Array<{ key: 'all' | 'billing' | 'payment' | 'deposit'; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'billing', label: 'Billings' },
  { key: 'payment', label: 'Payments' },
  { key: 'deposit', label: 'Deposits' },
];

function KindBadge({ entry }: { entry: LedgerEntry }) {
  const map: Record<LedgerEntry['kind'], { label: string; classes: string }> = {
    billing: { label: 'Billing', classes: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300' },
    payment: { label: entry.subtype === 'deposit applied' ? 'Deposit applied' : 'Payment', classes: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300' },
    deposit: { label: entry.subtype.charAt(0).toUpperCase() + entry.subtype.slice(1), classes: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300' },
  };
  const b = map[entry.kind];
  return (
    <span className={`inline-flex items-center px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded-md ${b.classes}`}>
      {b.label}
    </span>
  );
}

export default function LedgerView() {
  const [client, setClient] = useState('');
  const [type, setType] = useState<'all' | 'billing' | 'payment' | 'deposit'>('all');
  const [monthEnabled, setMonthEnabled] = useState(false);
  const [month, setMonth] = useState(currentMonthInPH);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 250);
    return () => clearTimeout(t);
  }, [search]);

  const qs = new URLSearchParams();
  if (client) qs.set('client', client);
  if (type !== 'all') qs.set('type', type);
  if (monthEnabled) qs.set('month', month);
  if (debouncedSearch) qs.set('search', debouncedSearch);
  const { data: fetched, error: loadError, isLoading } = useSWR<LedgerResponse>(
    `/api/finance/ledger?${qs.toString()}`,
    async (url: string) => {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`Failed to load ledger (${r.status})`);
      return r.json();
    },
    { keepPreviousData: true },
  );
  const data = fetched ?? null;
  const loading = isLoading && !fetched;
  const error = loadError ? (loadError instanceof Error ? loadError.message : 'Failed to load ledger') : '';

  const clients = data?.clients ?? [];
  const entries = data?.entries ?? [];
  const hasFilters = !!client || type !== 'all' || monthEnabled || !!search;
  const showRunning = !!client;

  const summary = data?.summary;
  const net = useMemo(
    () => (summary ? summary.billed + summary.paid + summary.deposits : 0),
    [summary],
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-foreground font-[family-name:var(--font-playfair)] flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-[var(--text-muted)]" />
            Ledger
          </h1>
          <p className="text-sm text-[var(--text-secondary)] mt-1">
            Every billing, payment, and deposit across all clients.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {showRunning && (
            <Link
              href={`/finance/clients/${encodeURIComponent(client)}/ledger`}
              className="inline-flex items-center gap-1 text-xs font-medium text-gold-600 dark:text-gold-400 hover:underline"
            >
              Full account ledger
              <ArrowUpRight className="w-3.5 h-3.5" />
            </Link>
          )}
          {data && (
            <span className="text-xs text-[var(--text-muted)]">
              {data.totalCount} entr{data.totalCount === 1 ? 'y' : 'ies'}
              {entries.length < data.totalCount ? ` · showing ${entries.length}` : ''}
            </span>
          )}
        </div>
      </div>

      {/* Summary */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <SummaryCard icon={Receipt} label="Billed" value={summary.billed} tone="amber" />
          <SummaryCard icon={Banknote} label="Collected" value={summary.paid} tone="emerald" />
          <SummaryCard icon={Wallet} label="Deposits / adj." value={summary.deposits} tone="indigo" />
          <SummaryCard label="Net receivable impact" value={net} tone="neutral" />
        </div>
      )}

      {/* Filters */}
      <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] p-4 mb-4 shadow-[var(--shadow-card)] space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-wider mb-1.5">Client</label>
            <ClientCombobox clients={clients} value={client} onChange={setClient} />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-wider mb-1.5">Search</label>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-muted)]" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Invoice #, reference, note…"
                className="w-full pl-8 pr-7 py-2 text-sm rounded-lg bg-[var(--background)] border border-[var(--border-color)] text-foreground focus:outline-none focus:border-gold-400 focus:ring-1 focus:ring-gold-400/20 placeholder:text-[var(--text-muted)]"
              />
              {search && (
                <button type="button" onClick={() => setSearch('')} className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 rounded text-[var(--text-muted)] hover:text-foreground">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
          <div>
            <label className="block text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-wider mb-1.5">Month</label>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)] cursor-pointer select-none shrink-0">
                <input type="checkbox" checked={monthEnabled} onChange={(e) => setMonthEnabled(e.target.checked)} className="w-4 h-4 rounded border-[var(--border-color)] accent-gold-500" />
                Filter
              </label>
              <div className={monthEnabled ? 'flex-1' : 'flex-1 opacity-40 pointer-events-none'}>
                <MonthSelect value={month} onChange={setMonth} />
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2">
          <div className="flex gap-1 p-1 bg-[var(--subtle-bg)] rounded-lg w-fit">
            {TYPE_TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setType(t.key)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                  type === t.key ? 'bg-[var(--card-bg)] text-foreground shadow-sm' : 'text-[var(--text-muted)] hover:text-foreground'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          {hasFilters && (
            <button
              onClick={() => { setClient(''); setType('all'); setMonthEnabled(false); setSearch(''); }}
              className="text-xs text-[var(--text-muted)] hover:text-foreground"
            >
              Clear filters
            </button>
          )}
        </div>
      </div>

      {data?.truncated && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-amber-200 dark:border-amber-500/30 bg-amber-50/60 dark:bg-amber-500/5 px-4 py-2.5 text-xs text-amber-800 dark:text-amber-300">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          Showing the most recent entries only — there are more than this view can load at once. Filter by client or month to see the rest, and note the totals above cover just what&apos;s shown.
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-[var(--text-muted)]" />
        </div>
      ) : error ? (
        <div className="text-center py-12 text-red-600 dark:text-red-400 text-sm">{error}</div>
      ) : entries.length === 0 ? (
        <div className="text-center py-12 text-[var(--text-muted)] text-sm">No ledger entries match these filters.</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[var(--border-color)] bg-card shadow-[var(--shadow-card)]">
          <table className="w-full border-collapse">
            <thead>
              <tr className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                <th className="text-left px-4 py-3 border-b border-[var(--border-color)]">Date</th>
                <th className="text-left px-3 py-3 border-b border-[var(--border-color)]">Type</th>
                <th className="text-left px-3 py-3 border-b border-[var(--border-color)]">Client</th>
                <th className="text-left px-3 py-3 border-b border-[var(--border-color)]">Description</th>
                <th className="text-left px-3 py-3 border-b border-[var(--border-color)]">Method</th>
                <th className="text-right px-4 py-3 border-b border-[var(--border-color)]">Amount</th>
                {showRunning && <th className="text-right px-4 py-3 border-b border-[var(--border-color)]">Balance</th>}
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} className="hover:bg-[var(--subtle-bg)] transition-colors align-top">
                  <td className="px-4 py-2.5 text-xs text-[var(--text-secondary)] border-b border-[var(--border-color)] whitespace-nowrap tabular-nums">{e.date}</td>
                  <td className="px-3 py-2.5 border-b border-[var(--border-color)] whitespace-nowrap"><KindBadge entry={e} /></td>
                  <td className="px-3 py-2.5 text-sm text-foreground border-b border-[var(--border-color)]">{e.clientName}</td>
                  <td className="px-3 py-2.5 text-sm text-[var(--text-secondary)] border-b border-[var(--border-color)]">
                    {e.description}
                    {e.recordedBy && <span className="block text-[10px] text-[var(--text-muted)] mt-0.5">by {e.recordedBy}</span>}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-[var(--text-muted)] border-b border-[var(--border-color)] capitalize whitespace-nowrap">{e.method?.replace('_', ' ') ?? '—'}</td>
                  <td className={`px-4 py-2.5 text-sm font-medium text-right border-b border-[var(--border-color)] tabular-nums whitespace-nowrap ${
                    e.amount < 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-foreground'
                  }`}>
                    {fmt(e.amount)}
                  </td>
                  {showRunning && (
                    <td className="px-4 py-2.5 text-sm font-semibold text-right border-b border-[var(--border-color)] tabular-nums whitespace-nowrap text-foreground">
                      {typeof e.runningBalance === 'number' ? fmt(e.runningBalance) : '—'}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SummaryCard({
  icon: Icon, label, value, tone,
}: {
  icon?: typeof Receipt;
  label: string;
  value: number;
  tone: 'amber' | 'emerald' | 'indigo' | 'neutral';
}) {
  const toneClasses: Record<string, string> = {
    amber: 'text-amber-600 dark:text-amber-400',
    emerald: 'text-emerald-600 dark:text-emerald-400',
    indigo: 'text-indigo-600 dark:text-indigo-400',
    neutral: 'text-foreground',
  };
  return (
    <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] p-3.5 shadow-[var(--shadow-card)]">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1">
        {Icon && <Icon className="w-3.5 h-3.5" />}
        {label}
      </div>
      <p className={`text-lg font-semibold tabular-nums ${toneClasses[tone]}`}>{fmt(value)}</p>
    </div>
  );
}
