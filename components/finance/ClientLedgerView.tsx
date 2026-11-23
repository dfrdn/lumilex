'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { ArrowLeft, Printer, Search, X, BookOpen } from 'lucide-react';
import type { ClientStatement, StatementLineKind } from '@/lib/finance/client-statement';
import { fmt, signed, formatManilaDate } from '@/lib/finance/format';
import MonthSelect from '@/components/finance/MonthSelect';

interface Props {
  clientName: string;
  statement: ClientStatement;
  found: boolean;
  asOfToday: string;
}

type TabKey = 'all' | 'billing' | 'payment' | 'deposit';

const TYPE_TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'billing', label: 'Billings' },
  { key: 'payment', label: 'Payments' },
  { key: 'deposit', label: 'Deposits' },
];

/** Map a statement line kind onto the coarse ledger tab groups. */
function tabOf(kind: StatementLineKind): TabKey | 'opening' {
  if (kind === 'opening') return 'opening';
  if (kind === 'invoice') return 'billing';
  if (kind === 'payment') return 'payment';
  return 'deposit'; // deposit | refund | adjustment
}

function KindBadge({ kind }: { kind: StatementLineKind }) {
  const map: Record<StatementLineKind, { label: string; classes: string }> = {
    opening: { label: 'Opening', classes: 'bg-stone-100 text-stone-600 dark:bg-stone-500/15 dark:text-stone-300' },
    invoice: { label: 'Billing', classes: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300' },
    payment: { label: 'Payment', classes: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300' },
    deposit: { label: 'Deposit', classes: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300' },
    refund: { label: 'Refund', classes: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300' },
    adjustment: { label: 'Adjustment', classes: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300' },
  };
  const b = map[kind];
  return (
    <span className={`inline-flex items-center px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded-md ${b.classes}`}>
      {b.label}
    </span>
  );
}

export default function ClientLedgerView({ clientName, statement, found, asOfToday }: Props) {
  const [type, setType] = useState<TabKey>('all');
  const [monthEnabled, setMonthEnabled] = useState(false);
  const [month, setMonth] = useState(() => asOfToday.slice(0, 7));
  const [search, setSearch] = useState('');

  const balance = statement.currentBalance;
  const isCredit = balance < -0.005;

  const lines = useMemo(() => {
    const q = search.trim().toLowerCase();
    return statement.lines.filter((l) => {
      const group = tabOf(l.kind);
      // Opening anchors the running balance — keep it visible only in the
      // unfiltered "All" view, where the column reads as a true account ledger.
      if (group === 'opening') return type === 'all' && !monthEnabled && !q;
      if (type !== 'all' && group !== type) return false;
      if (monthEnabled && !(l.date ?? '').startsWith(month)) return false;
      if (q && !l.label.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [statement.lines, type, monthEnabled, month, search]);

  const hasFilters = type !== 'all' || monthEnabled || !!search;

  return (
    <div>
      <div className="flex items-center justify-between mb-6 gap-4">
        <div>
          <Link
            href="/finance/receivables"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--text-secondary)] hover:text-foreground mb-2"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to receivables
          </Link>
          <h1 className="text-2xl font-semibold text-foreground font-[family-name:var(--font-playfair)] flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-[var(--text-muted)]" />
            {clientName}
          </h1>
          <p className="text-sm text-[var(--text-secondary)] mt-1">
            Account ledger — every billing, payment, and deposit with a running balance. As of {formatManilaDate(asOfToday)}.
          </p>
        </div>
        <Link
          href={`/finance/clients/${encodeURIComponent(clientName)}/statement`}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-foreground hover:bg-[var(--subtle-bg)] whitespace-nowrap"
        >
          <Printer className="w-3.5 h-3.5" />
          Printable statement
        </Link>
      </div>

      {/* Current balance */}
      <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] p-4 mb-4 shadow-[var(--shadow-card)] flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
          {isCredit ? 'Credit balance (advance held)' : 'Current balance'}
        </span>
        <span className={`text-xl font-semibold tabular-nums ${isCredit ? 'text-emerald-600 dark:text-emerald-400' : 'text-foreground'}`}>
          {signed(balance)}
        </span>
      </div>

      {/* Filters */}
      <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] p-4 mb-4 shadow-[var(--shadow-card)] space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-wider mb-1.5">Search</label>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-muted)]" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Invoice #, note…"
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
              onClick={() => { setType('all'); setMonthEnabled(false); setSearch(''); }}
              className="text-xs text-[var(--text-muted)] hover:text-foreground"
            >
              Clear filters
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      {!found ? (
        <div className="text-center py-12 text-[var(--text-muted)] text-sm">No record found for this client.</div>
      ) : lines.length === 0 ? (
        <div className="text-center py-12 text-[var(--text-muted)] text-sm">No ledger entries match these filters.</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[var(--border-color)] bg-card shadow-[var(--shadow-card)]">
          <table className="w-full border-collapse">
            <thead>
              <tr className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                <th className="text-left px-4 py-3 border-b border-[var(--border-color)]">Date</th>
                <th className="text-left px-3 py-3 border-b border-[var(--border-color)]">Type</th>
                <th className="text-left px-3 py-3 border-b border-[var(--border-color)]">Description</th>
                <th className="text-right px-3 py-3 border-b border-[var(--border-color)]">Charge / (Credit)</th>
                <th className="text-right px-4 py-3 border-b border-[var(--border-color)]">Balance</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.key} className="hover:bg-[var(--subtle-bg)] transition-colors align-top">
                  <td className="px-4 py-2.5 text-xs text-[var(--text-secondary)] border-b border-[var(--border-color)] whitespace-nowrap tabular-nums">
                    {line.date ? formatManilaDate(line.date) : '—'}
                  </td>
                  <td className="px-3 py-2.5 border-b border-[var(--border-color)] whitespace-nowrap"><KindBadge kind={line.kind} /></td>
                  <td className="px-3 py-2.5 text-sm text-[var(--text-secondary)] border-b border-[var(--border-color)]">{line.label}</td>
                  <td className={`px-3 py-2.5 text-sm text-right border-b border-[var(--border-color)] tabular-nums whitespace-nowrap ${
                    line.credit > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-foreground'
                  }`}>
                    {line.charge > 0 ? fmt(line.charge) : line.credit > 0 ? `(${fmt(line.credit)})` : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-sm font-semibold text-right border-b border-[var(--border-color)] tabular-nums whitespace-nowrap text-foreground">
                    {signed(line.runningBalance)}
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
