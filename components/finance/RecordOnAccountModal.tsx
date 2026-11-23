'use client';

import { useState, useEffect } from 'react';
import { X, Loader2, CheckCircle } from 'lucide-react';
import DatePickerInput from '@/components/DatePickerInput';
import SingleSelect from '@/components/finance/SingleSelect';
import { manilaToday } from '@/lib/finance/format';

interface Props {
  open: boolean;
  onClose: () => void;
  clientName: string | null;
  /** Current running balance — prefills the amount and frames the payment. */
  currentBalance: number;
  onRecorded: () => void;
}

interface Allocation {
  target: string;
  amount: number;
  fullyPaid?: boolean;
}

const METHOD_OPTIONS = [
  { id: 'bank_transfer', label: 'Bank Transfer' },
  { id: 'check', label: 'Check' },
  { id: 'cash', label: 'Cash' },
  { id: 'online', label: 'Online' },
];

function fmt(n: number) {
  return `₱${Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function RecordOnAccountModal({ open, onClose, clientName, currentBalance, onRecorded }: Props) {
  const [amount, setAmount] = useState('');
  const [paymentDate, setPaymentDate] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('bank_transfer');
  const [referenceNumber, setReferenceNumber] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ allocations: Allocation[]; surplus: number } | null>(null);

  useEffect(() => {
    if (open) {
      setAmount(currentBalance > 0 ? currentBalance.toFixed(2) : '');
      setPaymentDate(manilaToday());
      setPaymentMethod('bank_transfer');
      setReferenceNumber('');
      setNotes('');
      setError('');
      setResult(null);
    }
  }, [open, currentBalance]);

  const handleSave = async () => {
    if (!clientName || !amount || !paymentDate) return;
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/finance/clients/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientName,
          amount: parseFloat(amount),
          paymentDate,
          paymentMethod,
          referenceNumber,
          notes,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to record payment');
      onRecorded();
      setResult({ allocations: data.allocations ?? [], surplus: data.surplus ?? 0 });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to record payment');
    } finally {
      setSaving(false);
    }
  };

  if (!open || !clientName) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm animate-fade-in">
      <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] shadow-xl w-full max-w-md mx-4">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-color)]">
          <h2 className="text-sm font-semibold text-foreground">Record Payment (On Account)</h2>
          <button type="button" onClick={onClose} className="p-1 rounded-lg hover:bg-subtle cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        {result ? (
          <div className="px-6 py-5 space-y-4">
            <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
              <CheckCircle className="w-4 h-4" />
              <span className="text-sm font-medium">Payment recorded</span>
            </div>
            <div className="bg-subtle rounded-lg p-3 space-y-1.5">
              {result.allocations.map((a, i) => (
                <div key={i} className="flex justify-between text-xs">
                  <span className="text-[var(--text-secondary)]">
                    {a.target}
                    {a.fullyPaid ? <span className="text-emerald-600 dark:text-emerald-400 ml-1">(paid in full)</span> : null}
                  </span>
                  <span className="font-medium text-foreground tabular-nums">{fmt(a.amount)}</span>
                </div>
              ))}
              {result.allocations.length === 0 && (
                <div className="text-xs text-[var(--text-muted)]">No open balance to apply against.</div>
              )}
            </div>
          </div>
        ) : (
          <div className="px-6 py-5 space-y-4">
            <div className="bg-subtle rounded-lg p-3 space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-[var(--text-muted)]">Client</span>
                <span className="font-medium text-foreground">{clientName}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-[var(--text-muted)]">Current balance</span>
                <span className="font-semibold text-foreground tabular-nums">{fmt(currentBalance)}</span>
              </div>
            </div>

            <div className="rounded-lg bg-blue-50 dark:bg-blue-500/10 border border-blue-200/60 dark:border-blue-500/30 p-2.5 text-[11px] text-blue-700 dark:text-blue-400">
              Applied oldest-first: the brought-forward opening balance, then outstanding invoices in order. Any surplus becomes an advance deposit credit.
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1">Amount</label>
                <input
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  step="0.01"
                  className="w-full px-3 py-1.5 text-xs rounded-lg bg-[var(--background)] border border-[var(--border-color)] focus:outline-none focus:ring-1 focus:ring-emerald-300 dark:focus:ring-emerald-500/40"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1">Date</label>
                <DatePickerInput
                  variant="compact"
                  value={paymentDate || null}
                  onChange={(v) => setPaymentDate(v ?? '')}
                  placeholder="Pick a date"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1">Method</label>
                <SingleSelect
                  value={paymentMethod}
                  options={METHOD_OPTIONS}
                  placeholder="Method"
                  onChange={(id) => setPaymentMethod(id ?? 'bank_transfer')}
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1">Reference #</label>
                <input
                  type="text"
                  value={referenceNumber}
                  onChange={(e) => setReferenceNumber(e.target.value)}
                  placeholder="Optional"
                  className="w-full px-3 py-1.5 text-xs rounded-lg bg-[var(--background)] border border-[var(--border-color)] focus:outline-none focus:ring-1 focus:ring-emerald-300 dark:focus:ring-emerald-500/40"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1">Notes</label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional"
                className="w-full px-3 py-1.5 text-xs rounded-lg bg-[var(--background)] border border-[var(--border-color)] focus:outline-none focus:ring-1 focus:ring-emerald-300 dark:focus:ring-emerald-500/40"
              />
            </div>

            {error && (
              <div className="rounded-lg bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 p-2.5 text-[11px] text-red-700 dark:text-red-400">
                {error}
              </div>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2 px-6 py-4 border-t border-[var(--border-color)]">
          {result ? (
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 cursor-pointer"
            >
              Done
            </button>
          ) : (
            <>
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
                disabled={saving || !amount || !paymentDate}
                className="px-4 py-2 text-xs font-medium rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-50 cursor-pointer"
              >
                {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Record Payment'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
