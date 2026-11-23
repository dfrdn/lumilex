'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, CheckCircle2, Loader2 } from 'lucide-react';
import type { LiaisonTask } from '@/lib/queries/liaison';
import { pesoExact } from '@/lib/finance/format';

interface Props {
  task: LiaisonTask;
  onClose: () => void;
  onCompleted: (updated: Partial<LiaisonTask> | null) => void;
}

export default function CompleteErrandModal({ task, onClose, onCompleted }: Props) {
  const tariff = task.zone_round_trip_rate ?? 0;
  const zoneExternal = task.zone_external_rate ?? 0;
  const [amount, setAmount] = useState(String(tariff));
  const [billAtInternal, setBillAtInternal] = useState(!!task.bill_at_internal);
  const [overrideNote, setOverrideNote] = useState('');
  const [completionNote, setCompletionNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const numericAmount = Number(amount);
  const isOverride = Number.isFinite(numericAmount) && numericAmount !== Number(tariff);
  // No-markup errands bill the client the internal amount; otherwise the zone external rate.
  const effectiveExternal = billAtInternal
    ? (Number.isFinite(numericAmount) ? numericAmount : 0)
    : zoneExternal;
  const willBillClient = !!task.matter_id && effectiveExternal > 0;

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape' && !submitting) onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose, submitting]);

  async function handleSubmit() {
    if (isOverride && !overrideNote.trim()) {
      setError('Please add a note explaining the override.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const res = await fetch(`/api/liaison-tasks/${task.id}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: numericAmount,
          override_note: isOverride ? overrideNote.trim() : '',
          completion_note: completionNote.trim(),
          bill_at_internal: billAtInternal,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to complete');
      onCompleted(data.task ?? null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  }

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-card rounded-2xl shadow-2xl border border-[var(--border-color)] max-w-lg w-full">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-color)]">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-500" />
            <h2 className="font-semibold text-foreground">Complete Errand</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="p-1.5 rounded-md text-stone-400 hover:bg-stone-100 dark:hover:bg-stone-800/50"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <div>
            <div className="text-sm font-medium text-foreground">{task.title}</div>
            {task.zone_name && (
              <div className="text-xs text-stone-500 dark:text-stone-400 mt-1">
                Destination: {task.zone_name} · Internal tariff: {pesoExact(tariff)}
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-foreground mb-1">
              Liaison reimbursement — internal (PHP)
            </label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-background border border-[var(--border-color)] text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-gold-400"
            />
            <p className="text-[11px] text-stone-400 mt-1">
              What you&apos;re reimbursed for this trip. Defaults to the zone tariff — change if the
              actual cost was different.
            </p>
          </div>

          {task.matter_id && (
            <label className="flex items-start gap-2 text-[11px] text-stone-600 dark:text-stone-300 cursor-pointer">
              <input
                type="checkbox"
                checked={billAtInternal}
                onChange={(e) => setBillAtInternal(e.target.checked)}
                className="mt-0.5 accent-gold-600"
              />
              <span>Bill the client at the internal rate (no markup)</span>
            </label>
          )}

          <div className="rounded-lg bg-[var(--subtle-bg)] px-3 py-2 text-[11px] text-stone-500 dark:text-stone-400">
            {willBillClient ? (
              <>
                The client will be billed{' '}
                <span className="font-medium text-foreground">{pesoExact(effectiveExternal)}</span>{' '}
                {billAtInternal ? '(internal rate, no markup)' : 'as the external rate'} for{' '}
                {task.matter_name || 'this matter'}.
              </>
            ) : (
              <>This errand isn&apos;t billed to a client — only your internal reimbursement is recorded.</>
            )}
          </div>

          {isOverride && (
            <div>
              <label className="block text-xs font-medium text-foreground mb-1">
                Why is the amount different from the tariff? <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                value={overrideNote}
                onChange={(e) => setOverrideNote(e.target.value)}
                placeholder="e.g. Had to take a taxi due to typhoon"
                className="w-full px-3 py-2 rounded-lg bg-background border border-[var(--border-color)] text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-gold-400"
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-foreground mb-1">
              Completion note (optional)
            </label>
            <textarea
              rows={2}
              value={completionNote}
              onChange={(e) => setCompletionNote(e.target.value)}
              placeholder="e.g. Filed; received-stamped copy in shared drive"
              className="w-full px-3 py-2 rounded-lg bg-background border border-[var(--border-color)] text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-gold-400 resize-none"
            />
          </div>

          {error && <p className="text-xs text-rose-600 dark:text-rose-400">{error}</p>}
        </div>

        <div className="px-5 py-3 border-t border-[var(--border-color)] flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-3 py-1.5 rounded-lg text-sm text-stone-600 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800/50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60"
          >
            {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
            Mark Completed
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
