import type { SupabaseClient } from '@supabase/supabase-js';
import { computeProfitability, BILLED_STATUSES } from './profitability';
import { manilaToday } from './format';

// ── Billing Insights ─────────────────────────────────────────────────
// Leakage analytics computed from data the billing pipeline already
// stores but never surfaces:
//   1. Write-offs — hours finance excluded/reduced/marked non-billable in
//      DTR review, valued at position rates, plus discount usage.
//   2. Payment behavior — days-to-pay, lifetime billed/collected per client.
//   3. Billing-type economics — effective hourly rate and margin per
//      matter_billing_configs.billing_type.
//   4. Collections forecast — open A/R aged against the firm's own
//      historical payment curve.

export interface LeakageRow {
  client: string;
  excludedHours: number;
  reducedHours: number;
  nonBillableHours: number;
  leakHours: number;
  leakValue: number;
  billedHours: number;
  /** leakHours / (leakHours + billedHours), % */
  leakRate: number;
  invoicesWithDiscount: number;
  avgHourlyDiscountPct: number;
  avgTotalDiscountPct: number;
}

export interface PaymentBehaviorRow {
  client: string;
  billedFace: number;
  collected: number;
  outstanding: number;
  paidInvoices: number;
  openInvoices: number;
  /** Payment-amount-weighted average of (payment_date − sent_date), days. */
  avgDaysToPay: number | null;
}

export interface BillingTypeRow {
  billingType: string;
  matters: number;
  revenue: number;
  hours: number;
  laborCost: number;
  margin: number;
  effectiveRate: number | null;
}

export interface ForecastBucket {
  label: string;
  balance: number;
  invoices: number;
}

export interface BillingInsights {
  windowMonths: number;
  leakage: {
    rows: LeakageRow[];
    totals: {
      leakHours: number;
      leakValue: number;
      billedHours: number;
      leakRate: number;
    };
    unmappedLawyers: string[];
  };
  payment: {
    rows: PaymentBehaviorRow[];
    firmAvgDaysToPay: number | null;
    /** Average days from invoice creation to send (processing lag). */
    avgBillingLagDays: number | null;
  };
  billingTypes: BillingTypeRow[];
  forecast: {
    buckets: ForecastBucket[];
    openBalance: number;
    expected30: number;
    expected60: number;
    expected90: number;
    /** Number of historical payment events the curve is built from. */
    sampleSize: number;
    /** Open balance on invoices older than every recorded payment — the curve has no signal for these. */
    beyondCurve: { invoices: number; balance: number };
  };
}

interface InvoiceRow {
  id: number;
  client_name: string | null;
  billing_month: string | null;
  status: string | null;
  created_at: string | null;
  sent_date: string | null;
  total_amount: number | null;
  total_expenses: number | null;
  paid_amount: number | null;
  billing_settings: Record<string, unknown> | null;
  line_items: Array<{ totalHours?: number }> | null;
}

interface RevisionRow {
  id: number;
  billing_month: string;
  client_name: string;
  original_dtr_id: string | null;
  created_entry_key: string | null;
  action: 'set' | 'exclude';
  hours: number | null;
  minutes: number | null;
  lawyer_name: string | null;
  non_billable: boolean | null;
}

const DAY_MS = 86_400_000;

function hoursOf(h: number | null | undefined, m: number | null | undefined): number {
  return (h ?? 0) + (m ?? 0) / 60;
}

function daysBetween(fromIso: string, toIso: string): number {
  return Math.max(0, Math.round((Date.parse(toIso) - Date.parse(fromIso)) / DAY_MS));
}

/** 'YYYY-MM' cutoff N-1 months before the current Manila month (inclusive window of N months). */
function windowCutoff(months: number): string {
  const today = manilaToday(); // YYYY-MM-DD
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  const idx = y * 12 + (m - 1) - (months - 1);
  const cy = Math.floor(idx / 12);
  const cm = (idx % 12) + 1;
  return `${cy}-${String(cm).padStart(2, '0')}`;
}

