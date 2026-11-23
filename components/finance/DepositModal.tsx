'use client';

import { useState, useEffect } from 'react';
import { X, Loader2, Wallet } from 'lucide-react';
import DatePickerInput from '@/components/DatePickerInput';
import ClientCombobox from './ClientCombobox';
import { manilaToday } from '@/lib/finance/format';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Pre-fill the client (used when launched from a row in the receivables table). */
  clientName?: string | null;
  /** Optional list of all client names for the combobox fallback. */
  clients?: string[];
  /** Current deposit balance shown for context. */
  currentBalance?: number;
  /** When set, the modal edits this existing ledger entry instead of creating one. */
  editEntry?: {
    id: number;
    type: string;
    amount: number; // signed
    transaction_date: string;
    payment_method: string;
    reference_number: string;
    notes: string;
  } | null;
  onSaved: () => void;
}

type Kind = 'deposit' | 'refund' | 'adjustment';

function fmt(n: number) {
  return `₱${Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function DepositModal({
  open, onClose, clientName, clients = [], currentBalance = 0, editEntry, onSaved,
}: Props) {
  const isEdit = !!editEntry;
  const [type, setType] = useState<Kind>('deposit');
  const [client, setClient] = useState('');
  const [amount, setAmount] = useState('');
  const [transactionDate, setTransactionDate] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('bank_transfer');
  const [referenceNumber, setReferenceNumber] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    if (editEntry) {
      setType((['deposit', 'refund', 'adjustment'].includes(editEntry.type) ? editEntry.type : 'adjustment') as Kind);
      setClient(clientName ?? '');
      // adjustments carry their own sign; deposit/refund edit as a magnitude.
      setAmount(String(editEntry.type === 'adjustment' ? editEntry.amount : Math.abs(editEntry.amount)));
      setTransactionDate(editEntry.transaction_date ?? manilaToday());
      setPaymentMethod(editEntry.payment_method || 'bank_transfer');
      setReferenceNumber(editEntry.reference_number ?? '');
      setNotes(editEntry.notes ?? '');
    } else {
      setType('deposit');
      setClient(clientName ?? '');
      setAmount('');
      setTransactionDate(manilaToday());
      setPaymentMethod('bank_transfer');
      setReferenceNumber('');
      setNotes('');
    }
    setError('');
  }, [open, clientName, editEntry]);

  const handleSave = async () => {
    if (!client || !amount) return;
    const parsed = parseFloat(amount);
    if (!Number.isFinite(parsed) || parsed === 0) {
      setError('Enter a non-zero amount');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const payload = {
        type,
        amount: Math.abs(parsed),
        // adjustments may be negative — carry the explicit sign.
        signedAmount: type === 'adjustment' ? parsed : undefined,
        transactionDate,
        paymentMethod: type === 'adjustment' ? '' : paymentMethod,
        referenceNumber,
        notes,
      };
      const res = await fetch('/api/finance/clients/deposits', {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isEdit ? { id: editEntry!.id, ...payload } : { clientName: client, ...payload }),
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

  if (!open) return null;

  const heading = isEdit
    ? 'Edit Ledger Entry'
    : type === 'deposit'
      ? 'Record Advance Deposit'
      : type === 'refund'
        ? 'Refund Deposit'
        : 'Adjust Deposit Balance';

  const ctaLabel = isEdit
    ? 'Save Changes'
    : type === 'deposit'
      ? 'Record Deposit'
      : type === 'refund'
        ? 'Refund'
        : 'Save Adjustment';

  const newBalance = (() => {
    const amt = parseFloat(amount);
    if (!Number.isFinite(amt)) return currentBalance;
    const newSigned = type === 'deposit' ? Math.abs(amt) : type === 'refund' ? -Math.abs(amt) : amt;
    // In edit mode the current balance already includes the old amount.
    const oldSigned = editEntry ? editEntry.amount : 0;
    return currentBalance - oldSigned + newSigned;
  })();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm animate-fade-in">
      <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] shadow-xl w-full max-w-md mx-4">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-color)]">
          <div className="flex items-center gap-2">
            <Wallet className="w-4 h-4 text-indigo-500" />
            <h2 className="text-sm font-semibold text-foreground">{heading}</h2>
          </div>
          <button type="button" onClick={onClose} className="p-1 rounded-lg hover:bg-subtle cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {/* Type selector */}
          <div className="flex gap-1.5 p-1 rounded-lg bg-subtle">
            {(['deposit', 'refund', 'adjustment'] as Kind[]).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setType(k)}
                className={`flex-1 px-2 py-1.5 text-[11px] font-medium rounded-md cursor-pointer transition-colors ${
                  type === k
                    ? 'bg-[var(--card-bg)] text-foreground shadow-sm border border-[var(--border-color)]'
                    : 'text-[var(--text-muted)] hover:text-foreground'
                }`}
              >
                {k === 'deposit' ? 'New Deposit' : k === 'refund' ? 'Refund' : 'Adjustment'}
              </button>
            ))}
          </div>

          {/* Client */}
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1">Client</label>
            {clientName ? (
              <div className="px-3 py-1.5 text-xs rounded-lg bg-subtle border border-[var(--border-color)] text-foreground">
                {clientName}
              </div>
            ) : (
              <ClientCombobox clients={clients} value={client} onChange={setClient} />
            )}
          </div>

          {/* Balance summary */}
          <div className="bg-subtle rounded-lg p-3 space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-[var(--text-muted)]">Current deposit balance</span>
              <span className="font-medium text-foreground tabular-nums">{fmt(currentBalance)}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-[var(--text-muted)]">After this transaction</span>
              <span className={`font-semibold tabular-nums ${
                newBalance < 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'
              }`}>
                {fmt(newBalance)}
              </span>
            </div>
          </div>

          {/* Amount + Date */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1">
                Amount (₱){type === 'adjustment' ? ' — +/−' : ''}
              </label>
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                step="0.01"
                {...(type === 'adjustment' ? {} : { min: '0' })}
                placeholder="0.00"
                className="w-full px-3 py-1.5 text-xs rounded-lg bg-[var(--background)] border border-[var(--border-color)] focus:outline-none focus:ring-1 focus:ring-emerald-300 dark:focus:ring-emerald-500/40"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1">Date</label>
              <DatePickerInput
                variant="compact"
                value={transactionDate || null}
                onChange={(v) => setTransactionDate(v ?? '')}
                placeholder="Pick a date"
              />
            </div>
          </div>

          {/* Method + Reference */}
          {type !== 'adjustment' && (
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
          )}

          {/* Notes */}
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1">Notes</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={type === 'adjustment' ? 'Reason for adjustment' : 'Optional'}
              className="w-full px-3 py-1.5 text-xs rounded-lg bg-[var(--background)] border border-[var(--border-color)] focus:outline-none focus:ring-1 focus:ring-emerald-300 dark:focus:ring-emerald-500/40"
            />
          </div>

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
            disabled={saving || !client || !amount}
            className="px-4 py-2 text-xs font-medium rounded-lg bg-indigo-500 text-white hover:bg-indigo-600 disabled:opacity-50 cursor-pointer"
          >
            {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : ctaLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
