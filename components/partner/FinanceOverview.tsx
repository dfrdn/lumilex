'use client';

import { useState, useEffect, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { Loader2, TrendingUp, Wallet, Percent, Receipt, AlertTriangle, Eye, Download, X } from 'lucide-react';
import SingleSelect from '@/components/finance/SingleSelect';
import FilePreviewModal from '@/components/FilePreviewModal';
import { downloadFile } from '@/lib/download-file';
import { fmt, signed, fmtPct, formatManilaDate } from '@/lib/finance/format';
import type { FileAttachment } from '@/types/notion';

const FinanceOverviewChart = dynamic(() => import('./FinanceOverviewChart'), {
  ssr: false,
  loading: () => <div className="h-full rounded-lg skeleton-shimmer" />,
});

type Timing = 'early' | 'on_time' | 'delayed';
export interface Month { month: string; billed: number; collected: number; collectionRate: number | null; opex: number }
interface Totals { billed: number; collected: number; collectionRate: number; opex: number; net: number }
interface InvoiceDetail {
  id: number;
  invoiceNumber: string;
  clientName: string;
  matterName: string | null;
  month: string;
  status: string;
  billed: number;
  paid: number;
  outstanding: number;
  collectionRate: number;
  billedDate: string | null;
  paidDate: string | null;
  fullyPaid: boolean;
  daysToPay: number | null;
  timing: Timing | null;
  daysSincePayment: number | null;
  breakdownPdfPath: string | null;
}
interface Response { months: Month[]; totals: Totals; invoices: InvoiceDetail[]; clients: string[] }

const TIMING_LABEL: Record<Timing, string> = { early: 'Early', on_time: 'On time', delayed: 'Delayed' };
const TIMING_TONE: Record<Timing, string> = {
  early: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400',
  on_time: 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400',
  delayed: 'bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-400',
};

function breakdownFile(inv: InvoiceDetail): FileAttachment | null {
  if (!inv.breakdownPdfPath) return null;
  return { name: `${inv.invoiceNumber}-breakdown.pdf`, url: '', path: inv.breakdownPdfPath };
}

interface Props { clients: string[]; currentMonth: string } // currentMonth: 'YYYY-MM' (Asia/Manila)

type RangeId = 'this-month' | '3m' | '6m' | '12m' | 'ytd' | 'all';

const RANGE_OPTIONS = [
  { id: '3m', label: 'Last 3 months' },
  { id: '6m', label: 'Last 6 months' },
  { id: '12m', label: 'Last 12 months' },
  { id: 'ytd', label: 'Year to date' },
  { id: 'this-month', label: 'This month' },
  { id: 'all', label: 'All time' },
];

function addMonths(yyyymm: string, delta: number): string {
  const [y, m] = yyyymm.split('-').map(Number);
  const idx = y * 12 + (m - 1) + delta;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
}

function rangeToBounds(range: RangeId, current: string): { from: string; to: string } {
  const year = current.slice(0, 4);
  switch (range) {
    case 'this-month': return { from: current, to: current };
    case '3m': return { from: addMonths(current, -2), to: current };
    case '12m': return { from: addMonths(current, -11), to: current };
    case 'ytd': return { from: `${year}-01`, to: current };
    case 'all': return { from: '2026-01', to: current };
    case '6m':
    default: return { from: addMonths(current, -5), to: current };
  }
}


export default function FinanceOverview({ clients, currentMonth }: Props) {
  const [range, setRange] = useState<RangeId>('6m');
  const [client, setClient] = useState<string>('all');
  const [data, setData] = useState<Response | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [previewFiles, setPreviewFiles] = useState<FileAttachment[] | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);

  const clientOptions = useMemo(
    () => [{ id: 'all', label: 'All clients' }, ...clients.map((c) => ({ id: c, label: c }))],
    [clients],
  );

  const { from, to } = useMemo(() => rangeToBounds(range, currentMonth), [range, currentMonth]);

  useEffect(() => {
    setLoading(true);
    setError('');
    setSelectedMonth(null);
    const qs = new URLSearchParams({ from, to });
    if (client !== 'all') qs.set('client', client);
    fetch(`/api/partner/finance-overview?${qs.toString()}`)
      .then((r) => { if (!r.ok) throw new Error(`Failed to load (${r.status})`); return r.json(); })
      .then((d: Response) => setData(d))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, [from, to, client]);

  const totals = data?.totals;
  const clientLabel = client === 'all' ? 'All clients' : client;

  const preview = (inv: InvoiceDetail) => { const f = breakdownFile(inv); if (f) setPreviewFiles([f]); };
  const download = (inv: InvoiceDetail) => { const f = breakdownFile(inv); if (f) downloadFile(f); };

  // Click a chart bar to drill the invoice table into that month; click it again to clear.
  const onMonthClick = (m: string) => setSelectedMonth((prev) => (prev === m ? null : m));

  const monthLabel = (m: string) => formatManilaDate(`${m}-01`, { year: 'numeric', month: 'long' });
  const visibleInvoices = selectedMonth
    ? (data?.invoices ?? []).filter((i) => i.month === selectedMonth)
    : (data?.invoices ?? []);

  return (
    <div>
      <div className="flex flex-wrap items-end gap-4 mb-6">
        <div>
          <label className="block text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-wider mb-1.5">Period</label>
          <SingleSelect value={range} options={RANGE_OPTIONS} placeholder="Period" onChange={(v) => { if (v) setRange(v as RangeId); }} />
        </div>
        <div className="min-w-[220px]">
          <label className="block text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-wider mb-1.5">Client</label>
          <SingleSelect value={client} options={clientOptions} placeholder="All clients" onChange={(v) => setClient(v || 'all')} />
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-[var(--text-muted)]" /></div>
      ) : error ? (
        <div className="flex items-center gap-2 rounded-xl border border-red-200 dark:border-red-500/30 bg-red-50/60 dark:bg-red-500/5 px-4 py-3 text-sm text-red-700 dark:text-red-400">
          <AlertTriangle className="w-4 h-4 shrink-0" /> {error}
        </div>
      ) : totals ? (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-6">
            <SummaryCard icon={Receipt} label="Billed" value={fmt(totals.billed)} />
            <SummaryCard icon={Wallet} label="Collected" value={fmt(totals.collected)} tone="emerald" />
            <SummaryCard icon={Percent} label="Collection rate" value={fmtPct(totals.collectionRate)} tone={totals.collectionRate >= 100 ? 'emerald' : 'amber'} />
            <SummaryCard icon={Receipt} label="Operating expenses" value={fmt(totals.opex)} tone="rose" />
            <SummaryCard icon={TrendingUp} label="Collected − Opex" value={signed(totals.net)} tone={totals.net >= 0 ? 'emerald' : 'rose'} />
          </div>

          <div className="bg-white rounded-xl border border-stone-200/70 shadow-[var(--shadow-card)] p-4 sm:p-5 dark:bg-stone-900 dark:border-stone-700/70">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-semibold text-stone-700 dark:text-stone-200">Collection vs operating expenses</h3>
                <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">Click a bar to drill into that month</span>
              </div>
              <span className="text-[11px] text-[var(--text-muted)]">{clientLabel}</span>
            </div>
            <div className="h-72 sm:h-80">
              <FinanceOverviewChart months={data.months} onMonthClick={onMonthClick} />
            </div>
            {client !== 'all' && (
              <p className="text-[11px] text-[var(--text-muted)] mt-3">
                Operating expenses are firm-wide; the collection bars and rate reflect {clientLabel} only.
              </p>
            )}
          </div>

          {/* Per-invoice breakdown with payment timing */}
          <div className="bg-white rounded-xl border border-stone-200/70 shadow-[var(--shadow-card)] p-4 sm:p-5 mt-4 dark:bg-stone-900 dark:border-stone-700/70">
            <div className="flex items-start justify-between gap-3 mb-1">
              <h3 className="text-sm font-semibold text-stone-700 dark:text-stone-200">
                Invoices &amp; payment timing
                {selectedMonth && <span className="text-[var(--text-muted)] font-normal"> · {monthLabel(selectedMonth)}</span>}
              </h3>
              {selectedMonth && (
                <button
                  type="button"
                  onClick={() => setSelectedMonth(null)}
                  className="shrink-0 inline-flex items-center gap-1 text-[11px] font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 cursor-pointer"
                >
                  <X className="w-3 h-3" /> All months
                </button>
              )}
            </div>
            <p className="text-[11px] text-[var(--text-muted)] mb-4">
              Early ≤ 7 days · On time ≤ 15 days · Delayed &gt; 15 days, from billing to full payment.
            </p>
            {visibleInvoices.length === 0 ? (
              <p className="text-xs text-[var(--text-muted)] py-6 text-center">No invoices billed in this period.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] border-b border-[var(--border-color)]">
                      <th className="text-left font-semibold py-2 pr-3">Client / Invoice</th>
                      <th className="text-right font-semibold py-2 px-3">Billed</th>
                      <th className="text-right font-semibold py-2 px-3">Paid</th>
                      <th className="text-right font-semibold py-2 px-3">Collected</th>
                      <th className="text-left font-semibold py-2 px-3">Payment</th>
                      <th className="w-[52px] py-2 pl-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {visibleInvoices.map((it) => (
                      <tr key={it.id} className="border-b border-[var(--border-color)] last:border-0">
                        <td className="py-2.5 pr-3 min-w-0">
                          <p className="font-medium text-foreground truncate">{it.clientName}</p>
                          <p className="text-[11px] text-[var(--text-muted)] truncate">
                            {it.invoiceNumber}{it.matterName ? ` · ${it.matterName}` : ''}
                          </p>
                        </td>
                        <td className="py-2.5 px-3 text-right tabular-nums text-foreground whitespace-nowrap">{fmt(it.billed)}</td>
                        <td className="py-2.5 px-3 text-right tabular-nums whitespace-nowrap text-emerald-600 dark:text-emerald-400">{fmt(it.paid)}</td>
                        <td className="py-2.5 px-3 text-right whitespace-nowrap">
                          <span className="text-[11px] tabular-nums text-[var(--text-muted)]">{fmtPct(it.collectionRate, 0)}</span>
                        </td>
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          <PaymentCell inv={it} />
                        </td>
                        <td className="py-2.5 pl-3">
                          {it.breakdownPdfPath ? (
                            <div className="flex items-center gap-1 justify-end">
                              <button type="button" onClick={() => preview(it)} title={`Preview breakdown · ${it.invoiceNumber}`}
                                className="p-1 rounded-md text-[var(--text-muted)] hover:text-foreground hover:bg-subtle cursor-pointer">
                                <Eye className="w-3.5 h-3.5" />
                              </button>
                              <button type="button" onClick={() => download(it)} title={`Download breakdown · ${it.invoiceNumber}`}
                                className="p-1 rounded-md text-[var(--text-muted)] hover:text-foreground hover:bg-subtle cursor-pointer">
                                <Download className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <FilePreviewModal
            open={previewFiles !== null}
            onClose={() => setPreviewFiles(null)}
            files={previewFiles ?? undefined}
            initialIndex={0}
          />
        </>
      ) : null}
    </div>
  );
}

/** Payment-timing cell: a paid invoice shows its date + early/on-time/delayed;
 *  an open one shows how much is still due and how long since the last payment. */
function PaymentCell({ inv }: { inv: InvoiceDetail }) {
  if (inv.fullyPaid) {
    return (
      <div className="flex flex-col gap-0.5">
        {inv.timing ? (
          <span className={`inline-block w-fit text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${TIMING_TONE[inv.timing]}`}>
            {TIMING_LABEL[inv.timing]}{inv.daysToPay != null ? ` · ${inv.daysToPay}d` : ''}
          </span>
        ) : (
          <span className="inline-block w-fit text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400">Paid</span>
        )}
        {inv.paidDate && <span className="text-[10px] text-[var(--text-muted)]">Paid {formatManilaDate(inv.paidDate)}</span>}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] font-semibold tabular-nums text-rose-600 dark:text-rose-400">{fmt(inv.outstanding)} due</span>
      {inv.daysSincePayment != null && (
        <span className="text-[10px] text-[var(--text-muted)]">
          {inv.paidDate ? `${inv.daysSincePayment}d since last payment` : `${inv.daysSincePayment}d since billed`}
        </span>
      )}
    </div>
  );
}

function SummaryCard({
  icon: Icon, label, value, tone,
}: {
  icon: typeof TrendingUp;
  label: string;
  value: string;
  tone?: 'emerald' | 'rose' | 'amber';
}) {
  const toneCls = tone === 'emerald' ? 'text-emerald-600 dark:text-emerald-400'
    : tone === 'rose' ? 'text-rose-600 dark:text-rose-400'
      : tone === 'amber' ? 'text-amber-600 dark:text-amber-400'
        : 'text-foreground';
  return (
    <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] p-4 shadow-[var(--shadow-card)]">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1">
        <Icon className="w-3.5 h-3.5" />
        {label}
      </div>
      <p className={`text-xl font-semibold tabular-nums ${toneCls}`}>{value}</p>
    </div>
  );
}
