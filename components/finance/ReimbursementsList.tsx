'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { Loader2, Check, Receipt, Eye } from 'lucide-react';
import FilePreviewModal from '@/components/FilePreviewModal';
import type { FileAttachment } from '@/types/notion';

interface Reimbursement {
  notion_id: string;
  expense: string;
  amount: number;
  expense_category: string;
  expense_date: string | null;
  matter_name: string;
  client_name: string;
  lawyer_name: string;
  reimbursed: boolean;
  billed: boolean;
  receipt_urls: { name: string; url: string }[];
  created_time: string | null;
}

type StatusFilter = 'all' | 'pending' | 'reimbursed';

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(amount);
}

function formatDate(date: string | null): string {
  if (!date) return '—';
  return new Date(date + 'T00:00:00').toLocaleDateString('en-PH', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

export default function ReimbursementsList() {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('pending');
  const { data, error: loadError, isLoading: loading, mutate } = useSWR<{ reimbursements?: Reimbursement[] }>(
    `/api/finance/reimbursements?status=${statusFilter}`,
    async (url: string) => {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`Failed to load (${r.status})`);
      return r.json();
    },
  );
  const items = data?.reimbursements ?? [];
  const error = loadError ? (loadError instanceof Error ? loadError.message : 'Failed to load') : null;
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [updating, setUpdating] = useState(false);
  const [previewFiles, setPreviewFiles] = useState<FileAttachment[] | null>(null);


  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (selected.size === items.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(items.map((r) => r.notion_id)));
    }
  }

  async function markReimbursed(reimbursed: boolean) {
    if (selected.size === 0) return;
    setUpdating(true);
    try {
      const res = await fetch('/api/finance/reimbursements', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notionIds: [...selected], reimbursed }),
      });
      if (res.ok) {
        mutate(
          (d) => ({ ...d, reimbursements: (d?.reimbursements ?? []).map((r) => (selected.has(r.notion_id) ? { ...r, reimbursed } : r)) }),
          { revalidate: false },
        );
        setSelected(new Set());
      }
    } catch { /* ignore */ }
    setUpdating(false);
  }

  function openReceipts(receipts: { name: string; url: string }[]) {
    const files: FileAttachment[] = receipts.map((r) => ({
      name: r.name,
      url: r.url,
    }));
    setPreviewFiles(files);
  }

  const pendingTotal = items.filter((r) => !r.reimbursed).reduce((s, r) => s + Number(r.amount), 0);
  const reimbursedTotal = items.filter((r) => r.reimbursed).reduce((s, r) => s + Number(r.amount), 0);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-[var(--text-muted)]" />
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold text-foreground font-[family-name:var(--font-playfair)] mb-6">
        Reimbursements
      </h1>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-6">
        <div className="rounded-xl border border-[var(--border-color)] bg-card p-4 shadow-[var(--shadow-card)]">
          <p className="text-[11px] uppercase tracking-wider text-[var(--text-muted)] font-semibold">Total Items</p>
          <p className="text-2xl font-bold text-foreground mt-1">{items.length}</p>
        </div>
        <div className="rounded-xl border border-[var(--border-color)] bg-card p-4 shadow-[var(--shadow-card)]">
          <p className="text-[11px] uppercase tracking-wider text-[var(--text-muted)] font-semibold">Pending</p>
          <p className="text-2xl font-bold text-amber-600 dark:text-amber-400 mt-1">{formatCurrency(pendingTotal)}</p>
        </div>
        <div className="rounded-xl border border-[var(--border-color)] bg-card p-4 shadow-[var(--shadow-card)]">
          <p className="text-[11px] uppercase tracking-wider text-[var(--text-muted)] font-semibold">Reimbursed</p>
          <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 mt-1">{formatCurrency(reimbursedTotal)}</p>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div className="flex items-center gap-1 bg-[var(--subtle-bg)] rounded-lg p-0.5">
          {(['pending', 'all', 'reimbursed'] as StatusFilter[]).map((f) => (
            <button
              key={f}
              onClick={() => { setStatusFilter(f); setSelected(new Set()); }}
              className={`px-3 py-1.5 text-xs font-medium rounded-md capitalize transition-colors ${
                statusFilter === f
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-[var(--text-muted)] hover:text-foreground'
              }`}
            >
              {f}
            </button>
          ))}
        </div>

        {selected.size > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-[var(--text-muted)]">{selected.size} selected</span>
            {statusFilter !== 'reimbursed' && (
              <button
                onClick={() => markReimbursed(true)}
                disabled={updating}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 transition-colors"
              >
                {updating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                Mark Reimbursed
              </button>
            )}
            {statusFilter !== 'pending' && (
              <button
                onClick={() => markReimbursed(false)}
                disabled={updating}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50 transition-colors"
              >
                {updating ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                Mark Pending
              </button>
            )}
          </div>
        )}
      </div>

      {error ? (
        <div className="text-center py-12 text-red-600 dark:text-red-400">
          <p className="text-sm">{error}</p>
          <button onClick={() => mutate()} className="mt-2 text-xs underline">Retry</button>
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-12 text-[var(--text-muted)]">
          <Receipt className="w-8 h-8 mx-auto mb-2 opacity-40" />
          <p className="text-sm">No {statusFilter === 'all' ? '' : statusFilter} reimbursements found.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[var(--border-color)] bg-card shadow-[var(--shadow-card)]">
          <table className="w-full border-collapse">
            <thead>
              <tr className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                <th className="w-10 px-3 py-3 border-b border-[var(--border-color)]">
                  <input
                    type="checkbox"
                    checked={selected.size === items.length && items.length > 0}
                    onChange={toggleAll}
                    className="rounded border-[var(--border-color)]"
                  />
                </th>
                <th className="text-left px-3 py-3 border-b border-[var(--border-color)]">Date</th>
                <th className="text-left px-3 py-3 border-b border-[var(--border-color)]">Lawyer</th>
                <th className="text-left px-3 py-3 border-b border-[var(--border-color)]">Expense</th>
                <th className="text-left px-3 py-3 border-b border-[var(--border-color)]">Category</th>
                <th className="text-left px-3 py-3 border-b border-[var(--border-color)]">Client</th>
                <th className="text-left px-3 py-3 border-b border-[var(--border-color)]">Matter</th>
                <th className="text-right px-3 py-3 border-b border-[var(--border-color)]">Amount</th>
                <th className="text-center px-3 py-3 border-b border-[var(--border-color)]">Status</th>
                <th className="text-center px-3 py-3 border-b border-[var(--border-color)]">Receipts</th>
              </tr>
            </thead>
            <tbody>
              {items.map((r) => (
                <tr key={r.notion_id} className="hover:bg-[var(--subtle-bg)] transition-colors">
                  <td className="px-3 py-3 border-b border-[var(--border-color)]">
                    <input
                      type="checkbox"
                      checked={selected.has(r.notion_id)}
                      onChange={() => toggleSelect(r.notion_id)}
                      className="rounded border-[var(--border-color)]"
                    />
                  </td>
                  <td className="px-3 py-3 text-sm text-[var(--text-secondary)] border-b border-[var(--border-color)] whitespace-nowrap">
                    {formatDate(r.expense_date)}
                  </td>
                  <td className="px-3 py-3 text-sm text-foreground border-b border-[var(--border-color)]">
                    {r.lawyer_name}
                  </td>
                  <td className="px-3 py-3 text-sm text-foreground font-medium border-b border-[var(--border-color)] max-w-[200px] truncate">
                    {r.expense}
                  </td>
                  <td className="px-3 py-3 border-b border-[var(--border-color)]">
                    <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--subtle-bg)] text-[var(--text-secondary)]">
                      {r.expense_category}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-sm text-foreground border-b border-[var(--border-color)]">
                    {r.client_name}
                  </td>
                  <td className="px-3 py-3 text-sm text-[var(--text-secondary)] border-b border-[var(--border-color)] max-w-[180px] truncate">
                    {r.matter_name || '—'}
                  </td>
                  <td className="px-3 py-3 text-sm font-medium text-foreground text-right border-b border-[var(--border-color)] whitespace-nowrap">
                    {formatCurrency(Number(r.amount))}
                  </td>
                  <td className="px-3 py-3 text-center border-b border-[var(--border-color)]">
                    <div className="flex flex-col items-center gap-1">
                      <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${
                        r.reimbursed
                          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                          : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                      }`}>
                        {r.reimbursed ? 'Reimbursed' : 'Pending'}
                      </span>
                      {r.client_name && (
                        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
                          r.billed
                            ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                            : 'bg-[var(--subtle-bg)] text-[var(--text-muted)]'
                        }`}>
                          {r.billed ? 'Billed' : 'Unbilled'}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-3 text-center border-b border-[var(--border-color)]">
                    {r.receipt_urls && r.receipt_urls.length > 0 ? (
                      <button
                        onClick={() => openReceipts(r.receipt_urls)}
                        className="p-1.5 rounded-lg hover:bg-[var(--subtle-bg)] text-blue-500 transition-colors mx-auto"
                        title={`${r.receipt_urls.length} receipt(s)`}
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                    ) : (
                      <span className="text-[var(--text-muted)] text-xs">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <FilePreviewModal
        open={previewFiles !== null}
        onClose={() => setPreviewFiles(null)}
        files={previewFiles ?? undefined}
        initialIndex={0}
      />
    </div>
  );
}
