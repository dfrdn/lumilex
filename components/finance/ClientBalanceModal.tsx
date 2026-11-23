'use client';

import { useState, useEffect } from 'react';
import { X, Loader2 } from 'lucide-react';
import DatePickerInput from '@/components/DatePickerInput';
import { manilaToday } from '@/lib/finance/format';

interface Props {
  open: boolean;
  onClose: () => void;
  clientName: string | null;
  currentBalance: number | null;
  currentNote: string | null;
  currentAsOf?: string | null;
  computedBalance: number;
  onSaved: () => void;
}

function fmt(n: number) {
  return `₱${Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function ClientBalanceModal({
  open, onClose, clientName, currentBalance, currentNote, currentAsOf, computedBalance, onSaved,
}: Props) {
  const [balance, setBalance] = useState('');
  const [note, setNote] = useState('');
  const [asOf, setAsOf] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setBalance(currentBalance === null || currentBalance === undefined ? '' : String(currentBalance));
      setNote(currentNote ?? '');
      setAsOf(currentAsOf ?? manilaToday());
      setError('');
    }
  }, [open, currentBalance, currentNote, currentAsOf]);

  const handleSave = async () => {
    if (!clientName) return;
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/finance/clients/balance', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientName,
          balance: balance === '' ? null : parseFloat(balance),
          note: note || null,
          asOf: balance === '' ? null : asOf,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save');
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleUseComputed = () => {
    setBalance(computedBalance.toFixed(2));
  };

  const handleClear = () => {
    setBalance('');
    setNote('');
    setAsOf(manilaToday());
  };

  if (!open || !clientName) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm animate-fade-in">
      <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] shadow-xl w-full max-w-md mx-4">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-color)]">
          <h2 className="text-sm font-semibold text-foreground">Outstanding Balance</h2>
          <button type="button" onClick={onClose} className="p-1 rounded-lg hover:bg-subtle cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div className="bg-subtle rounded-lg p-3 space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-[var(--text-muted)]">Client</span>
              <span className="font-medium text-foreground">{clientName}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-[var(--text-muted)]">Computed (open invoices)</span>
              <span className="font-medium text-foreground tabular-nums">{fmt(computedBalance)}</span>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Running Balance (₱)</label>
              <button
                type="button"
                onClick={handleUseComputed}
                className="text-[10px] font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 cursor-pointer"
              >
                Use computed
              </button>
            </div>
            <input
              type="number"
              value={balance}
              onChange={(e) => setBalance(e.target.value)}
              step="0.01"
              placeholder="Leave blank for none"
              className="w-full px-3 py-1.5 text-xs rounded-lg bg-[var(--background)] border border-[var(--border-color)] focus:outline-none focus:ring-1 focus:ring-emerald-300 dark:focus:ring-emerald-500/40"
            />
            <p className="text-[10px] text-[var(--text-muted)] mt-1">
              Positive = client owes the firm (carried over as &quot;Previous Balance&quot; on the next invoice).
              Negative = firm owes the client (advance deposit; rendered as a &quot;Remaining Balance&quot; credit above legal fees).
            </p>
          </div>

          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1">Balance as of</label>
            <DatePickerInput variant="compact" value={asOf} onChange={setAsOf} placeholder="Select date" />
            <p className="text-[10px] text-[var(--text-muted)] mt-1">
              Only billed into invoices whose period ends on or after this date — e.g. an April balance
              appears on April&apos;s invoice and later, not on an earlier month&apos;s.
            </p>
          </div>

          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1">Note</label>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Optional — e.g. partial payment received via wire"
              className="w-full px-3 py-1.5 text-xs rounded-lg bg-[var(--background)] border border-[var(--border-color)] focus:outline-none focus:ring-1 focus:ring-emerald-300 dark:focus:ring-emerald-500/40"
            />
          </div>

          {error && (
            <div className="rounded-lg bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 p-2.5 text-[11px] text-red-700 dark:text-red-400">
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 px-6 py-4 border-t border-[var(--border-color)]">
          <button
            type="button"
            onClick={handleClear}
            className="text-[11px] text-[var(--text-muted)] hover:text-foreground cursor-pointer"
          >
            Clear
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium rounded-lg bg-subtle text-[var(--text-secondary)] hover:bg-stone-100 dark:hover:bg-stone-800 border border-[var(--border-color)] cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 text-xs font-medium rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-50 cursor-pointer"
            >
              {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
