'use client';

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import useSWR from 'swr';
import { Loader2, FilePlus2, FileSpreadsheet, BookOpen, Send, Trash2, RotateCcw, AlertTriangle, X, Eye, Download, CalendarClock, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { invoiceGrossDue, invoiceOpenBalance } from '@/lib/finance/invoice-amounts';
import FilePreviewModal from '@/components/FilePreviewModal';
import BatchSendModal from '@/components/finance/BatchSendModal';
import BatchRegenerateModal from '@/components/finance/BatchRegenerateModal';
import MonthFilter from '@/components/finance/MonthFilter';
import EditInvoiceDatesModal from '@/components/finance/EditInvoiceDatesModal';
import InvoicePaymentsModal from '@/components/finance/InvoicePaymentsModal';
import RowActionMenu, { type ActionMenuItem } from '@/components/RowActionMenu';
import OffCycleInvoiceModal from '@/components/finance/OffCycleInvoiceModal';
import OffCycleRequests from '@/components/finance/OffCycleRequests';
import type { FileAttachment } from '@/types/notion';

/** Fetch a fresh signed URL for a storage path and trigger a browser download
 *  of that file under the given filename. Used by the row "Download" actions. */
async function downloadFromStorage(path: string, filename: string): Promise<void> {
  const res = await fetch('/api/file-sign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paths: [path] }),
  });
  if (!res.ok) return;
  const data = await res.json();
  const url = data?.urls?.[path];
  if (!url) return;
  // Trigger download via a temporary anchor — the `download` attribute hints
  // the browser to save instead of navigate.
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener noreferrer';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

interface Invoice {
  id: number;
  invoice_number: string;
  client_name: string;
  matter_name: string | null;
  billing_month: string;
  total_hours: number;
  total_amount: number;
  total_expenses: number;
  status: string;
  docx_storage_path: string | null;
  xlsx_storage_path: string | null;
  signed_pdf_path: string | null;
  signed_breakdown_pdf_path: string | null;
  pdf_storage_path: string | null;
  breakdown_pdf_storage_path: string | null;
  sent_date: string | null;
  due_date: string | null;
  paid_amount?: number | null;
  billing_settings?: { includeVAT?: unknown } | null;
  created_at: string;
  revision_count?: number;
  previously_sent_at?: string | null;
  /** 'off_cycle' for a fee-only bill issued between monthly runs. */
  invoice_kind?: string | null;
  /** null when the client has no relationship partner assigned. */
  relationship_partner?: { name: string | null; active: boolean } | null;
}

/**
 * The client's relationship partner — the one who has to clear the bundle, and
 * who a send can copy. "Unassigned" blocks billing outright, so it reads as a
 * warning rather than a blank cell.
 */
function RelationshipPartnerCell({ partner }: { partner?: { name: string | null; active: boolean } | null }) {
  if (!partner) {
    return (
      <span className="text-xs text-amber-600 dark:text-amber-400" title="Billing cannot be cleared until a relationship partner is assigned in Client Management.">
        Unassigned
      </span>
    );
  }
  const name = partner.name ?? 'Unnamed';
  if (!partner.active) {
    return (
      <span className="text-xs text-amber-600 dark:text-amber-400" title="This partner is no longer active — reassign the client in Client Management.">
        {name} (inactive)
      </span>
    );
  }
  return <span className="text-foreground">{name}</span>;
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(amount);
}

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
  sent: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  partial: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  paid: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
};

type ConfirmAction =
  | { kind: 'delete'; invoice: Invoice }
  | { kind: 'regenerate'; invoice: Invoice };

type SortKey = 'invoice_number' | 'client_name' | 'relationship_partner' | 'billing_month' | 'total_amount' | 'grand_total' | 'status' | 'created_at';

const STATUS_ORDER: Record<string, number> = { draft: 0, sent: 1, partial: 2, paid: 3 };

