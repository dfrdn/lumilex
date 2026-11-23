import { resolveLawyerPositions } from '@/lib/billing/lawyer-positions';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { toDecimal } from '@/lib/dtr-utils';
import { getDTRBundleEntries } from '@/lib/queries/effective-dtr';
import { computeBundleFees, type MatterBillingConfig } from '@/lib/billing/compute-bundle-fees';

export interface BillingEfficiency {
  /** Sum of raw DTR decimal hours (billable + non-billable, before finance edits). */
  totalRawHours: number;
  /** Sum of raw DTR billable decimal hours. */
  totalRawBillableHours: number;
  /** Sum of effective DTR billable decimal hours (post-revisions, exclusions dropped). */
  totalEffectiveBillableHours: number;
  /** Hours × rate before any retainer/cap math — what raw DTR data implies as max revenue. */
  totalProjectedRevenue: number;
  /** Actual amount that would be billed: monthly retainers + hourly excess across all clients. */
  totalActualBillable: number;
  /** True when any (month, client) bundle in scope has revisions whose review row isn't approved
   *  — analytics reflect those tentative edits even though the invoice can't generate yet. */
  hasTentativeEdits: boolean;
  /** Number of (month, client) bundles with revisions that are still pending or rejected. */
  tentativeBundleCount: number;
  /** Per-month breakdown for charting. */
  byMonth: { month: string; rawHours: number; effectiveHours: number; projectedRevenue: number; actualBillable: number }[];
}

interface RawDTRRow {
  date: string | null;
  hours: number | null;
  minutes: number | null;
  lawyer_name: string;
  lawyer_person_id: string | null;
  with_names: string[] | null;
  client_name: string;
  matter_id: string | null;
  non_billable: boolean | null;
}