export async function computeBillingInsights(
  supabase: SupabaseClient,
  firmId: string,
  opts: { months?: number } = {},
): Promise<BillingInsights> {
  const windowMonths = opts.months ?? 12;
  const cutoff = windowCutoff(windowMonths);

  const [{ data: invoices }, { data: payments }, { data: revisions }, { data: team }, { data: rates }] =
    await Promise.all([
      supabase
        .from('invoices')
        .select('id, client_name, billing_month, status, created_at, sent_date, total_amount, total_expenses, paid_amount, billing_settings, line_items'),
      supabase.from('invoice_payments').select('invoice_id, amount, payment_date'),
      supabase
        .from('dtr_revisions')
        .select('id, billing_month, client_name, original_dtr_id, created_entry_key, action, hours, minutes, lawyer_name, non_billable')
        .gte('billing_month', cutoff),
      supabase.from('team').select('name, position'),
      supabase.from('billing_rates').select('position, hourly_rate'),
    ]);

  const invoiceRows = (invoices ?? []) as InvoiceRow[];
  const billedInvoices = invoiceRows.filter((i) => BILLED_STATUSES.includes((i.status ?? '') as never));
  const revisionRows = (revisions ?? []) as RevisionRow[];

  // ── Rate lookup: lawyer name → position hourly rate ────────────────
  const rateByPosition = new Map<string, number>();
  for (const r of rates ?? []) rateByPosition.set(r.position, Number(r.hourly_rate) || 0);
  const positionByName = new Map<string, string>();
  for (const t of team ?? []) if (t.name) positionByName.set(t.name, t.position ?? '');
  const unmapped = new Set<string>();
  const rateFor = (lawyerName: string | null): number => {
    if (!lawyerName) return 0;
    const position = positionByName.get(lawyerName);
    const rate = position ? rateByPosition.get(position) : undefined;
    if (rate == null) {
      unmapped.add(lawyerName);
      return 0;
    }
    return rate;
  };

  // ── 1. Leakage ──────────────────────────────────────────────────────
  // Raw DTR rows behind the revisions, for excluded hours / reduction deltas.
  const rawIds = [...new Set(revisionRows.map((r) => r.original_dtr_id).filter((x): x is string => !!x))];
  const rawById = new Map<string, { hours: number; lawyer_name: string | null }>();
  for (let i = 0; i < rawIds.length; i += 200) {
    const { data: chunk } = await supabase
      .from('dtr')
      .select('notion_id, hours, minutes, lawyer_name')
      .in('notion_id', rawIds.slice(i, i + 200));
    for (const row of chunk ?? []) {
      rawById.set(row.notion_id, { hours: hoursOf(row.hours, row.minutes), lawyer_name: row.lawyer_name });
    }
  }

  interface LeakAcc {
    excludedHours: number;
    reducedHours: number;
    nonBillableHours: number;
    leakValue: number;
    billedHours: number;
    discountPcts: { hourly: number[]; total: number[] };
    invoicesWithDiscount: number;
  }
  const leakByClient = new Map<string, LeakAcc>();
  const leakAcc = (client: string): LeakAcc => {
    let acc = leakByClient.get(client);
    if (!acc) {
      acc = {
        excludedHours: 0,
        reducedHours: 0,
        nonBillableHours: 0,
        leakValue: 0,
        billedHours: 0,
        discountPcts: { hourly: [], total: [] },
        invoicesWithDiscount: 0,
      };
      leakByClient.set(client, acc);
    }
    return acc;
  };

  for (const rev of revisionRows) {
    const client = rev.client_name || 'Unknown';
    const acc = leakAcc(client);
    const raw = rev.original_dtr_id ? rawById.get(rev.original_dtr_id) : undefined;
    const lawyer = rev.lawyer_name ?? raw?.lawyer_name ?? null;

    if (rev.action === 'exclude') {
      // Finance-created entries that were then excluded were never lawyer time.
      if (!rev.original_dtr_id || !raw) continue;
      acc.excludedHours += raw.hours;
      acc.leakValue += raw.hours * rateFor(lawyer);
    } else if (rev.non_billable) {
      const h = hoursOf(rev.hours, rev.minutes);
      acc.nonBillableHours += h;
      acc.leakValue += h * rateFor(lawyer);
    } else if (raw) {
      const delta = raw.hours - hoursOf(rev.hours, rev.minutes);
      if (delta > 0.01) {
        acc.reducedHours += delta;
        acc.leakValue += delta * rateFor(lawyer);
      }
    }
  }

  // Invoiced hours per client in the window — the leak-rate denominator.
  // Drafts count: a generated-but-unsent invoice still represents hours
  // that survived review, so excluding it would overstate the leak rate.
  for (const inv of invoiceRows) {
    if (!inv.billing_month || inv.billing_month < cutoff) continue;
    const acc = leakAcc(inv.client_name || 'Unknown');
    for (const li of inv.line_items ?? []) acc.billedHours += Number(li.totalHours) || 0;
  }

  // Discount usage — billed invoices only (draft settings can still change).
  for (const inv of billedInvoices) {
    if (!inv.billing_month || inv.billing_month < cutoff) continue;
    const acc = leakAcc(inv.client_name || 'Unknown');
    const settings = inv.billing_settings ?? {};
    const hourlyPct = Number(settings.hourlyDiscountPercent) || 0;
    const totalPct = Number(settings.totalDiscountPercent) || 0;
    if (hourlyPct > 0 || totalPct > 0) {
      acc.invoicesWithDiscount += 1;
      if (hourlyPct > 0) acc.discountPcts.hourly.push(hourlyPct);
      if (totalPct > 0) acc.discountPcts.total.push(totalPct);
    }
  }

  const avg = (xs: number[]) => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);

  const leakageRows: LeakageRow[] = [...leakByClient.entries()]
    .map(([client, a]) => {
      const leakHours = a.excludedHours + a.reducedHours + a.nonBillableHours;
      return {
        client,
        excludedHours: a.excludedHours,
        reducedHours: a.reducedHours,
        nonBillableHours: a.nonBillableHours,
        leakHours,
        leakValue: a.leakValue,
        billedHours: a.billedHours,
        leakRate: leakHours + a.billedHours > 0 ? (leakHours / (leakHours + a.billedHours)) * 100 : 0,
        invoicesWithDiscount: a.invoicesWithDiscount,
        avgHourlyDiscountPct: avg(a.discountPcts.hourly),
        avgTotalDiscountPct: avg(a.discountPcts.total),
      };
    })
    .filter((r) => r.leakHours > 0.01 || r.invoicesWithDiscount > 0 || r.billedHours > 0)
    .sort((a, b) => b.leakValue - a.leakValue);

  const leakTotals = leakageRows.reduce(
    (t, r) => ({
      leakHours: t.leakHours + r.leakHours,
      leakValue: t.leakValue + r.leakValue,
      billedHours: t.billedHours + r.billedHours,
      leakRate: 0,
    }),
    { leakHours: 0, leakValue: 0, billedHours: 0, leakRate: 0 },
  );
  leakTotals.leakRate =
    leakTotals.leakHours + leakTotals.billedHours > 0
      ? (leakTotals.leakHours / (leakTotals.leakHours + leakTotals.billedHours)) * 100
      : 0;

  // ── 2. Payment behavior (lifetime) ──────────────────────────────────
  const invoiceById = new Map<number, InvoiceRow>(invoiceRows.map((i) => [i.id, i]));

  interface PayAcc {
    billedFace: number;
    collected: number;
    outstanding: number;
    paidInvoices: number;
    openInvoices: number;
    weightedDays: number;
    weightedAmount: number;
  }
  const payByClient = new Map<string, PayAcc>();
  const payAcc = (client: string): PayAcc => {
    let acc = payByClient.get(client);
    if (!acc) {
      acc = { billedFace: 0, collected: 0, outstanding: 0, paidInvoices: 0, openInvoices: 0, weightedDays: 0, weightedAmount: 0 };
      payByClient.set(client, acc);
    }
    return acc;
  };

  for (const inv of billedInvoices) {
    const client = inv.client_name || 'Unknown';
    const acc = payAcc(client);
    const face = (Number(inv.total_amount) || 0) + (Number(inv.total_expenses) || 0);
    acc.billedFace += face;
    const balance = Math.max(0, face - (Number(inv.paid_amount) || 0));
    if (inv.status === 'paid') acc.paidInvoices += 1;
    else if (balance > 0) {
      acc.openInvoices += 1;
      acc.outstanding += balance;
    }
  }

  // Historical payment curve events double as the forecast input.
  const paymentEvents: { days: number; amount: number }[] = [];
  let billingLagSum = 0;
  let billingLagCount = 0;

  for (const p of payments ?? []) {
    const inv = invoiceById.get(p.invoice_id);
    if (!inv) continue;
    const client = inv.client_name || 'Unknown';
    const acc = payAcc(client);
    const amount = Number(p.amount) || 0;
    acc.collected += amount;
    if (inv.sent_date && p.payment_date) {
      const days = daysBetween(inv.sent_date, p.payment_date);
      acc.weightedDays += days * amount;
      acc.weightedAmount += amount;
      paymentEvents.push({ days, amount });
    }
  }

  for (const inv of billedInvoices) {
    if (inv.created_at && inv.sent_date) {
      billingLagSum += daysBetween(inv.created_at, inv.sent_date);
      billingLagCount += 1;
    }
  }

  const paymentRows: PaymentBehaviorRow[] = [...payByClient.entries()]
    .map(([client, a]) => ({
      client,
      billedFace: a.billedFace,
      collected: a.collected,
      outstanding: a.outstanding,
      paidInvoices: a.paidInvoices,
      openInvoices: a.openInvoices,
      avgDaysToPay: a.weightedAmount > 0 ? a.weightedDays / a.weightedAmount : null,
    }))
    .filter((r) => r.billedFace > 0)
    .sort((a, b) => b.billedFace - a.billedFace);

  const firmWeighted = paymentEvents.reduce(
    (t, e) => ({ days: t.days + e.days * e.amount, amount: t.amount + e.amount }),
    { days: 0, amount: 0 },
  );

  // ── 3. Billing-type economics ───────────────────────────────────────
  const [{ data: configs }, profitability] = await Promise.all([
    supabase.from('matter_billing_configs').select('matter_id, billing_type'),
    computeProfitability(supabase, firmId, {}),
  ]);

  const typeByMatter = new Map<string, string>();
  for (const c of configs ?? []) if (c.matter_id) typeByMatter.set(c.matter_id, c.billing_type || 'unconfigured');

  const typeAgg = new Map<string, { matters: number; revenue: number; hours: number; laborCost: number }>();
  for (const m of profitability) {
    const type = typeByMatter.get(m.matterId) ?? 'unconfigured';
    const agg = typeAgg.get(type) ?? { matters: 0, revenue: 0, hours: 0, laborCost: 0 };
    agg.matters += 1;
    agg.revenue += m.revenue;
    agg.laborCost += m.laborCost;
    agg.hours += m.lawyerBreakdown.reduce((s, l) => s + l.hours, 0);
    typeAgg.set(type, agg);
  }

  const billingTypes: BillingTypeRow[] = [...typeAgg.entries()]
    .map(([billingType, a]) => ({
      billingType,
      matters: a.matters,
      revenue: a.revenue,
      hours: a.hours,
      laborCost: a.laborCost,
      margin: a.revenue > 0 ? ((a.revenue - a.laborCost) / a.revenue) * 100 : 0,
      effectiveRate: a.hours > 0 ? a.revenue / a.hours : null,
    }))
    .sort((a, b) => b.revenue - a.revenue);

  // ── 4. Collections forecast ─────────────────────────────────────────
  // Empirical, payment-value-weighted CDF of days-to-pay.
  const sortedEvents = [...paymentEvents].sort((a, b) => a.days - b.days);
  const totalPaidValue = sortedEvents.reduce((s, e) => s + e.amount, 0);
  const cdf = (days: number): number => {
    if (totalPaidValue <= 0) return 0;
    let acc = 0;
    for (const e of sortedEvents) {
      if (e.days > days) break;
      acc += e.amount;
    }
    return acc / totalPaidValue;
  };

  const today = manilaToday();
  const buckets: ForecastBucket[] = [
    { label: '0–30 days', balance: 0, invoices: 0 },
    { label: '31–60 days', balance: 0, invoices: 0 },
    { label: '61–90 days', balance: 0, invoices: 0 },
    { label: '90+ days', balance: 0, invoices: 0 },
  ];
  let openBalance = 0;
  let expected30 = 0;
  let expected60 = 0;
  let expected90 = 0;
  const beyondCurve = { invoices: 0, balance: 0 };

  for (const inv of billedInvoices) {
    if (inv.status === 'paid' || !inv.sent_date) continue;
    const face = (Number(inv.total_amount) || 0) + (Number(inv.total_expenses) || 0);
    const balance = Math.max(0, face - (Number(inv.paid_amount) || 0));
    if (balance <= 0) continue;

    const age = daysBetween(inv.sent_date, today);
    openBalance += balance;
    const bucket = age <= 30 ? 0 : age <= 60 ? 1 : age <= 90 ? 2 : 3;
    buckets[bucket].balance += balance;
    buckets[bucket].invoices += 1;

    // Conditional probability of payment within the next h days given the
    // invoice has survived unpaid to `age`.
    const fAge = cdf(age);
    const remaining = 1 - fAge;
    if (remaining <= 0.001) {
      // Older than (nearly) every recorded payment — the curve can't say
      // anything about it. Reported separately rather than silently as ₱0.
      beyondCurve.invoices += 1;
      beyondCurve.balance += balance;
      continue;
    }
    expected30 += balance * Math.min(1, Math.max(0, (cdf(age + 30) - fAge) / remaining));
    expected60 += balance * Math.min(1, Math.max(0, (cdf(age + 60) - fAge) / remaining));
    expected90 += balance * Math.min(1, Math.max(0, (cdf(age + 90) - fAge) / remaining));
  }

  return {
    windowMonths,
    leakage: {
      rows: leakageRows,
      totals: leakTotals,
      unmappedLawyers: [...unmapped].sort(),
    },
    payment: {
      rows: paymentRows,
      firmAvgDaysToPay: firmWeighted.amount > 0 ? firmWeighted.days / firmWeighted.amount : null,
      avgBillingLagDays: billingLagCount > 0 ? billingLagSum / billingLagCount : null,
    },
    billingTypes,
    forecast: {
      buckets,
      openBalance,
      expected30,
      expected60,
      expected90,
      sampleSize: paymentEvents.length,
      beyondCurve,
    },
  };
}
