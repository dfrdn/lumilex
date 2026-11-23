import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { getDTRBundleEntries } from '@/lib/queries/effective-dtr';
import { toDecimal } from '@/lib/dtr-utils';
import { POSITION_BASELINES, getBaseline } from '@/lib/partner-lawyers/utilization';

/**
 * GET /api/finance/utilization?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Per-lawyer financial utilization for the given range. Post-revision DTR, fanned
 * across attendees so each lawyer is credited for time they participated in.
 *
 *   billableHours       Hours eligible for invoicing (!nonBillable). The canonical
 *                       "billable hours" KPI in legal-industry utilization tracking.
 *   billedHours         Subset of billableHours that has been included in a sent/paid
 *                       invoice (snap.billed === true).
 *   workedHours         All hours including non-billable (internal training, CLE,
 *                       admin) — total effort.
 *   capacityHours       POSITION_BASELINES[position].hours × months_in_range.
 *   billableUtilization billableHours ÷ capacityHours.
 *   billedAmount        Σ entry.decimalHours × line_item.hourlyRate from invoices in
 *                       status ('sent','paid') and billing_month in range.
 *   billableAmount      billableHours × billing_rates[position].hourly_rate (potential
 *                       revenue if every billable hour were invoiced at position rate).
 *   realizationRate     billedAmount ÷ billableAmount  (how much of the billable work
 *                       actually got invoiced).
 *   effectiveRate       billedAmount ÷ workedHours    (firm revenue per worked hour).
 */

interface InvoiceLineItemEntry {
  decimalHours: number;
  matterId?: string;
}

interface InvoiceLineItem {
  lawyerName: string;
  hourlyRate: number;
  entries?: InvoiceLineItemEntry[];
}

interface UtilizationRow {
  lawyerName: string;
  position: string;
  billableHours: number;
  billedHours: number;
  workedHours: number;
  capacityHours: number;
  billableUtilization: number;
  billedAmount: number;
  billableAmount: number;
  realizationRate: number;
  effectiveRate: number;
}

