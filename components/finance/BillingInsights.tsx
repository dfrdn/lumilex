'use client';

import {
  Loader2, Droplets, Clock, Percent, Banknote, AlertTriangle,
} from 'lucide-react';
import type { BillingInsights as Insights } from '@/lib/finance/billing-insights';
import { fmt, fmtPct } from '@/lib/finance/format';
import useSWR from 'swr';

const CARD = 'rounded-xl border border-[var(--border-color)] bg-[var(--bg-card)] p-5';
const TH = 'px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]';
const TD = 'px-3 py-2 text-sm';
const NUM = `${TD} text-right tabular-nums`;

function hrs(n: number): string {
  return `${n.toLocaleString('en-PH', { maximumFractionDigits: 1 })}h`;
}

function StatCard({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) {
  return (
    <div className={CARD}>
      <div className="flex items-center gap-2 text-[var(--text-muted)]">
        {icon}
        <span className="text-xs font-medium">{label}</span>
      </div>
      <div className="mt-2 text-2xl font-semibold tabular-nums">{value}</div>
      {sub && <div className="mt-1 text-xs text-[var(--text-muted)]">{sub}</div>}
    </div>
  );
}

function SectionHeader({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="mb-3">
      <h2 className="text-sm font-semibold">{title}</h2>
      <p className="text-xs text-[var(--text-muted)] mt-0.5">{sub}</p>
    </div>
  );
}

export default function BillingInsights() {
  const { data: fetched, isLoading: loading } = useSWR<Insights>('/api/finance/billing-insights');
  const data = fetched ?? null;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-[var(--text-muted)]" />
      </div>
    );
  }

  if (!data) {
    return <div className="py-20 text-center text-sm text-[var(--text-muted)]">Could not load billing insights.</div>;
  }

  const { leakage, payment, billingTypes, forecast, windowMonths } = data;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold">Billing Insights</h1>
        <p className="text-sm text-[var(--text-muted)] mt-1">
          Where billable value leaks, how clients pay, and what each billing model actually earns.
        </p>
      </div>

      {/* Topline */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={<Droplets className="w-4 h-4" />}
          label={`Written off · last ${windowMonths}mo`}
          value={fmt(leakage.totals.leakValue)}
          sub={`${hrs(leakage.totals.leakHours)} excluded, reduced, or non-billable (${fmtPct(leakage.totals.leakRate)} of reviewed hours)`}
        />
        <StatCard
          icon={<Clock className="w-4 h-4" />}
          label="Avg days to pay"
          value={payment.firmAvgDaysToPay != null ? `${payment.firmAvgDaysToPay.toFixed(0)}d` : '—'}
          sub={payment.avgBillingLagDays != null ? `+ ${payment.avgBillingLagDays.toFixed(0)}d from generation to send` : undefined}
        />
        <StatCard
          icon={<Banknote className="w-4 h-4" />}
          label="Open A/R"
          value={fmt(forecast.openBalance)}
          sub={`${forecast.buckets[3].invoices > 0 ? `${fmt(forecast.buckets[3].balance)} is 90+ days old` : 'nothing over 90 days'}`}
        />
        <StatCard
          icon={<Percent className="w-4 h-4" />}
          label="Expected collections · 30d"
          value={fmt(forecast.expected30)}
          sub={`from the firm's own payment curve (${forecast.sampleSize} payments)`}
        />
      </div>

      {/* 1. Leakage */}
      <div className={CARD}>
        <SectionHeader
          title={`Write-offs & discounts by client — last ${windowMonths} months`}
          sub="Hours finance excluded, reduced, or marked non-billable during DTR review, valued at position rates. Discounts read from invoice settings."
        />
        {leakage.rows.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)] py-6 text-center">No DTR review activity in the window.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[var(--border-color)]">
                  <th className={TH}>Client</th>
                  <th className={`${TH} text-right`}>Excluded</th>
                  <th className={`${TH} text-right`}>Reduced</th>
                  <th className={`${TH} text-right`}>Non-billable</th>
                  <th className={`${TH} text-right`}>Write-off value</th>
                  <th className={`${TH} text-right`}>Leak rate</th>
                  <th className={`${TH} text-right`}>Discounted invoices</th>
                  <th className={`${TH} text-right`}>Avg discount</th>
                </tr>
              </thead>
              <tbody>
                {leakage.rows.map((r) => (
                  <tr key={r.client} className="border-b border-[var(--border-color)] last:border-0">
                    <td className={TD}>{r.client}</td>
                    <td className={NUM}>{r.excludedHours > 0.01 ? hrs(r.excludedHours) : '—'}</td>
                    <td className={NUM}>{r.reducedHours > 0.01 ? hrs(r.reducedHours) : '—'}</td>
                    <td className={NUM}>{r.nonBillableHours > 0.01 ? hrs(r.nonBillableHours) : '—'}</td>
                    <td className={`${NUM} font-medium`}>{r.leakValue > 0 ? fmt(r.leakValue) : '—'}</td>
                    <td className={NUM}>{r.leakHours > 0.01 ? fmtPct(r.leakRate) : '—'}</td>
                    <td className={NUM}>{r.invoicesWithDiscount || '—'}</td>
                    <td className={NUM}>
                      {r.avgHourlyDiscountPct > 0 && `${fmtPct(r.avgHourlyDiscountPct, 0)} hourly`}
                      {r.avgHourlyDiscountPct > 0 && r.avgTotalDiscountPct > 0 && ' · '}
                      {r.avgTotalDiscountPct > 0 && `${fmtPct(r.avgTotalDiscountPct, 0)} total`}
                      {r.avgHourlyDiscountPct === 0 && r.avgTotalDiscountPct === 0 && '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {leakage.unmappedLawyers.length > 0 && (
          <p className="mt-3 flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-400">
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            Hours for {leakage.unmappedLawyers.join(', ')} could not be valued (no matching team position rate) and are counted at ₱0.
          </p>
        )}
      </div>

      {/* 2. Payment behavior */}
      <div className={CARD}>
        <SectionHeader
          title="Client payment behavior — lifetime"
          sub="Days-to-pay is payment-amount weighted, measured from the invoice send date."
        />
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[var(--border-color)]">
                <th className={TH}>Client</th>
                <th className={`${TH} text-right`}>Billed</th>
                <th className={`${TH} text-right`}>Collected</th>
                <th className={`${TH} text-right`}>Outstanding</th>
                <th className={`${TH} text-right`}>Paid / open invoices</th>
                <th className={`${TH} text-right`}>Avg days to pay</th>
              </tr>
            </thead>
            <tbody>
              {payment.rows.map((r) => (
                <tr key={r.client} className="border-b border-[var(--border-color)] last:border-0">
                  <td className={TD}>{r.client}</td>
                  <td className={NUM}>{fmt(r.billedFace)}</td>
                  <td className={NUM}>{fmt(r.collected)}</td>
                  <td className={`${NUM} ${r.outstanding > 0 ? 'font-medium' : ''}`}>{r.outstanding > 0 ? fmt(r.outstanding) : '—'}</td>
                  <td className={NUM}>{r.paidInvoices} / {r.openInvoices}</td>
                  <td className={NUM}>
                    {r.avgDaysToPay != null ? (
                      <span className={r.avgDaysToPay > 60 ? 'text-red-600 dark:text-red-400' : r.avgDaysToPay > 30 ? 'text-amber-600 dark:text-amber-400' : ''}>
                        {r.avgDaysToPay.toFixed(0)}d
                      </span>
                    ) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 3. Billing-type economics */}
      <div className={CARD}>
        <SectionHeader
          title="Billing-model economics"
          sub="Billed revenue, hours worked, and effective hourly rate per matter billing configuration."
        />
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[var(--border-color)]">
                <th className={TH}>Billing type</th>
                <th className={`${TH} text-right`}>Matters</th>
                <th className={`${TH} text-right`}>Revenue</th>
                <th className={`${TH} text-right`}>Hours</th>
                <th className={`${TH} text-right`}>Effective rate</th>
                <th className={`${TH} text-right`}>Margin</th>
              </tr>
            </thead>
            <tbody>
              {billingTypes.map((r) => (
                <tr key={r.billingType} className="border-b border-[var(--border-color)] last:border-0">
                  <td className={`${TD} capitalize`}>{r.billingType.replace(/_/g, ' ')}</td>
                  <td className={NUM}>{r.matters}</td>
                  <td className={NUM}>{fmt(r.revenue)}</td>
                  <td className={NUM}>{hrs(r.hours)}</td>
                  <td className={`${NUM} font-medium`}>{r.effectiveRate != null ? `${fmt(r.effectiveRate)}/h` : '—'}</td>
                  <td className={NUM}>{fmtPct(r.margin)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 4. Collections forecast */}
      <div className={CARD}>
        <SectionHeader
          title="Collections forecast"
          sub="Open invoices aged against the firm's historical payment curve. Conditional on each invoice's current age."
        />
        <div className="grid gap-4 lg:grid-cols-2">
          <table className="w-full self-start">
            <thead>
              <tr className="border-b border-[var(--border-color)]">
                <th className={TH}>A/R age</th>
                <th className={`${TH} text-right`}>Invoices</th>
                <th className={`${TH} text-right`}>Balance</th>
              </tr>
            </thead>
            <tbody>
              {forecast.buckets.map((b) => (
                <tr key={b.label} className="border-b border-[var(--border-color)] last:border-0">
                  <td className={TD}>{b.label}</td>
                  <td className={NUM}>{b.invoices || '—'}</td>
                  <td className={NUM}>{b.balance > 0 ? fmt(b.balance) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="space-y-3">
            {[
              { label: 'Expected within 30 days', value: forecast.expected30 },
              { label: 'Expected within 60 days', value: forecast.expected60 },
              { label: 'Expected within 90 days', value: forecast.expected90 },
            ].map((e) => (
              <div key={e.label} className="flex items-center justify-between rounded-lg border border-[var(--border-color)] px-4 py-3">
                <span className="text-sm text-[var(--text-muted)]">{e.label}</span>
                <span className="text-sm font-semibold tabular-nums">{fmt(e.value)}</span>
              </div>
            ))}
            {forecast.beyondCurve.balance > 0 && (
              <div className="flex items-start gap-1.5 rounded-lg border border-amber-200 dark:border-amber-400/20 bg-amber-50/50 dark:bg-amber-400/5 px-4 py-3 text-xs text-amber-700 dark:text-amber-300">
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <span>
                  {fmt(forecast.beyondCurve.balance)} across {forecast.beyondCurve.invoices} invoice
                  {forecast.beyondCurve.invoices === 1 ? '' : 's'} has been outstanding longer than any recorded
                  payment — the curve has no signal for these; chase them directly.
                </span>
              </div>
            )}
            <p className="text-[11px] text-[var(--text-muted)]">
              Curve built from {forecast.sampleSize} recorded payment{forecast.sampleSize === 1 ? '' : 's'}.
              {forecast.sampleSize < 20 && ' Treat as directional until more payment history accumulates.'}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
