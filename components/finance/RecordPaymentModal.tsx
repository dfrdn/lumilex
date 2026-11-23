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
  paid_amount: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  invoice: Invoice | null;
  onRecorded: () => void;
  /** Available deposit balance for this client — enables the "Deposit" method. */
  depositBalance?: number;
}

function fmt(n: number) {
  return `₱${Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function RecordPaymentModal({ open, onClose, invoice, onRecorded, depositBalance = 0 }: Props) {
  const [amount, setAmount] = useState('');
  const [paymentDate, setPaymentDate] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('bank_transfer');
  const [referenceNumber, setReferenceNumber] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open && invoice) {
      setAmount(invoice.balance.toFixed(2));
      setPaymentDate(new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' }));
      setPaymentMethod('bank_transfer');
      setReferenceNumber('');
      setNotes('');
      setError('');
    }
  }, [open, invoice]);

  // When switching to "deposit", clamp the amount to the available deposit balance.
  useEffect(() => {
    if (paymentMethod === 'deposit' && invoice) {
      const cap = Math.min(invoice.balance, depositBalance);
      setAmount(cap > 0 ? cap.toFixed(2) : '0.00');
    }
  }, [paymentMethod, invoice, depositBalance]);

  const handleSave = async () => {
    if (!invoice || !amount || !paymentDate) return;
    setSaving(true);
    setError('');
    try {
      let res: Response;
      if (paymentMethod === 'deposit') {
        // Application from the client's advance deposit balance.
        res = await fetch('/api/finance/clients/deposits/apply', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            invoiceId: invoice.id,
            amount: parseFloat(amount),
            notes,
          }),
        });
      } else {
        res = await fetch('/api/finance/invoices', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            invoiceId: invoice.id,
            action: 'record_payment',
            amount: parseFloat(amount),
            paymentDate,
            paymentMethod,
            referenceNumber,
            notes,
          }),
        });
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to record payment');
      onRecorded();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to record payment');
    } finally {
      setSaving(false);
    }
  };

  if (!open || !invoice) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm animate-fade-in">
      <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] shadow-xl w-full max-w-md mx-4">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-color)]">
          <h2 className="text-sm font-semibold text-foreground">Record Payment</h2>
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
              <span className="text-[var(--text-muted)]">Total Due</span>
              <span className="font-medium text-foreground tabular-nums">{fmt(invoice.totalDue)}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-[var(--text-muted)]">Balance</span>
              <span className="font-semibold text-red-600 dark:text-red-400 tabular-nums">{fmt(invoice.balance)}</span>
            </div>
            {depositBalance > 0 && (
              <div className="flex justify-between text-xs">
                <span className="text-[var(--text-muted)]">Deposit available</span>
                <span className="font-medium text-indigo-600 dark:text-indigo-400 tabular-nums">{fmt(depositBalance)}</span>
              </div>
            )}
          </div>

          {/* Payment Fields */}
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
              <select
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
                className="w-full px-3 py-1.5 text-xs rounded-lg bg-[var(--background)] border border-[var(--border-color)] focus:outline-none focus:ring-1 focus:ring-emerald-300 dark:focus:ring-emerald-500/40"
              >
                <option value="bank_transfer">Bank Transfer</option>
                <option value="check">Check</option>
                <option value="cash">Cash</option>
                <option value="online">Online</option>
                {depositBalance > 0 && (
                  <option value="deposit">From Deposit (₱{depositBalance.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })})</option>
                )}
              </select>
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

          {paymentMethod === 'deposit' && (
            <div className="rounded-lg bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-200/60 dark:border-indigo-500/30 p-2.5 text-[11px] text-indigo-700 dark:text-indigo-400">
              This will deduct ₱{Number(amount || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} from {invoice.client_name}&apos;s advance deposit balance.
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
        </div>
      </div>
    </div>
  );
}
