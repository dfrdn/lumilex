'use client';

import { useState, useEffect, useMemo } from 'react';
import { X, Loader2, ArrowRight } from 'lucide-react';

interface OpenInvoice {
  id: number;
  invoice_number: string;
  billing_month: string;
  totalDue: number;
  balance: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  clientName: string | null;
  depositBalance: number;
  invoices: OpenInvoice[];
  onApplied: () => void;
}

function fmt(n: number) {
  return `₱${Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function ApplyDepositModal({
  open, onClose, clientName, depositBalance, invoices, onApplied,
}: Props) {
  const [invoiceId, setInvoiceId] = useState<number | null>(null);
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const selected = useMemo(
    () => invoices.find((i) => i.id === invoiceId) ?? null,
    [invoices, invoiceId],
  );

  useEffect(() => {
    if (open) {
      const first = invoices[0] ?? null;
      setInvoiceId(first?.id ?? null);
      const fill = first ? Math.min(first.balance, depositBalance) : 0;
      setAmount(fill > 0 ? fill.toFixed(2) : '');
      setNotes('');
      setError('');
    }
  }, [open, invoices, depositBalance]);

  // Whenever the selected invoice changes, auto-fill with min(balance, deposit).
  useEffect(() => {
    if (!open || !selected) return;
    const fill = Math.min(selected.balance, depositBalance);
    setAmount(fill > 0 ? fill.toFixed(2) : '');
  }, [open, selected, depositBalance]);

  const handleApply = async () => {
    if (!invoiceId || !amount) return;
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/finance/clients/deposits/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invoiceId,
          amount: parseFloat(amount),
          notes,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to apply');
      onApplied();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Apply failed');
    } finally {
      setSaving(false);
    }
  };

  if (!open || !clientName) return null;

  const amt = parseFloat(amount);
  const afterDeposit = Number.isFinite(amt) ? depositBalance - amt : depositBalance;
  const afterInvoiceBalance = selected && Number.isFinite(amt) ? selected.balance - amt : selected?.balance ?? 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm animate-fade-in">
      <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] shadow-xl w-full max-w-md mx-4">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-color)]">
          <h2 className="text-sm font-semibold text-foreground">Apply Deposit to Invoice</h2>
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
              <span className="text-[var(--text-muted)]">Deposit balance</span>
              <span className="font-medium text-emerald-600 dark:text-emerald-400 tabular-nums">{fmt(depositBalance)}</span>
            </div>
          </div>

          {invoices.length === 0 ? (
            <div className="rounded-lg bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 p-3 text-xs text-amber-700 dark:text-amber-400">
              No open invoices to apply the deposit to.
            </div>
          ) : (
            <>
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1">Invoice</label>
                <select
                  value={invoiceId ?? ''}
                  onChange={(e) => setInvoiceId(parseInt(e.target.value))}
                  className="w-full px-3 py-1.5 text-xs rounded-lg bg-[var(--background)] border border-[var(--border-color)] focus:outline-none focus:ring-1 focus:ring-emerald-300 dark:focus:ring-emerald-500/40"
                >
                  {invoices.map((inv) => (
                    <option key={inv.id} value={inv.id}>
                      {inv.invoice_number} · {inv.billing_month} · balance {fmt(inv.balance)}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Amount (₱)</label>
                  {selected && (
                    <button
                      type="button"
                      onClick={() => setAmount(Math.min(selected.balance, depositBalance).toFixed(2))}
                      className="text-[10px] font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 cursor-pointer"
                    >
                      Max applicable
                    </button>
                  )}
                </div>
                <input
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  step="0.01"
                  min="0"
                  className="w-full px-3 py-1.5 text-xs rounded-lg bg-[var(--background)] border border-[var(--border-color)] focus:outline-none focus:ring-1 focus:ring-emerald-300 dark:focus:ring-emerald-500/40"
                />
              </div>

              {selected && Number.isFinite(amt) && amt > 0 && (
                <div className="rounded-lg bg-emerald-50/50 dark:bg-emerald-500/5 border border-emerald-200/60 dark:border-emerald-500/20 p-3 text-[11px] text-foreground space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-[var(--text-muted)]">Invoice balance</span>
                    <span className="tabular-nums">{fmt(selected.balance)}</span>
                    <ArrowRight className="w-3 h-3 text-[var(--text-muted)]" />
                    <span className="font-medium tabular-nums">{fmt(Math.max(0, afterInvoiceBalance))}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[var(--text-muted)]">Deposit</span>
                    <span className="tabular-nums">{fmt(depositBalance)}</span>
                    <ArrowRight className="w-3 h-3 text-[var(--text-muted)]" />
                    <span className={`font-medium tabular-nums ${afterDeposit < 0 ? 'text-red-600 dark:text-red-400' : ''}`}>
                      {fmt(afterDeposit)}
                    </span>
                  </div>
                </div>
              )}

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
            </>
          )}

          {error && (
            <div className="rounded-lg bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 p-2.5 text-[11px] text-red-700 dark:text-red-400">
              {error}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 px-6 py-4 border-t border-[var(--border-color)]">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium rounded-lg bg-subtle text-[var(--text-secondary)] hover:bg-stone-100 dark:hover:bg-stone-800 border border-[var(--border-color)] cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleApply}
            disabled={saving || !invoiceId || !amount || parseFloat(amount) <= 0 || invoices.length === 0}
            className="px-4 py-2 text-xs font-medium rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-50 cursor-pointer"
          >
            {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Apply'}
          </button>
        </div>
      </div>
    </div>
  );
}
