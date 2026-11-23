'use client';

import { useState, useEffect, useRef } from 'react';
import { X, Loader2, AlertTriangle, Eye, Download } from 'lucide-react';
import FilePreviewModal from '@/components/FilePreviewModal';
import { downloadFile } from '@/lib/download-file';
import { fmt, fmtPct } from '@/lib/finance/format';
import type { FileAttachment } from '@/types/notion';

interface BilledLine {
  id: number;
  invoiceNumber: string;
  clientName: string;
  matterName: string | null;
  status: string;
  billed: number;
  paid: number;
  outstanding: number;
  collectionRate: number;
  breakdownPdfPath: string | null;
}
interface CashFlowDetail {
  period: string;
  totalBilled: number;
  totalPaid: number;
  totalOutstanding: number;
  collectionRate: number;
  invoices: BilledLine[];
}

interface Props {
  period: string; // YYYY-MM or YYYY
  periodLabel: string;
  onClose: () => void;
}

const cardCls = 'bg-white rounded-xl border border-stone-200/70 shadow-[var(--shadow-card)] dark:bg-stone-900 dark:border-stone-700/70';

/** Color-tiered collection-rate badge: 100 emerald · >0 amber · 0 stone. */
function rateTone(pct: number): string {
  if (pct >= 100) return 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400';
  if (pct > 0) return 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400';
  return 'bg-stone-100 text-stone-500 dark:bg-stone-800 dark:text-stone-400';
}

function breakdownFile(inv: BilledLine): FileAttachment | null {
  if (!inv.breakdownPdfPath) return null;
  return { name: `${inv.invoiceNumber}-breakdown.pdf`, url: '', path: inv.breakdownPdfPath };
}

export default function CashFlowDetailPanel({ period, periodLabel, onClose }: Props) {
  const [data, setData] = useState<CashFlowDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [previewFiles, setPreviewFiles] = useState<FileAttachment[] | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLoading(true);
    setError('');
    setData(null);
    fetch(`/api/finance/cash-flow/detail?period=${encodeURIComponent(period)}`)
      .then((r) => { if (!r.ok) throw new Error(`Failed to load (${r.status})`); return r.json(); })
      .then((d: CashFlowDetail) => setData(d))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, [period]);

  useEffect(() => { ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, [period]);

  const preview = (inv: BilledLine) => {
    const f = breakdownFile(inv);
    if (f) setPreviewFiles([f]);
  };
  const download = (inv: BilledLine) => {
    const f = breakdownFile(inv);
    if (f) downloadFile(f);
  };

  return (
    <div ref={ref} className={`${cardCls} scroll-mt-4`}>
      <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-color)]">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Collection rate · {periodLabel}</h3>
          <p className="text-[11px] text-[var(--text-muted)] mt-0.5">How much of each billing the client has paid</p>
        </div>
        <button type="button" onClick={onClose} className="p-1 rounded-lg hover:bg-subtle cursor-pointer" aria-label="Close">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="px-5 py-5">
        {loading ? (
          <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-[var(--text-muted)]" /></div>
        ) : error ? (
          <div className="flex items-center gap-2 rounded-lg border border-red-200 dark:border-red-500/30 bg-red-50/60 dark:bg-red-500/5 px-4 py-3 text-sm text-red-700 dark:text-red-400">
            <AlertTriangle className="w-4 h-4 shrink-0" /> {error}
          </div>
        ) : data && data.invoices.length === 0 ? (
          <p className="text-xs text-[var(--text-muted)] py-6 text-center">No invoices billed this period.</p>
        ) : data ? (
          <>
            {/* Month summary */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
              <Stat label="Billed" value={fmt(data.totalBilled)} />
              <Stat label="Collected" value={fmt(data.totalPaid)} tone="emerald" />
              <Stat label="Outstanding" value={fmt(data.totalOutstanding)} tone={data.totalOutstanding > 0 ? 'amber' : undefined} />
              <Stat label="Collection rate" value={fmtPct(data.collectionRate)} tone={data.collectionRate >= 100 ? 'emerald' : 'amber'} />
            </div>

            {/* Per-invoice table */}
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] border-b border-[var(--border-color)]">
                    <th className="text-left font-semibold py-2 pr-3">Client / Invoice</th>
                    <th className="text-right font-semibold py-2 px-3">Billed</th>
                    <th className="text-right font-semibold py-2 px-3">Paid</th>
                    <th className="text-right font-semibold py-2 px-3">Collected</th>
                    <th className="w-[52px] py-2 pl-3" />
                  </tr>
                </thead>
                <tbody>
                  {data.invoices.map((it) => (
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
                        <span className={`inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded-full tabular-nums ${rateTone(it.collectionRate)}`}>
                          {fmtPct(it.collectionRate, 0)}
                        </span>
                      </td>
                      <td className="py-2.5 pl-3">
                        {it.breakdownPdfPath ? (
                          <div className="flex items-center gap-1 justify-end">
                            <button
                              type="button"
                              onClick={() => preview(it)}
                              title={`Preview breakdown · ${it.invoiceNumber}`}
                              className="p-1 rounded-md text-[var(--text-muted)] hover:text-foreground hover:bg-subtle cursor-pointer"
                            >
                              <Eye className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => download(it)}
                              title={`Download breakdown · ${it.invoiceNumber}`}
                              className="p-1 rounded-md text-[var(--text-muted)] hover:text-foreground hover:bg-subtle cursor-pointer"
                            >
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
          </>
        ) : null}
      </div>

      <FilePreviewModal
        open={previewFiles !== null}
        onClose={() => setPreviewFiles(null)}
        files={previewFiles ?? undefined}
        initialIndex={0}
      />
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'emerald' | 'amber' }) {
  const toneCls = tone === 'emerald'
    ? 'text-emerald-600 dark:text-emerald-400'
    : tone === 'amber'
      ? 'text-amber-600 dark:text-amber-400'
      : 'text-foreground';
  return (
    <div className="bg-subtle rounded-lg px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">{label}</p>
      <p className={`text-base font-semibold tabular-nums mt-0.5 ${toneCls}`}>{value}</p>
    </div>
  );
}
