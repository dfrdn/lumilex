import type { ReactNode } from 'react';

/** Peso amount, absolute value, no decimals. e.g. ₱1,250,000 */
export function fmt(n: number): string {
  return `₱${Math.abs(n).toLocaleString('en-PH', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

/** Peso amount with centavo precision, sign preserved. e.g. ₱1,250.00 / −₱90.00 */
export function pesoExact(n: number): string {
  const v = Number(n) || 0;
  return `${v < 0 ? '−' : ''}₱${Math.abs(v).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Peso amount with a leading minus sign (U+2212) when negative. */
export function signed(n: number): string {
  return `${n < 0 ? '−' : ''}${fmt(n)}`;
}

/** Percentage with a fixed number of decimals (default 1). */
export function fmtPct(n: number, digits = 1): string {
  return `${n.toFixed(digits)}%`;
}

/** Compact peso for chart axis ticks: ₱1.2M, ₱85k, ₱500. Sign preserved (U+2212). */
export function fmtCompact(n: number): string {
  const a = Math.abs(n);
  const sign = n < 0 ? '−' : '';
  if (a >= 1_000_000) return `${sign}₱${(a / 1_000_000).toFixed(1)}M`;
  if (a >= 1_000) return `${sign}₱${Math.round(a / 1_000)}k`;
  return `${sign}₱${Math.round(a)}`;
}

/** Zero-based month index for a 'YYYY-MM…' string — year*12 + (month-1). */
export function monthIndex(yyyymm: string): number {
  const [y, m] = yyyymm.slice(0, 7).split('-').map((x) => parseInt(x, 10));
  return y * 12 + (m - 1);
}

/** First day of the month AFTER 'YYYY-MM' — the exclusive upper bound for a
 *  month-range date filter (avoids invalid days like 2026-06-31). */
export function nextMonthStart(yyyymm: string): string {
  const [y, m] = yyyymm.split('-').map((x) => parseInt(x, 10));
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
}

/** Today's date as YYYY-MM-DD at the firm's timezone (Asia/Manila). The single
 *  source of truth for "today" across the billing/receivables date-cutoff. */
export function manilaToday(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
}

/** Date formatted at the firm's locale (en-PH / Asia/Manila). */
export function formatManilaDate(
  iso: string,
  opts: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'short', day: 'numeric' },
): string {
  return new Date(iso).toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', ...opts });
}

const MARGIN_BADGE_BASE = 'text-[10px] font-semibold px-1.5 py-0.5 rounded-full';

/** Color-tiered margin badge: ≥50 emerald · ≥20 blue · ≥0 amber · else red. */
export function MarginBadge({ margin }: { margin: number }): ReactNode {
  const tone =
    margin >= 50 ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400'
      : margin >= 20 ? 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400'
        : margin >= 0 ? 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400'
          : 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400';
  return <span className={`${MARGIN_BADGE_BASE} ${tone}`}>{fmtPct(margin)}</span>;
}
