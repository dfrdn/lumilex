'use client';

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  X, Loader2, RotateCcw, CheckCircle, AlertCircle, AlertTriangle, Clock, MinusCircle,
} from 'lucide-react';
import MonthFilter from '@/components/finance/MonthFilter';

interface Invoice {
  id: number;
  invoice_number: string;
  client_name: string;
  billing_month: string;
  total_amount: number;
  total_expenses: number;
  status: string;
}

type RowState = 'queued' | 'running' | 'done' | 'failed' | 'skipped';

interface RowResult {
  state: RowState;
  message?: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  invoices: Invoice[];
  /** Pre-set the month filter when the modal opens (e.g. mirroring the list's filter). */
  initialMonth?: string | null;
  /** Called once per successful regenerate with the updated invoice row so the
   *  parent can merge it into its list live. */
  onRegenerated?: (updated: Invoice & Record<string, unknown>) => void;
}

function fmt(n: number) {
  return `₱${Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;
}

export default function BatchRegenerateModal({ open, onClose, invoices, initialMonth, onRegenerated }: Props) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<Record<number, RowResult>>({});
  const [done, setDone] = useState(false);
  const [monthFilter, setMonthFilter] = useState<string | null>(null);
  // Set when the user asks to stop — the loop checks this between invoices and
  // halts after the current one finishes (regenerate is not interruptible mid-file).
  const cancelRef = useRef(false);

  const months = useMemo(
    () => [...new Set(invoices.map((i) => i.billing_month).filter(Boolean))],
    [invoices],
  );
  const visible = useMemo(
    () => (monthFilter ? invoices.filter((i) => i.billing_month === monthFilter) : invoices),
    [invoices, monthFilter],
  );

  // Default selection: drafts only (within the active month filter). Regenerating
  // a sent/paid invoice reverts it to draft and clears its sent date, so we don't
  // pre-select those — finance must opt in explicitly (and gets a warning below).
  //
  // Initialize ONLY on the open transition. The parent merges each regenerated
  // row back via onRegenerated → setInvoices, which hands us a fresh `invoices`
  // array mid-run; a plain `[open, invoices]` effect would re-reset results /
  // running / cancelRef on every completed invoice and corrupt the live run.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current) {
      const month = initialMonth ?? null;
      const scope = month ? invoices.filter((i) => i.billing_month === month) : invoices;
      setMonthFilter(month);
      setSelected(new Set(scope.filter((i) => i.status === 'draft').map((i) => i.id)));
      setResults({});
      setDone(false);
      setRunning(false);
      cancelRef.current = false;
    }
    wasOpen.current = open;
  }, [open, invoices, initialMonth]);

  const toggle = (id: number) => {
    if (running) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const visibleSelectedCount = visible.filter((i) => selected.has(i.id)).length;
  const allSelected = visible.length > 0 && visibleSelectedCount === visible.length;
  const toggleAll = () => {
    if (running) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) visible.forEach((i) => next.delete(i.id));
      else visible.forEach((i) => next.add(i.id));
      return next;
    });
  };

  const selectedSentOrPaid = useMemo(
    () => visible.filter((i) => selected.has(i.id) && i.status !== 'draft'),
    [visible, selected],
  );

  const summary = useMemo(() => {
    const vals = Object.values(results);
    return {
      done: vals.filter((r) => r.state === 'done').length,
      failed: vals.filter((r) => r.state === 'failed').length,
      skipped: vals.filter((r) => r.state === 'skipped').length,
    };
  }, [results]);

  const run = useCallback(async () => {
    const ids = visible.filter((i) => selected.has(i.id)).map((i) => i.id);
    if (ids.length === 0) return;
    setRunning(true);
    setDone(false);
    cancelRef.current = false;
    setResults(Object.fromEntries(ids.map((id) => [id, { state: 'queued' as RowState }])));

    for (const id of ids) {
      if (cancelRef.current) break;
      setResults((prev) => ({ ...prev, [id]: { state: 'running' } }));
      try {
        const res = await fetch(`/api/finance/regenerate-invoice?id=${id}`, { method: 'POST' });
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
          setResults((prev) => ({ ...prev, [id]: { state: 'done' } }));
          if (data.invoice) onRegenerated?.(data.invoice);
        } else if (res.status === 409) {
          // Approval gate / nothing-to-regenerate — a soft skip, not a failure.
          setResults((prev) => ({ ...prev, [id]: { state: 'skipped', message: data.error || 'Skipped' } }));
        } else {
          setResults((prev) => ({ ...prev, [id]: { state: 'failed', message: data.error || `Failed (${res.status})` } }));
        }
      } catch (err) {
        setResults((prev) => ({
          ...prev,
          [id]: { state: 'failed', message: err instanceof Error ? err.message : 'Network error' },
        }));
      }
    }

    setRunning(false);
    setDone(true);
  }, [visible, selected, onRegenerated]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 dark:bg-black/60 backdrop-blur-sm" onClick={running ? undefined : onClose} />

      <div className="relative bg-[var(--card-bg)] rounded-2xl border border-[var(--border-color)] shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-color)]">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Regenerate Invoices</h2>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              Rebuilds the letter, breakdown PDF, and Excel from the latest DTRs and settings. The invoice number stays the same.
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={running}
            className="p-1.5 rounded-lg hover:bg-[var(--subtle-bg)] text-[var(--text-muted)] transition-colors disabled:opacity-40"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Month filter */}
        {months.length > 1 && (
          <div className="flex items-center gap-3 px-6 pt-3">
            <MonthFilter months={months} value={monthFilter} onChange={running ? () => {} : setMonthFilter} />
            <span className="text-xs text-[var(--text-muted)]">
              {visible.length} {visible.length === 1 ? 'invoice' : 'invoices'}{monthFilter ? ' this month' : ''}
            </span>
          </div>
        )}

        {/* List */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-2">
          {visible.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)] text-center py-8">No invoices for the selected month.</p>
          ) : (
            visible.map((inv) => {
              const isSelected = selected.has(inv.id);
              const total = Number(inv.total_amount) + Number(inv.total_expenses);
              const r = results[inv.id];
              return (
                <div
                  key={inv.id}
                  className={`flex items-center gap-3 p-3 rounded-xl border transition-colors ${
                    isSelected ? 'border-amber-300 dark:border-amber-600 bg-amber-50/40 dark:bg-amber-500/5' : 'border-[var(--border-color)]'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggle(inv.id)}
                    disabled={running}
                    className="rounded border-[var(--border-color)] shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-foreground">{inv.invoice_number}</span>
                      <span className="text-xs text-[var(--text-muted)] truncate">{inv.client_name}</span>
                      {inv.status !== 'draft' && (
                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 capitalize">
                          {inv.status}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-[var(--text-muted)]">
                      {inv.billing_month} &middot; {fmt(total)}
                    </div>
                  </div>
                  <RowStatus result={r} />
                </div>
              );
            })
          )}
        </div>

        {/* Warning for sent/paid */}
        {selectedSentOrPaid.length > 0 && !done && (
          <div className="mx-6 mb-2 flex gap-2 rounded-lg bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 p-3 text-xs text-amber-800 dark:text-amber-300">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              {selectedSentOrPaid.length} selected invoice{selectedSentOrPaid.length !== 1 ? 's are' : ' is'} already{' '}
              <strong>sent/paid</strong>. Regenerating reverts {selectedSentOrPaid.length !== 1 ? 'them' : 'it'} to{' '}
              <strong>draft</strong> and clears the sent date — finance must re-send afterward.
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-[var(--border-color)]">
          {done ? (
            <div className="flex items-center gap-4 text-sm">
              {summary.done > 0 && (
                <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                  <CheckCircle className="w-4 h-4" />{summary.done} regenerated
                </span>
              )}
              {summary.skipped > 0 && (
                <span className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
                  <MinusCircle className="w-4 h-4" />{summary.skipped} skipped
                </span>
              )}
              {summary.failed > 0 && (
                <span className="flex items-center gap-1.5 text-red-600 dark:text-red-400">
                  <AlertCircle className="w-4 h-4" />{summary.failed} failed
                </span>
              )}
            </div>
          ) : (
            <p className="text-xs text-[var(--text-muted)]">
              {visibleSelectedCount} of {visible.length} selected
              {visible.length > 0 && (
                <button onClick={toggleAll} disabled={running} className="ml-3 underline hover:text-foreground disabled:opacity-40">
                  {allSelected ? 'Deselect all' : 'Select all'}
                </button>
              )}
            </p>
          )}

          <div className="flex gap-3">
            {running ? (
              <button
                onClick={() => { cancelRef.current = true; }}
                className="px-4 py-2 text-sm font-medium text-[var(--text-secondary)] hover:text-foreground transition-colors"
              >
                Stop after current
              </button>
            ) : (
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-[var(--text-secondary)] hover:text-foreground transition-colors"
              >
                {done ? 'Close' : 'Cancel'}
              </button>
            )}
            {!done && (
              <button
                onClick={run}
                disabled={running || visibleSelectedCount === 0}
                className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold bg-amber-600 hover:bg-amber-700 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                {running ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Regenerating {Math.min(summary.done + summary.failed + summary.skipped + 1, Object.keys(results).length)}/{Object.keys(results).length}…
                  </>
                ) : (
                  <>
                    <RotateCcw className="w-4 h-4" />
                    Regenerate {visibleSelectedCount > 0 ? visibleSelectedCount : ''} Invoice{visibleSelectedCount !== 1 ? 's' : ''}
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function RowStatus({ result }: { result?: RowResult }) {
  if (!result || result.state === 'queued') {
    return <Clock className="w-4 h-4 text-[var(--text-muted)] shrink-0" />;
  }
  if (result.state === 'running') {
    return <Loader2 className="w-4 h-4 text-amber-500 animate-spin shrink-0" />;
  }
  if (result.state === 'done') {
    return <CheckCircle className="w-4 h-4 text-emerald-500 shrink-0" />;
  }
  if (result.state === 'skipped') {
    return (
      <span className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400 max-w-[12rem] justify-end" title={result.message}>
        <MinusCircle className="w-3.5 h-3.5 shrink-0" />
        <span className="truncate">{result.message || 'Skipped'}</span>
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 text-xs text-red-600 dark:text-red-400 max-w-[12rem] justify-end" title={result.message}>
      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
      <span className="truncate">{result.message || 'Failed'}</span>
    </span>
  );
}
