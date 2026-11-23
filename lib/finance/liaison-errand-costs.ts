import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { addDays } from '@/lib/dates';

/**
 * Per-liaison transportation cost report driven by the zone tariff.
 *
 * Each completed errand carries two amounts:
 *  - INTERNAL: what the liaison is reimbursed (the actual `reimbursements.amount`
 *    when the errand was completed through the pipeline, else the zone's internal
 *    tariff — so historical errands with no posted rows still report a figure).
 *  - EXTERNAL: what the client is billed (the posted `matter_expenses.amount`,
 *    else the would-be billable amount: the internal amount when the errand is
 *    flagged no-markup, otherwise the zone's external rate; 0 when there is no
 *    matter to bill or the billable rate is 0).
 *
 * Computing from the zone (not only the posted rows) is deliberate: it makes the
 * report uniform across history (report-only) and new errands (posted). Rows
 * without a posted reimbursement are flagged `posted: false` so the view can warn
 * that they are computed estimates.
 */

export interface ErrandCostRow {
  id: number;
  date: string | null;
  title: string;
  liaison: string;
  liaisonId: string;
  zoneName: string | null;
  matterName: string;
  clientName: string;
  internal: number;
  external: number;
  margin: number;
  billable: boolean;
  billAtInternal: boolean;
  /** A reimbursement row was actually written (vs. computed from the tariff). */
  posted: boolean;
  reimbursed: boolean;
  billed: boolean;
}

export interface LiaisonCostSummary {
  liaison: string;
  liaisonId: string;
  errands: number;
  internalTotal: number;
  externalTotal: number;
  marginTotal: number;
  billableErrands: number;
  nonBillableErrands: number;
  reimbursedCount: number;
  billedCount: number;
}

export interface LiaisonErrandCostReport {
  start: string;
  end: string;
  rows: ErrandCostRow[];
  summaries: LiaisonCostSummary[];
  totals: {
    errands: number;
    internalTotal: number;
    externalTotal: number;
    marginTotal: number;
  };
  /** Any row is computed from the tariff rather than from posted ledger rows. */
  anyComputed: boolean;
}

interface RawTaskRow {
  id: number;
  title: string;
  scheduled_for: string | null;
  matter_id: string | null;
  matter_name: string | null;
  client_name: string | null;
  assigned_to: string | null;
  assigned_to_name: string | null;
  bill_at_internal: boolean | null;
  transportation_zones:
    | { name: string; round_trip_rate: number; external_rate: number }
    | { name: string; round_trip_rate: number; external_rate: number }[]
    | null;
}