function sortValue(inv: Invoice, key: SortKey): string | number {
  switch (key) {
    case 'total_amount': return Number(inv.total_amount);
    case 'grand_total': return Number(inv.total_amount) + Number(inv.total_expenses);
    case 'status': return STATUS_ORDER[inv.status] ?? 99;
    case 'created_at': return inv.created_at ?? '';
    // Unassigned sorts last ascending — it's the exception finance wants to find.
    case 'relationship_partner': return inv.relationship_partner?.name?.toLowerCase() ?? '￿';
    default: return (inv[key] ?? '').toString().toLowerCase();
  }
}

const NO_INVOICES: Invoice[] = [];

export default function InvoiceList({ financeAddress }: { financeAddress: string }) {
  const { data, error: loadError, isLoading: loading, mutate } = useSWR<{ invoices?: Invoice[] }>('/api/finance/invoices', async (url: string) => {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`Failed to load invoices (${r.status})`);
    return r.json();
  });
  const invoices = data?.invoices ?? NO_INVOICES;
  const error = loadError ? (loadError instanceof Error ? loadError.message : 'Failed to load invoices') : null;
  const setInvoices = useCallback(
    (update: (prev: Invoice[]) => Invoice[]) =>
      mutate((d) => ({ ...d, invoices: update(d?.invoices ?? []) }), { revalidate: false }),
    [mutate],
  );
  const [previewFiles, setPreviewFiles] = useState<FileAttachment[] | null>(null);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [showBatchSend, setShowBatchSend] = useState(false);
  const [showBatchRegen, setShowBatchRegen] = useState(false);
  const [showOffCycle, setShowOffCycle] = useState(false);
  const [offCycleReload, setOffCycleReload] = useState(0);
  const [singleSendInvoiceId, setSingleSendInvoiceId] = useState<number | null>(null);
  const [editDatesInvoice, setEditDatesInvoice] = useState<Invoice | null>(null);
  const [paymentsInvoice, setPaymentsInvoice] = useState<Invoice | null>(null);
  const [confirm, setConfirm] = useState<ConfirmAction | null>(null);
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [monthFilter, setMonthFilter] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'created_at', dir: 'desc' });
  // Default the month filter to the latest available month on first load only —
  // a ref (not state) so a later refresh or an explicit "All months" pick sticks.
  const didDefaultMonth = useRef(false);

  const refresh = () => { void mutate(); };

  async function updateStatus(invoiceId: number, status: string) {
    const res = await fetch('/api/finance/invoices', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ invoiceId, status }),
    });
    if (res.ok) {
      setInvoices((prev) =>
        prev.map((inv) => (inv.id === invoiceId ? { ...inv, status } : inv)),
      );
    }
  }

  async function deleteInvoice(invoice: Invoice) {
    setPendingId(invoice.id);
    setActionError(null);
    try {
      const res = await fetch(`/api/finance/invoices?id=${invoice.id}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Failed to delete (${res.status})`);
      setInvoices((prev) => prev.filter((inv) => inv.id !== invoice.id));
      setConfirm(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setPendingId(null);
    }
  }

  async function regenerateInvoice(invoice: Invoice) {
    setPendingId(invoice.id);
    setActionError(null);
    try {
      const res = await fetch(`/api/finance/regenerate-invoice?id=${invoice.id}`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Failed to regenerate (${res.status})`);
      const updated = data.invoice;
      setInvoices((prev) =>
        prev.map((inv) => (inv.id === invoice.id ? { ...inv, ...updated } : inv)),
      );
      setConfirm(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Regenerate failed');
    } finally {
      setPendingId(null);
    }
  }

  function openPreview(inv: Invoice, fileIndex: number) {
    const files: FileAttachment[] = [];
    if (inv.docx_storage_path) {
      files.push({
        name: `${inv.invoice_number}.docx`,
        url: '',
        path: inv.docx_storage_path,
      });
    }
    if (inv.xlsx_storage_path) {
      files.push({
        name: `${inv.invoice_number}.xlsx`,
        url: '',
        path: inv.xlsx_storage_path,
      });
    }
    if (inv.breakdown_pdf_storage_path) {
      files.push({
        name: `${inv.invoice_number}-breakdown.pdf`,
        url: '',
        path: inv.breakdown_pdf_storage_path,
      });
    }
    setPreviewFiles(files);
    setPreviewIndex(fileIndex);
  }

  const availableMonths = useMemo(
    () => [...new Set(invoices.map((i) => i.billing_month).filter(Boolean))],
    [invoices],
  );

  // Months newest-first — drives both the default and the prev/next stepper.
  const sortedMonths = useMemo(
    () => [...availableMonths].sort((a, b) => b.localeCompare(a)),
    [availableMonths],
  );

  // On first load, land the user on the latest month rather than "All months".
  useEffect(() => {
    if (didDefaultMonth.current || sortedMonths.length === 0) return;
    didDefaultMonth.current = true;
    setMonthFilter(sortedMonths[0]);
  }, [sortedMonths]);

  const monthIdx = monthFilter ? sortedMonths.indexOf(monthFilter) : -1;
  // delta −1 = newer (toward index 0), +1 = older. From "All months", either
  // arrow lands on the latest month first.
  const stepMonth = (delta: number) => {
    if (sortedMonths.length === 0) return;
    if (monthIdx < 0) { setMonthFilter(sortedMonths[0]); return; }
    const next = Math.min(Math.max(monthIdx + delta, 0), sortedMonths.length - 1);
    setMonthFilter(sortedMonths[next]);
  };
  const canGoNewer = monthIdx !== 0;                              // already newest
  const canGoOlder = monthIdx < 0 || monthIdx < sortedMonths.length - 1; // already oldest

  const visibleInvoices = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = invoices.filter(
      (i) =>
        (!monthFilter || i.billing_month === monthFilter) &&
        (!q ||
          i.client_name.toLowerCase().includes(q) ||
          (i.relationship_partner?.name ?? '').toLowerCase().includes(q)),
    );
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const av = sortValue(a, sort.key);
      const bv = sortValue(b, sort.key);
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
  }, [invoices, monthFilter, search, sort]);

  // Roll-up for the visible set: what was billed (incl. VAT), collected, and
  // still open — via the canonical per-invoice amount helpers so these totals
  // agree with every other AR surface.
  const summary = useMemo(
    () =>
      visibleInvoices.reduce(
        (acc, inv) => {
          acc.total += invoiceGrossDue(inv);
          acc.paid += Number(inv.paid_amount ?? 0);
          acc.outstanding += invoiceOpenBalance(inv);
          return acc;
        },
        { total: 0, paid: 0, outstanding: 0 },
      ),
    [visibleInvoices],
  );

  const toggleSort = (key: SortKey) =>
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: key === 'created_at' || key === 'total_amount' || key === 'grand_total' ? 'desc' : 'asc' },
    );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-[var(--text-muted)]" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-foreground font-[family-name:var(--font-playfair)]">
          Invoices
        </h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowOffCycle(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold border border-[var(--border-color)] text-foreground bg-[var(--background)] hover:bg-[var(--subtle-bg)] hover:border-gold-300 dark:hover:border-gold-500/40 transition-all"
          >
            <FilePlus2 className="w-4 h-4 text-gold-500" />
            Off-cycle invoice
          </button>
          {invoices.length > 0 && (<>
            <button
              onClick={() => setShowBatchRegen(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold border border-[var(--border-color)] text-foreground bg-[var(--background)] hover:bg-[var(--subtle-bg)] hover:border-amber-300 dark:hover:border-amber-500/40 transition-all"
            >
              <RotateCcw className="w-4 h-4 text-amber-500" />
              Regenerate
            </button>
            <button
              onClick={() => setShowBatchSend(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-blue-600 hover:bg-blue-700 text-white transition-all"
            >
              <Send className="w-4 h-4" />
              Send Invoices
            </button>
          </>)}
        </div>
      </div>

      <OffCycleRequests mode="finance" reloadKey={offCycleReload} onInvoiceReady={refresh} />
      <OffCycleInvoiceModal
        open={showOffCycle}
        onClose={() => setShowOffCycle(false)}
        onSubmitted={() => setOffCycleReload((n) => n + 1)}
      />

      {invoices.length > 0 && !error && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 mb-4">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => stepMonth(1)}
              disabled={!canGoOlder}
              title="Previous (older) month"
              aria-label="Previous month"
              className="flex items-center justify-center w-9 h-9 rounded-lg border border-[var(--border-color)] bg-[var(--background)] text-[var(--text-secondary)] hover:border-gold-300 dark:hover:border-gold-500/40 hover:text-foreground disabled:opacity-40 disabled:pointer-events-none transition-colors cursor-pointer"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <MonthFilter months={availableMonths} value={monthFilter} onChange={setMonthFilter} />
            <button
              type="button"
              onClick={() => stepMonth(-1)}
              disabled={!canGoNewer}
              title="Next (newer) month"
              aria-label="Next month"
              className="flex items-center justify-center w-9 h-9 rounded-lg border border-[var(--border-color)] bg-[var(--background)] text-[var(--text-secondary)] hover:border-gold-300 dark:hover:border-gold-500/40 hover:text-foreground disabled:opacity-40 disabled:pointer-events-none transition-colors cursor-pointer"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-[var(--text-muted)] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search client or partner…"
              className="h-9 w-52 pl-8 pr-8 rounded-lg border border-[var(--border-color)] bg-[var(--background)] text-sm text-foreground placeholder:text-[var(--text-muted)] hover:border-gold-300 dark:hover:border-gold-500/40 focus:outline-none focus:ring-2 focus:ring-gold-400 transition-colors"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded text-[var(--text-muted)] hover:text-foreground cursor-pointer"
                aria-label="Clear search"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <span className="text-xs text-[var(--text-muted)]">
            {visibleInvoices.length} {visibleInvoices.length === 1 ? 'invoice' : 'invoices'}
            {monthFilter ? ' this month' : ''}
          </span>

          {/* Per-view roll-up (respects the month + search filters). */}
          <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
            <SummaryStat label="Total" value={formatCurrency(summary.total)} />
            <SummaryStat label="Paid" value={formatCurrency(summary.paid)} tone="paid" />
            <SummaryStat label="Outstanding" value={formatCurrency(summary.outstanding)} tone="due" />
          </div>
        </div>
      )}

      {error ? (
        <div className="text-center py-12 text-red-600 dark:text-red-400">
          <p className="text-sm">{error}</p>
          <button onClick={refresh} className="mt-2 text-xs underline">Retry</button>
        </div>
      ) : invoices.length === 0 ? (
        <div className="text-center py-12 text-[var(--text-muted)]">
          <p className="text-sm">No invoices generated yet.</p>
        </div>
      ) : visibleInvoices.length === 0 ? (
        <div className="text-center py-12 text-[var(--text-muted)]">
          <p className="text-sm">
            {search.trim()
              ? `No invoices match "${search.trim()}"${monthFilter ? ' this month' : ''}.`
              : 'No invoices for the selected month.'}
          </p>
          <button
            onClick={() => { setSearch(''); setMonthFilter(null); }}
            className="mt-2 text-xs underline"
          >
            Clear filters
          </button>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[var(--border-color)] bg-card shadow-[var(--shadow-card)]">
          <table className="w-full border-collapse">
            <thead>
              <tr className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                <SortableTh label="Invoice #" sortKey="invoice_number" sort={sort} onSort={toggleSort} className="text-left px-4" />
                <SortableTh label="Client" sortKey="client_name" sort={sort} onSort={toggleSort} className="text-left px-3" />
                <SortableTh label="Rel. Partner" sortKey="relationship_partner" sort={sort} onSort={toggleSort} className="text-left px-3" />
                <SortableTh label="Month" sortKey="billing_month" sort={sort} onSort={toggleSort} className="text-left px-3" />
                <SortableTh label="Fees" sortKey="total_amount" sort={sort} onSort={toggleSort} align="right" className="px-3" />
                <th className="text-right px-3 py-3 border-b border-[var(--border-color)]">Expenses</th>
                <SortableTh label="Total" sortKey="grand_total" sort={sort} onSort={toggleSort} align="right" className="px-3" />
                <SortableTh label="Status" sortKey="status" sort={sort} onSort={toggleSort} align="center" className="px-3" />
                <th className="text-right px-4 py-3 border-b border-[var(--border-color)]">Files</th>
              </tr>
            </thead>
            <tbody>
              {visibleInvoices.map((inv) => (
                <tr key={inv.id} className="hover:bg-[var(--subtle-bg)] transition-colors">
                  <td className="px-4 py-3 text-sm font-medium text-foreground border-b border-[var(--border-color)]">
                    <span className="inline-flex items-center gap-1.5">
                      {inv.invoice_number}
                      {inv.invoice_kind === 'off_cycle' && (
                        <span
                          title="Fee-only invoice issued between monthly runs"
                          className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider bg-violet-100 text-violet-700 border border-violet-200 dark:bg-violet-500/15 dark:text-violet-300 dark:border-violet-500/30"
                        >
                          Off-cycle
                        </span>
                      )}
                      {(inv.revision_count ?? 0) > 0 && (
                        <span
                          title={inv.previously_sent_at ? `Originally sent on ${inv.previously_sent_at}` : 'Revised'}
                          className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider bg-amber-100 text-amber-700 border border-amber-200 dark:bg-amber-500/15 dark:text-amber-400 dark:border-amber-500/30"
                        >
                          Revised{(inv.revision_count ?? 0) > 1 ? ` ×${inv.revision_count}` : ''}
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-sm text-foreground border-b border-[var(--border-color)]">
                    {inv.client_name}
                  </td>
                  <td className="px-3 py-3 text-sm border-b border-[var(--border-color)]">
                    <RelationshipPartnerCell partner={inv.relationship_partner} />
                  </td>
                  <td className="px-3 py-3 text-sm text-[var(--text-secondary)] border-b border-[var(--border-color)]">
                    {inv.billing_month}
                  </td>
                  <td className="px-3 py-3 text-sm text-foreground text-right border-b border-[var(--border-color)]">
                    {formatCurrency(Number(inv.total_amount))}
                  </td>
                  <td className="px-3 py-3 text-sm text-foreground text-right border-b border-[var(--border-color)]">
                    {formatCurrency(Number(inv.total_expenses))}
                  </td>
                  <td className="px-3 py-3 text-sm font-medium text-foreground text-right border-b border-[var(--border-color)]">
                    {formatCurrency(Number(inv.total_amount) + Number(inv.total_expenses))}
                  </td>
                  <td className="px-3 py-3 text-center border-b border-[var(--border-color)]">
                    <select
                      value={inv.status}
                      onChange={(e) => updateStatus(inv.id, e.target.value)}
                      className={`text-xs font-medium px-2.5 py-1 rounded-full border-0 cursor-pointer focus:outline-none focus:ring-2 focus:ring-gold-400 appearance-none pr-5 ${STATUS_COLORS[inv.status] ?? ''}`}
                      style={{
                        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`,
                        backgroundRepeat: 'no-repeat',
                        backgroundPosition: 'right 5px center',
                      }}
                    >
                      <option value="draft">Draft</option>
                      <option value="sent">Sent</option>
                      <option value="partial">Partial</option>
                      <option value="paid">Paid</option>
                    </select>
                    {inv.status !== 'draft' && (
                      <button
                        type="button"
                        onClick={() => setPaymentsInvoice(inv)}
                        className="block mx-auto mt-1 text-[10px] text-[var(--text-muted)] hover:text-gold-600 dark:hover:text-gold-400 underline-offset-2 hover:underline cursor-pointer"
                        title="View / undo payments on this invoice"
                      >
                        payments
                      </button>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right border-b border-[var(--border-color)]">
                    <InvoiceRowActions
                      inv={inv}
                      busy={pendingId === inv.id}
                      onPreview={(idx) => openPreview(inv, idx)}
                      onSend={() => setSingleSendInvoiceId(inv.id)}
                      onEditDates={() => setEditDatesInvoice(inv)}
                      onRegenerate={() => { setActionError(null); setConfirm({ kind: 'regenerate', invoice: inv }); }}
                      onDelete={() => { setActionError(null); setConfirm({ kind: 'delete', invoice: inv }); }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <InvoicePaymentsModal
        open={paymentsInvoice !== null}
        invoice={paymentsInvoice}
        onClose={() => setPaymentsInvoice(null)}
        onChanged={refresh}
      />
      <FilePreviewModal
        open={previewFiles !== null}
        onClose={() => setPreviewFiles(null)}
        files={previewFiles ?? undefined}
        initialIndex={previewIndex}
      />
      <BatchSendModal
        financeAddress={financeAddress}
        open={showBatchSend}
        onClose={() => setShowBatchSend(false)}
        invoices={invoices.filter((inv) => inv.status === 'draft' || inv.status === 'sent')}
        onSent={() => {
          setShowBatchSend(false);
          refresh();
        }}
      />
      <BatchRegenerateModal
        open={showBatchRegen}
        onClose={() => setShowBatchRegen(false)}
        invoices={invoices}
        initialMonth={monthFilter}
        onRegenerated={(updated) =>
          setInvoices((prev) =>
            prev.map((inv) => (inv.id === updated.id ? { ...inv, ...updated } : inv)),
          )
        }
      />

      {/* Single-invoice send — reuses the batch flow but scoped to one row.
          BatchSendModal auto-skips the "select invoices" step when given a
          single-element array (see useEffect in BatchSendModal). */}
      <BatchSendModal
        financeAddress={financeAddress}
        open={singleSendInvoiceId !== null}
        onClose={() => setSingleSendInvoiceId(null)}
        invoices={singleSendInvoiceId !== null
          ? invoices.filter((inv) => inv.id === singleSendInvoiceId)
          : []
        }
        onSent={() => {
          setSingleSendInvoiceId(null);
          refresh();
        }}
      />
      <EditInvoiceDatesModal
        open={editDatesInvoice !== null}
        onClose={() => setEditDatesInvoice(null)}
        invoice={editDatesInvoice}
        onSaved={(updated) =>
          setInvoices((prev) =>
            prev.map((inv) => (inv.id === updated.id ? { ...inv, sent_date: updated.sent_date, due_date: updated.due_date } : inv)),
          )
        }
      />
      {confirm && (
        <ConfirmModal
          confirm={confirm}
          pending={pendingId === confirm.invoice.id}
          error={actionError}
          onCancel={() => { setConfirm(null); setActionError(null); }}
          onConfirm={() => {
            if (confirm.kind === 'delete') deleteInvoice(confirm.invoice);
            else regenerateInvoice(confirm.invoice);
          }}
        />
      )}
    </div>
  );
}

function SummaryStat({ label, value, tone }: { label: string; value: string; tone?: 'paid' | 'due' }) {
  const valueCls =
    tone === 'paid'
      ? 'text-emerald-600 dark:text-emerald-400'
      : tone === 'due'
        ? 'text-amber-600 dark:text-amber-400'
        : 'text-foreground';
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-[var(--text-muted)] uppercase tracking-wider text-[10px]">{label}</span>
      <span className={`font-semibold tabular-nums ${valueCls}`}>{value}</span>
    </span>
  );
}

function SortableTh({
  label, sortKey, sort, onSort, align = 'left', className = '',
}: {
  label: string;
  sortKey: SortKey;
  sort: { key: SortKey; dir: 'asc' | 'desc' };
  onSort: (key: SortKey) => void;
  align?: 'left' | 'right' | 'center';
  className?: string;
}) {
  const active = sort.key === sortKey;
  const alignCls = align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left';
  const justifyCls = align === 'right' ? 'justify-end' : align === 'center' ? 'justify-center' : 'justify-start';
  return (
    <th className={`py-3 border-b border-[var(--border-color)] ${alignCls} ${className}`}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`inline-flex items-center gap-1 uppercase tracking-wider transition-colors cursor-pointer hover:text-foreground ${justifyCls} ${active ? 'text-foreground' : ''}`}
      >
        {label}
        {active
          ? (sort.dir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)
          : <ChevronDown className="w-3 h-3 opacity-25" />}
      </button>
    </th>
  );
}

function ConfirmModal({
  confirm, pending, error, onCancel, onConfirm,
}: {
  confirm: ConfirmAction;
  pending: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const inv = confirm.invoice;
  const isDelete = confirm.kind === 'delete';
  const isSentOrPaid = inv.status !== 'draft';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm animate-fade-in">
      <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] shadow-xl w-full max-w-md mx-4">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-color)]">
          <h2 className="text-sm font-semibold text-foreground">
            {isDelete ? 'Delete draft invoice?' : 'Regenerate invoice?'}
          </h2>
          <button onClick={onCancel} className="p-1 rounded-lg hover:bg-subtle cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div className="bg-subtle rounded-lg p-3 space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-[var(--text-muted)]">Invoice</span>
              <span className="font-medium text-foreground">{inv.invoice_number}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-[var(--text-muted)]">Client</span>
              <span className="text-[var(--text-secondary)]">{inv.client_name}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-[var(--text-muted)]">Month</span>
              <span className="text-[var(--text-secondary)]">{inv.billing_month}</span>
            </div>
          </div>

          {isDelete ? (
            <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
              {inv.invoice_kind === 'off_cycle'
                ? 'The files will be removed from storage, and its fees become available to bill again — on the monthly invoice or a new off-cycle request. This action cannot be undone.'
                : 'The DOCX, XLSX, and PDF files will be removed from storage, and the underlying DTR entries and expenses will be unflagged so they appear in the next bundle. This action cannot be undone.'}
            </p>
          ) : (
            <>
              <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                {inv.invoice_kind === 'off_cycle'
                  ? 'The files will be rebuilt with the same approved fees and the latest letter details from the matter, and the invoice number stays the same. No time or expenses are added.'
                  : 'The latest DTRs and expenses for this client and month will be pulled in, the files will be rebuilt with the same settings as the original generation, and the invoice number stays the same.'}
              </p>
              {isSentOrPaid && (
                <div className="flex gap-2 rounded-lg bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 p-3 text-xs text-amber-800 dark:text-amber-300">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <div>
                    This invoice is <strong>{inv.status}</strong>. Regenerating will revert it to <strong>draft</strong>{' '}
                    and clear the sent date — finance must re-send the new version explicitly.
                  </div>
                </div>
              )}
            </>
          )}

          {error && (
            <div className="rounded-lg bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 p-2.5 text-[11px] text-red-700 dark:text-red-400">
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-[var(--border-color)]">
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="px-4 py-2 text-xs font-medium rounded-lg bg-subtle text-[var(--text-secondary)] hover:bg-stone-100 dark:hover:bg-stone-800 border border-[var(--border-color)] disabled:opacity-50 cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending}
            className={`px-4 py-2 text-xs font-medium rounded-lg text-white disabled:opacity-50 cursor-pointer flex items-center gap-1.5 ${
              isDelete
                ? 'bg-red-600 hover:bg-red-700'
                : 'bg-amber-600 hover:bg-amber-700'
            }`}
          >
            {pending && <Loader2 className="w-3 h-3 animate-spin" />}
            {isDelete ? 'Delete invoice' : 'Regenerate'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Row actions ───────────────────────────────────────────────────────

/**
 * Compact row-action layout: a "Preview" CTA + a contextual "Send" CTA, and
 * a kebab menu for everything else (other previews, downloads, regenerate,
 * delete). Replaces the prior icon-soup row that didn't read as clickable.
 */
function InvoiceRowActions({
  inv,
  busy,
  onPreview,
  onSend,
  onEditDates,
  onRegenerate,
  onDelete,
}: {
  inv: Invoice;
  busy: boolean;
  /** Open the preview modal at the index of the file (0=docx, 1=xlsx, 2=breakdown PDF — or shifted when some are missing). */
  onPreview: (index: number) => void;
  onSend: () => void;
  onEditDates: () => void;
  onRegenerate: () => void;
  onDelete: () => void;
}) {
  // Compute the file order so menu items map to the right preview index.
  const order: Array<{ key: 'docx' | 'xlsx' | 'breakdown'; path: string | null }> = [
    { key: 'docx', path: inv.docx_storage_path },
    { key: 'xlsx', path: inv.xlsx_storage_path },
    { key: 'breakdown', path: inv.breakdown_pdf_storage_path },
  ].filter((f) => !!f.path) as Array<{ key: 'docx' | 'xlsx' | 'breakdown'; path: string }>;
  const indexOf = (key: 'docx' | 'xlsx' | 'breakdown') => order.findIndex((f) => f.key === key);

  const canSend = inv.status === 'draft' || inv.status === 'sent';

  const items: ActionMenuItem[] = [];

  // Preview submenu (the primary "Preview" button opens the letter; these
  // give quick access to the other two when present).
  if (inv.breakdown_pdf_storage_path) {
    items.push({
      label: 'Preview Breakdown PDF',
      icon: BookOpen,
      onClick: () => onPreview(indexOf('breakdown')),
    });
  }
  if (inv.xlsx_storage_path) {
    items.push({
      label: 'Preview Breakdown (Excel)',
      icon: FileSpreadsheet,
      onClick: () => onPreview(indexOf('xlsx')),
    });
  }

  // Download group
  if (inv.docx_storage_path) {
    items.push({
      label: 'Download Letter (.docx)',
      icon: Download,
      onClick: () => downloadFromStorage(inv.docx_storage_path!, `${inv.invoice_number}.docx`),
      divider: items.length > 0,
    });
  }
  if (inv.breakdown_pdf_storage_path) {
    items.push({
      label: 'Download Breakdown PDF',
      icon: Download,
      onClick: () => downloadFromStorage(inv.breakdown_pdf_storage_path!, `${inv.invoice_number}-breakdown.pdf`),
    });
  }
  if (inv.xlsx_storage_path) {
    items.push({
      label: 'Download Excel',
      icon: Download,
      onClick: () => downloadFromStorage(inv.xlsx_storage_path!, `${inv.invoice_number}.xlsx`),
    });
  }

  // Maintenance group
  if (inv.status !== 'draft') {
    items.push({
      label: 'Edit dates',
      icon: CalendarClock,
      onClick: onEditDates,
      divider: true,
    });
  }
  items.push({
    label: 'Regenerate',
    icon: RotateCcw,
    onClick: onRegenerate,
    variant: 'warning',
    disabled: busy,
    divider: inv.status === 'draft',
  });
  if (inv.status === 'draft') {
    items.push({
      label: 'Delete draft',
      icon: Trash2,
      onClick: onDelete,
      variant: 'danger',
      disabled: busy,
    });
  }

  return (
    <div className="flex items-center justify-end gap-1.5">
      {inv.docx_storage_path && (
        <button
          type="button"
          onClick={() => onPreview(indexOf('docx'))}
          className="action-lift inline-flex items-center gap-1.5 px-2.5 h-7 rounded-md border border-[var(--border-color)] text-xs font-medium text-foreground bg-[var(--background)] hover:bg-[var(--subtle-bg)] hover:border-gold-300 dark:hover:border-gold-500/30 transition-colors cursor-pointer"
        >
          <Eye className="w-3.5 h-3.5 text-blue-500" />
          Preview
        </button>
      )}
      {canSend && (
        <button
          type="button"
          onClick={onSend}
          className="action-lift inline-flex items-center gap-1.5 px-2.5 h-7 rounded-md border border-indigo-200/60 dark:border-indigo-500/30 text-xs font-medium text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-500/10 hover:bg-indigo-100 dark:hover:bg-indigo-500/20 transition-colors cursor-pointer"
          title={inv.status === 'sent' ? 'Re-send invoice' : 'Send invoice'}
        >
          <Send className="w-3.5 h-3.5" />
          {inv.status === 'sent' ? 'Re-send' : 'Send'}
        </button>
      )}
      <RowActionMenu items={items} label={`Actions for invoice ${inv.invoice_number}`} compact />
    </div>
  );
}