function monthsInRange(fromMonth: string, toMonth: string): string[] {
  const months: string[] = [];
  const [sy, sm] = fromMonth.split('-').map(Number);
  const [ey, em] = toMonth.split('-').map(Number);
  let y = sy;
  let m = sm;
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

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const role = session.user.role ?? 'lawyer';
  if (!['admin', 'super_user', 'partner', 'finance'].includes(role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const params = req.nextUrl.searchParams;
  const from = params.get('from');
  const to = params.get('to');
  if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return NextResponse.json(
      { error: 'from and to query params required as YYYY-MM-DD' },
      { status: 400 },
    );
  }
  if (from > to) {
    return NextResponse.json({ error: 'from must be <= to' }, { status: 400 });
  }

  const fromMonth = from.slice(0, 7);
  const toMonth = to.slice(0, 7);
  const months = monthsInRange(fromMonth, toMonth);
  const monthCount = months.length;

  const supabase = getServiceDbForFirm(session.firmId);

  // ── Team + rates lookups ──
  const [teamRes, ratesRes] = await Promise.all([
    supabase.from('team').select('name, position, active'),
    supabase.from('billing_rates').select('position, hourly_rate'),
  ]);

  const positionByName = new Map<string, string>();
  for (const t of (teamRes.data ?? []) as { name: string; position: string; active: boolean }[]) {
    if (!t.active || !t.name) continue;
    positionByName.set(t.name, t.position ?? '');
  }

  const rateByPosition = new Map<string, number>();
  for (const r of (ratesRes.data ?? []) as { position: string; hourly_rate: number | string }[]) {
    // Number('') === 0, so an empty/blank rate would silently map to 0 and
    // zero out every billableAmount for the position. Require a real positive
    // number; skip (and warn) otherwise so the gap is visible, not masked.
    const raw = r.hourly_rate;
    const v = typeof raw === 'string' && raw.trim() === '' ? NaN : Number(raw);
    if (Number.isFinite(v) && v > 0) {
      rateByPosition.set(r.position, v);
    } else {
      console.warn(`[utilization] billing_rates row for position "${r.position}" has a missing/zero hourly_rate (${JSON.stringify(raw)}); billable amounts for this position will be 0 until fixed.`);
    }
  }

  // ── DTR aggregation (post-revision, fanned across attendees) ──
  const billableHoursByLawyer = new Map<string, number>();
  const billedHoursByLawyer = new Map<string, number>();
  const workedHoursByLawyer = new Map<string, number>();
  const unknownLawyerNames = new Set<string>();

  for (const month of months) {
    const entries = await getDTRBundleEntries(session.firmId, { billingMonth: month, includeNonBillable: true });
    for (const e of entries) {
      const snap = e.effective;
      if (!snap) continue;

      // Date filter at the day level — bundle is whole month, but caller may have
      // chosen a sub-range starting mid-month.
      if (snap.date && (snap.date < from || snap.date > to)) continue;

      const dec = toDecimal(snap.hours, snap.minutes);
      if (dec === 0) continue;

      const attendees = new Set<string>();
      if (snap.lawyerName) attendees.add(snap.lawyerName);
      for (const n of snap.withNames ?? []) {
        if (n) attendees.add(n);
      }
      if (attendees.size === 0) continue;

      for (const name of attendees) {
        // Every hour counts as worked — including internal/non-billable categories.
        workedHoursByLawyer.set(name, (workedHoursByLawyer.get(name) ?? 0) + dec);
        if (!snap.nonBillable) {
          // Billable = eligible-to-invoice (industry-standard utilization numerator).
          billableHoursByLawyer.set(name, (billableHoursByLawyer.get(name) ?? 0) + dec);
          if (snap.billed) {
            // Subset already invoiced.
            billedHoursByLawyer.set(name, (billedHoursByLawyer.get(name) ?? 0) + dec);
          }
        }
        if (!positionByName.has(name)) {
          unknownLawyerNames.add(name);
        }
      }
    }
  }

  // ── Invoice line_items: billed amount per lawyer ──
  const { data: invoices } = await supabase
    .from('invoices')
    .select('line_items, status, billing_month')
    .in('status', ['sent', 'paid'])
    .gte('billing_month', fromMonth)
    .lte('billing_month', toMonth);

  const billedAmountByLawyer = new Map<string, number>();
  for (const inv of (invoices ?? []) as { line_items: InvoiceLineItem[] | null }[]) {
    const items = (inv.line_items ?? []) as InvoiceLineItem[];
    for (const li of items) {
      if (!li?.lawyerName) continue;
      const rate = Number(li.hourlyRate) || 0;
      let hours = 0;
      for (const entry of li.entries ?? []) {
        hours += Number(entry.decimalHours) || 0;
      }
      const amount = hours * rate;
      if (amount > 0) {
        billedAmountByLawyer.set(li.lawyerName, (billedAmountByLawyer.get(li.lawyerName) ?? 0) + amount);
      }
    }
  }

  // ── Compose rows ──
  // Include every active team member with a known position baseline; lawyers with
  // zero activity still show so partners see who's idle.
  const allNames = new Set<string>([
    ...positionByName.keys(),
    ...billableHoursByLawyer.keys(),
    ...workedHoursByLawyer.keys(),
    ...billedAmountByLawyer.keys(),
  ]);

  const rows: UtilizationRow[] = [];
  for (const name of allNames) {
    const position = positionByName.get(name) ?? '';
    // Skip people with no position lookup AND no baseline — they're not lawyers
    // (e.g. admin staff who accidentally appear on a DTR). Still log them.
    const hasBaseline = position in POSITION_BASELINES;
    if (!hasBaseline && !positionByName.has(name)) {
      // already tracked in unknownLawyerNames above
      continue;
    }
    if (!hasBaseline) continue;

    const baseline = getBaseline(position);
    const capacityHours = baseline.hours * monthCount;
    const billableHours = billableHoursByLawyer.get(name) ?? 0;
    const billedHours = billedHoursByLawyer.get(name) ?? 0;
    const workedHours = workedHoursByLawyer.get(name) ?? 0;
    const billedAmount = billedAmountByLawyer.get(name) ?? 0;
    const rate = rateByPosition.get(position) ?? 0;
    const billableAmount = billableHours * rate;

    rows.push({
      lawyerName: name,
      position,
      billableHours,
      billedHours,
      workedHours,
      capacityHours,
      billableUtilization: capacityHours > 0 ? billableHours / capacityHours : 0,
      billedAmount,
      billableAmount,
      realizationRate: billableAmount > 0 ? billedAmount / billableAmount : 0,
      effectiveRate: workedHours > 0 ? billedAmount / workedHours : 0,
    });
  }

  rows.sort((a, b) => b.billableUtilization - a.billableUtilization);

  if (unknownLawyerNames.size > 0) {
    console.warn(
      `[utilization] ${unknownLawyerNames.size} DTR lawyer_name(s) did not map to an active team row: ${[...unknownLawyerNames].join(', ')}. Their hours were dropped — fix team.name spelling or activate the row.`,
    );
  }

  return NextResponse.json({
    from,
    to,
    monthCount,
    rows,
    unmappedLawyerCount: unknownLawyerNames.size,
  });
}
