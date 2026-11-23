'use client';

import { useEffect, useRef, useState } from 'react';
import useSWR from 'swr';
import { Check, Loader2, RotateCcw, X } from 'lucide-react';
import { pesoExact } from '@/lib/finance/format';
import { offCycleTotal } from '@/lib/billing/off-cycle-label';

interface FeeLine {
  kind: string;
  matterName: string | null;
  description: string;
  amount: number;
}

interface OffCycleRequest {
  id: number;
  clientName: string;
  billingMonth: string;
  periodLabel: string;
  feeLines: FeeLine[];
  notes: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  requestedBy: string | null;
  requestedAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNotes: string;
  invoiceGenStatus: 'pending' | 'success' | 'failed' | null;
  invoiceGenError: string | null;
  invoiceNumber: string | null;
}

interface ListResponse {
  requests: OffCycleRequest[];
  canDecide: boolean;
}

const REJECTED_SHOWN_DAYS = 14;

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', day: 'numeric', month: 'short', year: 'numeric' });
}

/** Which requests still need someone's attention on this surface. */
function isOpen(r: OffCycleRequest, mode: 'finance' | 'partner'): boolean {
  if (mode === 'partner') return r.status === 'pending';
  if (r.status === 'pending') return true;
  if (r.status === 'approved') return r.invoiceGenStatus !== 'success';
  if (r.status === 'rejected' && r.decidedAt) {
    return Date.now() - new Date(r.decidedAt).getTime() < REJECTED_SHOWN_DAYS * 86_400_000;
  }
  return false;
}

/**
 * Off-cycle invoice requests still in flight. Finance sees what awaits the
 * managing partner, what is generating, what failed, and recent rejections; the
 * partner billing-review page lists what awaits approval, with the decision
 * buttons for the managing partner. Renders nothing when there is nothing open.
 */