function monthsInRange(start: string, end: string): string[] {
  const months: string[] = [];
  const [sy, sm] = start.split('-').map(Number);
  const [ey, em] = end.split('-').map(Number);
  let y = sy, m = sm;
  while (y < ey || (y === ey && m <= em)) {
    months.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return months;
}

/**
 * Computes raw vs effective vs actual-billable metrics across a date range so the
 * partner dashboard can show effort / billable hours / actual revenue side-by-side.
 *
 *   - rawHours: every DTR row (including non-billable) — pure effort.
 *   - effectiveHours: post-revisions, excluding non-billable and excluded rows.
 *   - projectedRevenue: rawBillableHours × rate (no retainer cap math).
 *   - actualBillable: effective DTRs run through the rate engine, applying matter
 *     billing configs (retainer cap + monthly retainer, hourly_rate_override).
 *
 * The gap (projectedRevenue − actualBillable) is the firm's write-down: time
 * absorbed by retainer caps, finance edits, or non-billable categorization.
 */
export async function getBillingEfficiency(firmId: string, 
  startDate: string,
  endDate: string,
): Promise<BillingEfficiency> {
  const startMonth = startDate.substring(0, 7);
  const endMonth = endDate.substring(0, 7);
  const months = monthsInRange(startMonth, endMonth);
  const supabase = getServiceDbForFirm(firmId);

  // ── Raw DTRs across the range (paginated — Supabase caps per-query at 1000) ──
  const rawRows: RawDTRRow[] = [];
  const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    const { data, error: rawErr } = await supabase
      .from('dtr')
      .select('date, hours, minutes, lawyer_name, lawyer_person_id, with_names, client_name, matter_id, non_billable')
      .gte('date', startDate)
      .lte('date', endDate)
      .range(offset, offset + PAGE - 1);
    if (rawErr) throw rawErr;
    const page = (data ?? []) as RawDTRRow[];
    rawRows.push(...page);
    if (page.length < PAGE) break;
  }

  // ── Lookups: rates + positions + configs ──
  const matterIdsRaw = [...new Set(rawRows.map((r) => r.matter_id).filter((id): id is string => !!id))];

  const [ratesRes, configsRes, lawyers] = await Promise.all([
    supabase.from('billing_rates').select('position, hourly_rate'),
    matterIdsRaw.length > 0
      ? supabase
          .from('matter_billing_configs')
          .select('matter_id, billing_type, retainer_hours_cap, hourly_rate_override, monthly_retainer')
          .in('matter_id', matterIdsRaw)
      : Promise.resolve({ data: [] as MatterBillingConfig[], error: null }),
    // The shared resolver — a renamed author still prices at their position.
    resolveLawyerPositions(supabase, firmId, rawRows),
  ]);

  const ratesByPosition: Record<string, number> = {};
  for (const r of (ratesRes.data ?? []) as { position: string; hourly_rate: number | string }[]) {
    const v = Number(r.hourly_rate);
    ratesByPosition[r.position] = isNaN(v) ? 0 : v;
  }
  const configsByMatter = new Map<string, MatterBillingConfig>();
  for (const c of (configsRes.data ?? []) as MatterBillingConfig[]) {
    configsByMatter.set(c.matter_id, c);
  }
  const { positionByLawyerName } = lawyers;

  function rateFor(lawyerName: string, matterId: string | null): number {
    const cfg = matterId ? configsByMatter.get(matterId) : null;
    const override = cfg?.hourly_rate_override != null ? Number(cfg.hourly_rate_override) : null;
    if (override != null && !isNaN(override) && override > 0) return override;
    const position = positionByLawyerName[lawyerName] ?? 'Junior Associate';
    return ratesByPosition[position] ?? 0;
  }

  // ── Per-month aggregation ──
  const byMonth: Record<string, { rawHours: number; effectiveHours: number; projectedRevenue: number; actualBillable: number }> = {};
  for (const m of months) byMonth[m] = { rawHours: 0, effectiveHours: 0, projectedRevenue: 0, actualBillable: 0 };

  // Raw hours + projected revenue, fanned out across attendees so each
  // lawyer's time is counted at their own rate (matches partner-analytics
  // and the billing fan-out in dtr-export / compute-bundle-fees).
  for (const r of rawRows) {
    if (!r.date) continue;
    const month = r.date.substring(0, 7);
    if (!byMonth[month]) continue;
    const dec = toDecimal(r.hours ?? 0, r.minutes ?? 0);

    const attendees = new Set<string>();
    if (r.lawyer_name) attendees.add(r.lawyer_name);
    for (const n of r.with_names ?? []) {
      if (n) attendees.add(n);
    }
    if (attendees.size === 0) attendees.add(r.lawyer_name || '');

    for (const name of attendees) {
      byMonth[month].rawHours += dec;
      if (!r.non_billable) {
        const rate = rateFor(name, r.matter_id);
        byMonth[month].projectedRevenue += dec * rate;
      }
    }
  }

  // Effective hours + actual billable (per (month, client) bundle, with retainer caps)
  const entriesByMonth = await Promise.all(
    months.map((month) => getDTRBundleEntries(firmId, { billingMonth: month, includeNonBillable: false })),
  );
  for (const [i, month] of months.entries()) {
    const entries = entriesByMonth[i];
    if (entries.length === 0) continue;

    // Group by client for fee computation
    const byClient: Record<string, typeof entries> = {};
    for (const e of entries) {
      if (!e.effective) continue;
      (byClient[e.clientName] ||= []).push(e);
    }

    for (const [, group] of Object.entries(byClient)) {
      const snapshots = group.map((e) => e.effective!);
      const fees = computeBundleFees({
        snapshots,
        configsByMatter,
        ratesByPosition,
        positionByLawyerName,
      });
      byMonth[month].effectiveHours += fees.totalHours;
      byMonth[month].actualBillable += fees.totalLegalFees;
    }
  }

  const monthList = months.map((m) => ({ month: m, ...byMonth[m] }));

  // Totals are fanned the same way as the per-month accumulation so a 1h
  // meeting attended by 3 lawyers contributes 3 lawyer-hours to the total
  // (matches the billing fan-out and partner-analytics revenue projection).
  let totalRawHours = 0, totalRawBillableHours = 0;
  for (const r of rawRows) {
    const dec = toDecimal(r.hours ?? 0, r.minutes ?? 0);
    const attendees = new Set<string>();
    if (r.lawyer_name) attendees.add(r.lawyer_name);
    for (const n of r.with_names ?? []) {
      if (n) attendees.add(n);
    }
    if (attendees.size === 0) attendees.add(r.lawyer_name || '');
    const fanCount = attendees.size;
    totalRawHours += dec * fanCount;
    if (!r.non_billable) totalRawBillableHours += dec * fanCount;
  }
  let totalEffectiveBillableHours = 0, totalProjectedRevenue = 0, totalActualBillable = 0;
  for (const m of monthList) {
    totalEffectiveBillableHours += m.effectiveHours;
    totalProjectedRevenue += m.projectedRevenue;
    totalActualBillable += m.actualBillable;
  }

  // ── Approval status: how many bundles in scope have revisions that aren't yet approved ──
  // Analytics reflect those edits tentatively (the diff is real for the partner to see),
  // but the invoice can't actually generate until the managing partner signs off.
  const [{ data: revBundles }, { data: approvedBundles }] = await Promise.all([
    supabase
      .from('dtr_revisions')
      .select('billing_month, client_name')
      .gte('billing_month', startMonth)
      .lte('billing_month', endMonth),
    supabase
      .from('dtr_revision_reviews')
      .select('billing_month, client_name')
      .eq('status', 'approved')
      .gte('billing_month', startMonth)
      .lte('billing_month', endMonth),
  ]);

  const bundlesWithRevisions = new Set<string>();
  for (const b of (revBundles ?? []) as { billing_month: string; client_name: string }[]) {
    bundlesWithRevisions.add(`${b.billing_month}|${b.client_name}`);
  }
  const approvedBundleKeys = new Set<string>();
  for (const b of (approvedBundles ?? []) as { billing_month: string; client_name: string }[]) {
    approvedBundleKeys.add(`${b.billing_month}|${b.client_name}`);
  }
  let tentativeBundleCount = 0;
  for (const k of bundlesWithRevisions) {
    if (!approvedBundleKeys.has(k)) tentativeBundleCount += 1;
  }

  return {
    totalRawHours,
    totalRawBillableHours,
    totalEffectiveBillableHours,
    totalProjectedRevenue,
    totalActualBillable,
    hasTentativeEdits: tentativeBundleCount > 0,
    tentativeBundleCount,
    byMonth: monthList,
  };
}
