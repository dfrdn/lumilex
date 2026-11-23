'use client';

import { useState, useEffect } from 'react';
import { X, Loader2 } from 'lucide-react';
import DatePickerInput from '@/components/DatePickerInput';

interface InvoiceDates {
  id: number;
  invoice_number: string;
  client_name: string;
  sent_date: string | null;
  due_date: string | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  invoice: InvoiceDates | null;
  onSaved: (updated: { id: number; sent_date: string | null; due_date: string | null }) => void;
}

export default function EditInvoiceDatesModal({ open, onClose, invoice, onSaved }: Props) {
  const [sentDate, setSentDate] = useState<string | null>(null);
  const [dueDate, setDueDate] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open && invoice) {
      setSentDate(invoice.sent_date ?? null);
      setDueDate(invoice.due_date ?? null);
      setError('');
    }
  }, [open, invoice]);

  const handleSave = async () => {
    if (!invoice) return;
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/finance/invoices', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invoiceId: invoice.id,
          action: 'update_dates',
          sent_date: sentDate,
          due_date: dueDate,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save');
      onSaved({ id: invoice.id, sent_date: sentDate, due_date: dueDate });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  if (!open || !invoice) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm animate-fade-in">
      <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] shadow-xl w-full max-w-md mx-4">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-color)]">
          <h2 className="text-sm font-semibold text-foreground">Edit invoice dates</h2>
          <button type="button" onClick={onClose} className="p-1 rounded-lg hover:bg-subtle cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div className="bg-subtle rounded-lg p-3 space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-[var(--text-muted)]">Invoice</span>
              <span className="font-medium text-foreground">{invoice.invoice_number}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-[var(--text-muted)]">Client</span>
              <span className="text-[var(--text-secondary)]">{invoice.client_name}</span>
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1">Sent date</label>
            <DatePickerInput variant="token" value={sentDate} onChange={setSentDate} placeholder="Not sent yet" />
            <p className="text-[10px] text-[var(--text-muted)] mt-1">
              Drives the receivables aging clock. Cannot be a future date.
            </p>
          </div>

          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1">Due date</label>
            <DatePickerInput variant="token" value={dueDate} onChange={setDueDate} placeholder="No due date" />
            <p className="text-[10px] text-[var(--text-muted)] mt-1">
              Until the due date passes, the balance stays in the &quot;Current&quot; aging bucket.
            </p>
          </div>

          {error && (
            <div className="rounded-lg bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 p-2.5 text-[11px] text-red-700 dark:text-red-400">
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-[var(--border-color)]">
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
            className="px-4 py-2 text-xs font-medium rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-50 cursor-pointer flex items-center gap-1.5"
          >
            {saving && <Loader2 className="w-3 h-3 animate-spin" />}
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
