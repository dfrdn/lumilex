'use client';

import { useState, useEffect, useCallback } from 'react';
import { X, Trash2, Loader2 } from 'lucide-react';
import { fmt } from '@/lib/finance/format';

interface Payment {
  id: number;
  invoice_id: number;
  amount: number;
  payment_date: string;
  payment_method: string;
  reference_number: string;
  notes: string;
  recorded_by: string;
}

interface Props {
  open: boolean;
  invoice: { id: number; invoice_number: string } | null;
  onClose: () => void;
  /** Called after a payment is undone so the parent can refresh invoice status. */
  onChanged: () => void;
}

function methodLabel(p: Payment): string {
  if (p.payment_method === 'credit') return 'credit / discount';
  if (p.payment_method === 'deposit') return 'from deposit';
  return p.payment_method || 'payment';
}

export default function InvoicePaymentsModal({ open, invoice, onClose, onChanged }: Props) {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(false);
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!invoice) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/finance/invoices/payments?invoiceId=${invoice.id}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load payments');
      setPayments(json.payments ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load payments');
    } finally {
      setLoading(false);
    }
  }, [invoice]);

  useEffect(() => { if (open) load(); }, [open, load]);

  const undo = useCallback(async (p: Payment) => {
    if (!invoice) return;
    setConfirmId(null);
    setBusyId(p.id);
    setError(null);
    try {
      let res: Response;
      if (typeof p.reference_number === 'string' && p.reference_number.startsWith('OA-')) {
        res = await fetch(`/api/finance/clients/payments?ref=${encodeURIComponent(p.reference_number)}`, { method: 'DELETE' });
      } else if (p.payment_method === 'credit') {
        res = await fetch('/api/finance/invoices', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'reverse_credit', invoiceId: invoice.id, creditId: p.id }),
        });
      } else {
        res = await fetch(`/api/finance/invoices/payments?id=${p.id}`, { method: 'DELETE' });
      }
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Failed to undo payment');
      await load();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to undo payment');
    } finally {
      setBusyId(null);
    }
  }, [invoice, load, onChanged]);

  if (!open || !invoice) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm animate-fade-in">
      <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] shadow-xl w-full max-w-lg mx-4">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-color)]">
          <h2 className="text-sm font-semibold text-foreground">
            Payments · {invoice.invoice_number}
          </h2>
          <button type="button" onClick={onClose} className="p-1 rounded-lg hover:bg-subtle cursor-pointer">
            <X className="w-4 h-4 text-[var(--text-muted)]" />
          </button>
        </div>
        <div className="px-6 py-4">
          {error && (
            <p className="mb-3 text-xs text-red-600 dark:text-red-400">{error}</p>
          )}
          {loading ? (
            <div className="flex items-center justify-center py-8 text-[var(--text-muted)]">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          ) : payments.length === 0 ? (
            <p className="text-xs text-[var(--text-muted)] italic py-6 text-center">
              No payments recorded against this invoice.
            </p>
          ) : (
            <div className="space-y-1">
              {payments.map((p) => (
                <div key={p.id} className="flex items-center gap-3 py-2 px-2 rounded-lg hover:bg-subtle text-xs">
                  <span className="font-semibold tabular-nums text-emerald-600 dark:text-emerald-400 w-24">
                    {fmt(Number(p.amount))}
                  </span>
                  <span className="text-[var(--text-muted)] font-mono">
                    {new Date(p.payment_date + 'T00:00:00Z').toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'Asia/Manila' })}
                  </span>
                  <span className="text-[var(--text-muted)]">{methodLabel(p)}</span>
                  {p.notes && <span className="text-[var(--text-muted)] truncate flex-1" title={p.notes}>— {p.notes}</span>}
                  <span className="ml-auto shrink-0">
                    {busyId === p.id ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--text-muted)]" />
                    ) : confirmId === p.id ? (
                      <button
                        type="button"
                        onClick={() => undo(p)}
                        className="text-[10px] font-semibold text-red-600 dark:text-red-400 px-1.5 py-0.5 cursor-pointer"
                      >
                        Undo?
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmId(p.id)}
                        title={p.reference_number?.startsWith('OA-') ? 'Reverse this on-account receipt' : 'Undo this payment'}
                        className="p-1 rounded text-[var(--text-muted)] hover:text-red-600 dark:hover:text-red-400 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}
          <p className="mt-3 text-[10px] text-[var(--text-muted)]">
            Undoing a payment reopens the invoice balance. A deposit-applied payment also returns the amount to the client&apos;s deposit on hand.
          </p>
        </div>
      </div>
    </div>
  );
}
