'use client';

import { useState, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Loader2, Download } from 'lucide-react';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

interface Props {
  open: boolean;
  onClose: () => void;
  /** Default year for the start selector */
  defaultYear: number;
  /** Default month (0-indexed) for the start selector */
  defaultMonth: number;
}

export default function ExportPdfModal({ open, onClose, defaultYear, defaultMonth }: Props) {
  const [startYear, setStartYear] = useState(defaultYear);
  const [startMonth, setStartMonth] = useState(defaultMonth);
  const [endYear, setEndYear] = useState(defaultYear);
  const [endMonth, setEndMonth] = useState(defaultMonth);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset when opening
  useEffect(() => {
    if (open) {
      setStartYear(defaultYear);
      setStartMonth(defaultMonth);
      setEndYear(defaultYear);
      setEndMonth(defaultMonth);
      setError(null);
      setLoading(false);
    }
  }, [open, defaultYear, defaultMonth]);

  const totalMonths = (endYear - startYear) * 12 + (endMonth - startMonth) + 1;
  const isValid = totalMonths >= 1 && totalMonths <= 12;

  const handleExport = useCallback(async () => {
    if (!isValid) return;
    setLoading(true);
    setError(null);
    try {
      const url = `/api/firm-calendar/export-pdf?startYear=${startYear}&startMonth=${startMonth}&endYear=${endYear}&endMonth=${endMonth}`;
      const res = await fetch(url);
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `Export failed (${res.status})`);
      }
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `firm-calendar-${startYear}-${String(startMonth + 1).padStart(2, '0')}-to-${endYear}-${String(endMonth + 1).padStart(2, '0')}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // Safari fetches the blob asynchronously after click(); revoking immediately
      // triggers "WebKitBlobResource error 1". Delay so the download can start.
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setLoading(false);
    }
  }, [startYear, startMonth, endYear, endMonth, isValid, onClose]);

  if (!open) return null;

  const yearOptions = Array.from({ length: 11 }, (_, i) => defaultYear - 3 + i);

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-sm bg-[var(--card-bg)] rounded-2xl shadow-2xl border border-[var(--border-color)] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-[var(--border-color)] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Download className="w-4 h-4 text-gold-600 dark:text-gold-400" />
            <h2 className="text-sm font-semibold text-foreground">Export Calendar to PDF</h2>
          </div>
          <button onClick={onClose} className="p-1 rounded-md text-[var(--text-muted)] hover:bg-[var(--subtle-bg)] cursor-pointer" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <p className="text-[11px] text-[var(--text-secondary)]">
            Select a date range (up to 12 months). Each month generates one landscape page with all firm activity.
          </p>

          {/* Start */}
          <div>
            <label className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1 block">From</label>
            <div className="flex items-center gap-2">
              <select
                value={startMonth}
                onChange={(e) => setStartMonth(Number(e.target.value))}
                className="flex-1 text-sm rounded-lg border border-[var(--border-color)] bg-background text-foreground px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-gold-400/50 cursor-pointer"
              >
                {MONTHS.map((m, i) => (
                  <option key={i} value={i}>{m}</option>
                ))}
              </select>
              <select
                value={startYear}
                onChange={(e) => setStartYear(Number(e.target.value))}
                className="w-24 text-sm rounded-lg border border-[var(--border-color)] bg-background text-foreground px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-gold-400/50 cursor-pointer"
              >
                {yearOptions.map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>
          </div>

          {/* End */}
          <div>
            <label className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1 block">To</label>
            <div className="flex items-center gap-2">
              <select
                value={endMonth}
                onChange={(e) => setEndMonth(Number(e.target.value))}
                className="flex-1 text-sm rounded-lg border border-[var(--border-color)] bg-background text-foreground px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-gold-400/50 cursor-pointer"
              >
                {MONTHS.map((m, i) => (
                  <option key={i} value={i}>{m}</option>
                ))}
              </select>
              <select
                value={endYear}
                onChange={(e) => setEndYear(Number(e.target.value))}
                className="w-24 text-sm rounded-lg border border-[var(--border-color)] bg-background text-foreground px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-gold-400/50 cursor-pointer"
              >
                {yearOptions.map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Validation */}
          {!isValid && totalMonths > 0 && (
            <p className="text-[11px] text-red-600 dark:text-red-400">
              Maximum 12 months per export.
            </p>
          )}
          {totalMonths < 1 && (
            <p className="text-[11px] text-red-600 dark:text-red-400">
              End date must be on or after the start date.
            </p>
          )}

          {/* Summary */}
          {isValid && (
            <p className="text-[11px] text-[var(--text-muted)]">
              {totalMonths} page{totalMonths !== 1 ? 's' : ''} will be generated.
            </p>
          )}

          {error && (
            <div className="text-[11px] text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-lg px-3 py-2">
              {error}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-[var(--border-color)] flex items-center gap-2 justify-end bg-[var(--subtle-bg)]">
          <button
            onClick={onClose}
            disabled={loading}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-[11px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] bg-white dark:bg-[var(--card-bg)] border border-[var(--border-color)] rounded-lg transition-all cursor-pointer disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleExport}
            disabled={loading || !isValid}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-[11px] font-medium text-white bg-gold-600 hover:bg-gold-700 rounded-lg transition-all cursor-pointer disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
            {loading ? 'Generating...' : 'Export PDF'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