export default function OffCycleRequests({
  mode,
  reloadKey = 0,
  onInvoiceReady,
}: {
  mode: 'finance' | 'partner';
  /** Bump to reload after filing a new request. */
  reloadKey?: number;
  /** Finance: an approval just produced a draft invoice. */
  onInvoiceReady?: () => void;
}) {
  const url = `/api/finance/off-cycle-invoices?status=${mode === 'partner' ? 'pending' : 'pending,approved,rejected'}`;
  const [generating, setGenerating] = useState(false);
  const { data, mutate } = useSWR<ListResponse>(
    url,
    async (u: string) => {
      const r = await fetch(u);
      if (!r.ok) throw new Error(`Failed to load off-cycle requests (${r.status})`);
      return r.json();
    },
    { refreshInterval: generating ? 3000 : 0 },
  );
  const [busyId, setBusyId] = useState<number | null>(null);
  const [rejectingId, setRejectingId] = useState<number | null>(null);
  const [rejectNote, setRejectNote] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (reloadKey > 0) void mutate();
  }, [reloadKey, mutate]);

  const requests = (data?.requests ?? []).filter((r) => isOpen(r, mode));

  // Poll while a draft is generating, and tell the invoice list when one lands.
  const prevGenerating = useRef<Set<number>>(new Set());
  const onReady = useRef(onInvoiceReady);
  useEffect(() => { onReady.current = onInvoiceReady; }, [onInvoiceReady]);
  useEffect(() => {
    const all = data?.requests ?? [];
    const now = new Set(all.filter((r) => r.status === 'approved' && r.invoiceGenStatus === 'pending').map((r) => r.id));
    setGenerating(now.size > 0);
    const landed = [...prevGenerating.current].some((id) => all.find((r) => r.id === id)?.invoiceGenStatus === 'success');
    prevGenerating.current = now;
    if (landed) onReady.current?.();
  }, [data]);

  async function act(id: number, path: string, body: Record<string, unknown>, patch: Partial<OffCycleRequest>) {
    setBusyId(id);
    setError('');
    try {
      const res = await fetch(path, {
        method: path.endsWith('/decision') ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.details?.join('; ') || d.error || `Request failed (${res.status})`);
      await mutate(
        (prev) => prev && { ...prev, requests: prev.requests.map((r) => (r.id === id ? { ...r, ...patch } : r)) },
        { revalidate: false },
      );
      setRejectingId(null);
      setRejectNote('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setBusyId(null);
    }
  }

  if (requests.length === 0 && !error) return null;
  const canDecide = mode === 'partner' && !!data?.canDecide;

  return (
    <div className="mb-6 rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)]">
      <div className="px-4 py-3 border-b border-[var(--border-color)]">
        <h2 className="text-sm font-semibold text-foreground">
          {mode === 'partner' ? 'Off-cycle invoices awaiting approval' : 'Off-cycle invoice requests'}
        </h2>
        {mode === 'partner' && !canDecide && (
          <p className="text-[11px] text-[var(--text-muted)] mt-0.5">Only the managing partner can approve these.</p>
        )}
      </div>
      <ul className="divide-y divide-[var(--border-color)]">
        {requests.map((r) => {
          const total = offCycleTotal(r.feeLines);
          const busy = busyId === r.id;
          return (
            <li key={r.id} className="px-4 py-3 text-xs">
              <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">{r.clientName}</p>
                  <p className="text-[var(--text-secondary)]">{r.periodLabel}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold text-foreground tabular-nums">{pesoExact(total)}</p>
                  <p className="text-[10px] text-[var(--text-muted)]">before VAT</p>
                </div>
              </div>

              <ul className="mt-2 space-y-0.5">
                {r.feeLines.map((f, i) => (
                  <li key={i} className="flex justify-between gap-3 text-[var(--text-secondary)]">
                    <span className="min-w-0 truncate">
                      {f.description}
                      {f.matterName && <span className="text-[var(--text-muted)]"> · {f.matterName}</span>}
                    </span>
                    <span className="tabular-nums">{pesoExact(f.amount)}</span>
                  </li>
                ))}
              </ul>

              <p className="mt-2 text-[11px] text-[var(--text-muted)]">
                Requested by {r.requestedBy ?? 'finance'} on {formatDay(r.requestedAt)}
                {r.notes && <> — &ldquo;{r.notes}&rdquo;</>}
              </p>

              {r.status === 'rejected' && (
                <p className="mt-1 text-[11px] text-red-700 dark:text-red-400">
                  Rejected by {r.decidedBy ?? 'the managing partner'}{r.decisionNotes && <>: &ldquo;{r.decisionNotes}&rdquo;</>}
                </p>
              )}
              {r.status === 'approved' && r.invoiceGenStatus === 'pending' && (
                <p className="mt-1 flex items-center gap-1.5 text-[11px] text-[var(--text-secondary)]">
                  <Loader2 className="w-3 h-3 animate-spin" /> Approved — generating the draft…
                </p>
              )}
              {r.status === 'approved' && r.invoiceGenStatus === 'failed' && (
                <p className="mt-1 text-[11px] text-red-700 dark:text-red-400">
                  Approved, but the draft failed to generate: {r.invoiceGenError ?? 'unknown error'}
                </p>
              )}

              {mode === 'finance' && r.status === 'pending' && (
                <div className="mt-2 flex items-center gap-3">
                  <span className="text-[11px] text-amber-700 dark:text-amber-300">Awaiting the managing partner</span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => act(r.id, `/api/finance/off-cycle-invoices/${r.id}`, { action: 'cancel' }, { status: 'cancelled' })}
                    className="text-[11px] text-red-600 dark:text-red-400 hover:underline disabled:opacity-50 cursor-pointer"
                  >
                    Cancel request
                  </button>
                </div>
              )}
              {mode === 'finance' && r.status === 'approved' && r.invoiceGenStatus === 'failed' && (
                <div className="mt-2 flex items-center gap-3">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => act(r.id, `/api/finance/off-cycle-invoices/${r.id}`, { action: 'retry' }, { invoiceGenStatus: 'pending', invoiceGenError: null })}
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-gold-600 dark:text-gold-400 hover:underline disabled:opacity-50 cursor-pointer"
                  >
                    <RotateCcw className="w-3 h-3" /> Retry generation
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => act(r.id, `/api/finance/off-cycle-invoices/${r.id}`, { action: 'cancel' }, { status: 'cancelled' })}
                    className="text-[11px] text-red-600 dark:text-red-400 hover:underline disabled:opacity-50 cursor-pointer"
                  >
                    Cancel request
                  </button>
                </div>
              )}

              {canDecide && r.status === 'pending' && (
                rejectingId === r.id ? (
                  <div className="mt-2 space-y-2">
                    <textarea
                      value={rejectNote}
                      onChange={(e) => setRejectNote(e.target.value)}
                      rows={2}
                      placeholder="Why it shouldn't be billed (sent to finance)"
                      className="w-full px-3 py-1.5 text-xs rounded-lg bg-[var(--background)] border border-[var(--border-color)] focus:outline-none focus:ring-1 focus:ring-gold-300 dark:focus:ring-gold-500/40 resize-none"
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={busy || !rejectNote.trim()}
                        onClick={() => act(r.id, `/api/finance/off-cycle-invoices/${r.id}/decision`, { decision: 'reject', notes: rejectNote.trim() }, { status: 'rejected' })}
                        className="px-3 py-1.5 text-xs font-medium rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 cursor-pointer"
                      >
                        {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Reject'}
                      </button>
                      <button
                        type="button"
                        onClick={() => { setRejectingId(null); setRejectNote(''); }}
                        className="px-3 py-1.5 text-xs font-medium rounded-lg bg-subtle text-[var(--text-secondary)] border border-[var(--border-color)] cursor-pointer"
                      >
                        Back
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => act(r.id, `/api/finance/off-cycle-invoices/${r.id}/decision`, { decision: 'approve' }, { status: 'approved', invoiceGenStatus: 'pending' })}
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 cursor-pointer"
                    >
                      {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} Approve
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setRejectingId(r.id)}
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg bg-subtle text-[var(--text-secondary)] border border-[var(--border-color)] hover:text-red-600 dark:hover:text-red-400 disabled:opacity-50 cursor-pointer"
                    >
                      <X className="w-3 h-3" /> Reject
                    </button>
                  </div>
                )
              )}
            </li>
          );
        })}
      </ul>
      {error && (
        <div className="mx-4 mb-3 rounded-lg bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 p-2.5 text-[11px] text-red-700 dark:text-red-400">
          {error}
        </div>
      )}
    </div>
  );
}
