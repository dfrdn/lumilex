'use client';

import { useState } from 'react';
import { FileSpreadsheet, Download, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import CellDropdown from '@/components/admin/CellDropdown';
import { useRef } from 'react';
import type { Corporation } from '@/types/corporations';

interface Props {
  corporation: Corporation;
}

/**
 * Fills SEC's official GIS workbook from the registry and downloads it.
 *
 * The point is to remove the transcription, not to claim the form is finished:
 * the server reports what it couldn't supply and that list is shown alongside
 * the download, because a GIS that looks complete but isn't gets rejected at
 * the counter.
 */
export default function GenerateGisCard({ corporation }: Props) {
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const [yearOpen, setYearOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [unfilled, setUnfilled] = useState<string[] | null>(null);
  const [error, setError] = useState('');
  const yearRef = useRef<HTMLButtonElement>(null);

  // A GIS covers a year the corporation actually existed for.
  const firstYear = corporation.secRegistrationDate
    ? Number(corporation.secRegistrationDate.slice(0, 4))
    : thisYear - 5;
  const years = Array.from({ length: thisYear - firstYear + 1 }, (_, i) => thisYear - i);

  const notStock = Boolean(corporation.companyType && corporation.companyType !== 'Stock');

  async function generate() {
    setBusy(true);
    setError('');
    setUnfilled(null);
    try {
      const res = await fetch(`/api/corporation/${corporation.id}/gis?year=${year}`);
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error ?? 'Could not generate the GIS.');
        return;
      }

      const gaps = res.headers.get('X-Gis-Unfilled');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `GIS ${year} - ${corporation.approvedName ?? 'Corporation'}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      setUnfilled(gaps ? (JSON.parse(gaps) as string[]) : []);
      toast.success(`GIS ${year} downloaded.`);
    } catch {
      setError('Could not generate the GIS.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="bg-white dark:bg-card border border-stone-200 dark:border-white/10 rounded-xl p-5">
      <div className="flex items-start gap-3">
        <FileSpreadsheet className="w-5 h-5 text-stone-500 dark:text-stone-400 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-stone-800 dark:text-stone-100">General Information Sheet</h3>
          <p className="mt-0.5 text-xs text-stone-500 dark:text-stone-400">
            Fills SEC&rsquo;s official GIS workbook from this record — corporate details, capital
            structure, directors and officers, and stockholders. Review before filing.
          </p>

          {notStock && (
            <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
              This is a {corporation.companyType}. Only the stock-corporation GIS is available.
            </p>
          )}

          <div className="mt-3 flex items-center gap-2">
            <div className="relative">
              <button
                ref={yearRef}
                type="button"
                onClick={() => setYearOpen((o) => !o)}
                disabled={busy || notStock}
                className="px-2.5 py-1.5 text-xs border border-stone-300 dark:border-white/15 rounded-lg bg-white dark:bg-card hover:border-stone-400 dark:hover:border-stone-600 disabled:opacity-50"
              >
                For the year {year}
              </button>
              {yearOpen && (
                <CellDropdown
                  mode="single"
                  value={String(year)}
                  options={years.map((y) => ({ id: String(y), label: String(y) }))}
                  onSelect={(v) => {
                    if (v) setYear(Number(v));
                    setYearOpen(false);
                  }}
                  onClose={() => setYearOpen(false)}
                  anchorRef={yearRef}
                />
              )}
            </div>
            <button
              onClick={generate}
              disabled={busy || notStock}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-navy-700 rounded-lg hover:bg-navy-800 disabled:bg-stone-300 dark:disabled:bg-stone-700"
            >
              <Download className="w-3 h-3" />
              {busy ? 'Generating…' : 'Generate GIS'}
            </button>
          </div>

          {error && (
            <p className="mt-2 text-xs text-rose-600 dark:text-rose-400 inline-flex items-center gap-1">
              <AlertCircle className="w-3 h-3" /> {error}
            </p>
          )}

          {unfilled && unfilled.length > 0 && (
            <div className="mt-3 px-3 py-2.5 rounded-lg bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30">
              <p className="text-xs font-medium text-amber-900 dark:text-amber-300">
                Downloaded — {unfilled.length} {unfilled.length === 1 ? 'item' : 'items'} still need
                completing by hand:
              </p>
              <ul className="mt-1 space-y-0.5">
                {unfilled.map((u) => (
                  <li key={u} className="text-[11px] text-amber-800 dark:text-amber-300">
                    · {u}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {unfilled && unfilled.length === 0 && (
            <p className="mt-2 text-xs text-emerald-700 dark:text-emerald-300">
              Downloaded — every field the registry tracks was filled.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