export async function getLiaisonErrandCosts(
  start: string,
  end: string,
  firmId: string,
): Promise<LiaisonErrandCostReport> {
  const supabase = getServiceDbForFirm(firmId);

  // Completed errands whose trip date (scheduled_for) falls in range, plus
  // null-scheduled ones whose completion fell in range (those post their ledger
  // rows dated to completion — excluding them would silently drop real activity).
  const endExclusive = addDays(end, 1);
  const { data: taskData } = await supabase
    .from('liaison_tasks')
    .select(
      'id, title, scheduled_for, matter_id, matter_name, client_name, assigned_to, assigned_to_name, bill_at_internal, transportation_zones ( name, round_trip_rate, external_rate )',
    )
    .eq('status', 'completed')
    .or(
      `and(scheduled_for.gte.${start},scheduled_for.lte.${end}),and(scheduled_for.is.null,completed_at.gte.${start},completed_at.lt.${endExclusive})`,
    )
    .order('scheduled_for', { ascending: true, nullsFirst: false })
    .order('id', { ascending: true });

  const tasks = (taskData ?? []) as unknown as RawTaskRow[];
  const ids = tasks.map((t) => t.id);

  const [reimbRes, mexpRes] = await Promise.all([
    ids.length
      ? supabase
          .from('reimbursements')
          .select('liaison_task_id, amount, reimbursed')
          .in('liaison_task_id', ids)
      : Promise.resolve({ data: [] as { liaison_task_id: number; amount: number; reimbursed: boolean }[] }),
    ids.length
      ? supabase
          .from('matter_expenses')
          .select('liaison_task_id, amount, billed')
          .in('liaison_task_id', ids)
      : Promise.resolve({ data: [] as { liaison_task_id: number; amount: number; billed: boolean }[] }),
  ]);

  const reimbBy = new Map<number, { amount: number; reimbursed: boolean }>();
  for (const r of reimbRes.data ?? []) {
    if (r.liaison_task_id != null) {
      reimbBy.set(r.liaison_task_id, { amount: Number(r.amount), reimbursed: !!r.reimbursed });
    }
  }
  const mexpBy = new Map<number, { amount: number; billed: boolean }>();
  for (const m of mexpRes.data ?? []) {
    if (m.liaison_task_id != null) {
      mexpBy.set(m.liaison_task_id, { amount: Number(m.amount), billed: !!m.billed });
    }
  }

  const rows: ErrandCostRow[] = tasks.map((t) => {
    const zone = Array.isArray(t.transportation_zones)
      ? t.transportation_zones[0]
      : t.transportation_zones;
    const internalRate = Number(zone?.round_trip_rate ?? 0);
    const zoneExternalRate = Number(zone?.external_rate ?? 0);
    const billAtInternal = !!t.bill_at_internal;

    const reimb = reimbBy.get(t.id);
    const mexp = mexpBy.get(t.id);

    const internal = reimb ? reimb.amount : internalRate;
    // No-markup errands bill the internal amount; otherwise the zone external rate.
    const wouldBeExternal = billAtInternal ? internal : zoneExternalRate;
    const billable = mexp ? true : !!t.matter_id && wouldBeExternal > 0;
    const external = mexp ? mexp.amount : billable ? wouldBeExternal : 0;
    // Margin only applies to billable trips — a non-billable errand is an internal
    // cost, not a negative spread.
    const margin = billable ? external - internal : 0;

    return {
      id: t.id,
      date: t.scheduled_for,
      title: t.title,
      liaison: t.assigned_to_name || '(unassigned)',
      liaisonId: t.assigned_to || '',
      zoneName: zone?.name ?? null,
      matterName: t.matter_name ?? '',
      clientName: t.client_name ?? '',
      internal,
      external,
      margin,
      billable,
      billAtInternal,
      posted: !!reimb,
      reimbursed: reimb ? reimb.reimbursed : false,
      billed: mexp ? mexp.billed : false,
    };
  });

  const byLiaison = new Map<string, LiaisonCostSummary>();
  for (const r of rows) {
    const key = r.liaisonId || r.liaison;
    let s = byLiaison.get(key);
    if (!s) {
      s = {
        liaison: r.liaison,
        liaisonId: r.liaisonId,
        errands: 0,
        internalTotal: 0,
        externalTotal: 0,
        marginTotal: 0,
        billableErrands: 0,
        nonBillableErrands: 0,
        reimbursedCount: 0,
        billedCount: 0,
      };
      byLiaison.set(key, s);
    }
    s.errands += 1;
    s.internalTotal += r.internal;
    s.externalTotal += r.external;
    s.marginTotal += r.margin;
    if (r.billable) s.billableErrands += 1;
    else s.nonBillableErrands += 1;
    if (r.reimbursed) s.reimbursedCount += 1;
    if (r.billed) s.billedCount += 1;
  }

  const summaries = [...byLiaison.values()].sort((a, b) => b.internalTotal - a.internalTotal);

  return {
    start,
    end,
    rows,
    summaries,
    totals: {
      errands: rows.length,
      internalTotal: rows.reduce((s, r) => s + r.internal, 0),
      externalTotal: rows.reduce((s, r) => s + r.external, 0),
      marginTotal: rows.reduce((s, r) => s + r.margin, 0),
    },
    anyComputed: rows.some((r) => !r.posted),
  };
}
