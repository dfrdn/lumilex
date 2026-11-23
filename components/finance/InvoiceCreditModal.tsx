'use client';

import { useState, useEffect } from 'react';
import { X, Loader2 } from 'lucide-react';
import DatePickerInput from '@/components/DatePickerInput';

interface Invoice {
  id: number;
  invoice_number: string;
  client_name: string;
  totalDue: number;
  balance: number;
}

interface Credit {
  id: number;
  amount: number;
  payment_date: string;
  notes: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  invoice: Invoice | null;
  /** Existing credits on this invoice (invoice_payments rows, method 'credit'). */
  credits: Credit[];
  onSaved: () => void;
}

function fmt(n: number) {
  return `₱${Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Record a post-send discount/credit against a specific invoice. The credit
 * settles part of the receivable through the invoice's paid_amount (so it
 * reduces the open balance on every AR surface) without being counted as
 * collected cash. Reversible per entry.
 */
export default function InvoiceCreditModal({ open, onClose, invoice, credits, onSaved }: Props) {
  const [amount, setAmount] = useState('');
  const [creditDate, setCreditDate] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [reversingId, setReversingId] = useState<number | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open && invoice) {
      setAmount('');
      setCreditDate(new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' }));
      setReason('');
      setError('');
    }
  }, [open, invoice]);

  const handleSave = async () => {
    if (!invoice) return;
    const amt = parseFloat(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      setError('Enter a credit amount greater than zero.');
      return;
    }
    if (amt > invoice.balance + 0.01) {
      setError(`Credit can't exceed the outstanding balance (${fmt(invoice.balance)}).`);
      return;
    }
    if (!creditDate) {
      setError('Pick a date.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/finance/invoices', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invoiceId: invoice.id,
          action: 'record_credit',
          amount: amt,
          creditDate,
          reason,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to record credit');
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to record credit');
    } finally {
      setSaving(false);
    }
  };

  const handleReverse = async (creditId: number) => {
    if (!invoice) return;
    setReversingId(creditId);
    setError('');
    try {
      const res = await fetch('/api/finance/invoices', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoiceId: invoice.id, action: 'reverse_credit', creditId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to reverse credit');
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reverse credit');
    } finally {
      setReversingId(null);
    }
  };

  if (!open || !invoice) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm animate-fade-in">
      <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] shadow-xl w-full max-w-md mx-4">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-color)]">
          <h2 className="text-sm font-semibold text-foreground">Discount / Credit</h2>
          <button type="button" onClick={onClose} className="p-1 rounded-lg hover:bg-subtle cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {/* Invoice Info */}
          <div className="bg-subtle rounded-lg p-3 space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-[var(--text-muted)]">Invoice</span>
              <span className="font-medium text-foreground">{invoice.invoice_number}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-[var(--text-muted)]">Client</span>
              <span className="text-[var(--text-secondary)]">{invoice.client_name}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-[var(--text-muted)]">Outstanding</span>
              <span className="font-semibold text-red-600 dark:text-red-400 tabular-nums">{fmt(invoice.balance)}</span>
            </div>
          </div>

          <p className="text-[11px] text-[var(--text-muted)]">
            Reduces this invoice&apos;s outstanding balance. It is <span className="font-medium">not</span> counted as cash collected.
          </p>

          {/* Credit Fields */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1">Amount</label>
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                step="0.01"
                placeholder="0.00"
                className="w-full px-3 py-1.5 text-xs rounded-lg bg-[var(--background)] border border-[var(--border-color)] focus:outline-none focus:ring-1 focus:ring-gold-300 dark:focus:ring-gold-500/40"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1">Date</label>
              <DatePickerInput
                variant="compact"
                value={creditDate || null}
                onChange={(v) => setCreditDate(v ?? '')}
                placeholder="Pick a date"
              />
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1">Reason</label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Goodwill discount, billing adjustment"
              className="w-full px-3 py-1.5 text-xs rounded-lg bg-[var(--background)] border border-[var(--border-color)] focus:outline-none focus:ring-1 focus:ring-gold-300 dark:focus:ring-gold-500/40"
            />
          </div>

          {/* Existing credits */}
          {credits.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1.5">Credits on this invoice</p>
              <ul className="space-y-1">
                {credits.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-3 text-[11px] rounded-md border border-[var(--border-color)] bg-[var(--subtle-bg)] px-2.5 py-1.5">
                    <div className="min-w-0">
                      <span className="font-medium text-foreground tabular-nums">{fmt(Number(c.amount))}</span>
                      <span className="ml-2 text-[var(--text-muted)]">{c.payment_date}</span>
                      {c.notes && <span className="ml-2 text-[var(--text-muted)] truncate">— {c.notes}</span>}
                    </div>
                    <button
                      type="button"
                      onClick={() => handleReverse(c.id)}
                      disabled={reversingId === c.id}
                      className="shrink-0 text-[10px] text-red-600 dark:text-red-400 hover:underline disabled:opacity-50 cursor-pointer"
                    >
                      {reversingId === c.id ? 'Reversing…' : 'Reverse'}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
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
            Close
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !amount || !creditDate}
            className="px-4 py-2 text-xs font-medium rounded-lg bg-gold-500 text-white hover:bg-gold-600 disabled:opacity-50 cursor-pointer"
          >
            {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Record Credit'}
          </button>
        </div>
      </div>
    </div>
  );
}
