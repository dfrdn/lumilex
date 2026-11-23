import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { getAllClients } from '@/lib/queries/listing';
import { getPartnerPickerData } from '@/lib/queries/people';
import {
  computeProfitability,
  groupByClient,
  BILLED_STATUSES,
  type ClientProfit,
  type MatterProfit,
} from '@/lib/finance/profitability';
import { deriveClientLifecycle, ACTIVE_MATTER_STATUSES, type ClientLifecycle } from '@/lib/clients/lifecycle';
import { invoiceGrossDue } from '@/lib/finance/invoice-amounts';
import { addMonths, manilaToday } from '@/lib/dates';

export interface ClientManagementRow {
  id: string;
  name: string;
  clientCode: string;
  /** Lifecycle derived from matters (Prospective / Active / Inactive). */
  lifecycle: ClientLifecycle;
  priority: boolean;
  /** Relationship partner assigned to this client (team.person_id), or null. */
  relationshipPartnerId: string | null;
  /** Resolved display name for the relationship partner, or null when unassigned. */
  relationshipPartnerName: string | null;
  /** Cash actually collected in the trailing 12 months. Headline + default sort. */
  collected12mo: number;
  revenue: number;
  profit: number;
  margin: number;
  /** True when the client has ≥1 billed invoice — else money columns read "Not billed". */
  hasProfitData: boolean;
  activeMatterCount: number;
  matterCount: number;
  /** Most recent of latest matter created_time / latest invoice sent_date. */
  lastActivityAt: string | null;
  receivables: number | null;
}

const BILLED_STATUS_SET = new Set<string>(BILLED_STATUSES as unknown as string[]);

function twelveMonthsAgoISO(): string {
  return addMonths(manilaToday(), -12);
}

/**
 * Assemble one row per client for the partner client-management list.
 *
 * Everything is keyed by client **id** (matters/invoices carry `client_id`),
 * with a name→id fallback for legacy rows whose `client_id` is null — so a
 * renamed client still matches its matters and billings.
 */
export async function getClientManagementRows(firmId: string): Promise<ClientManagementRow[]> {
  const supabase = getServiceDbForFirm(firmId);
  const cutoff = twelveMonthsAgoISO();

  const [clients, profitMatters, mattersRes, invoicesRes, activityRes, partnerData] = await Promise.all([
    getAllClients(firmId),
    computeProfitability(supabase, firmId),
    supabase.from('matters').select('client_id, client_name, status'),
    supabase.from('invoices').select('id, client_id, client_name'),
    // "Last touched" per client across DTR, deliverables, hearings, meetings,
    // tasks, filings, matters, invoices and payments (future events excluded).
    supabase.rpc('client_last_activity', { p_firm_id: firmId }),
    getPartnerPickerData(firmId),
  ]);

  const nameByPersonId = partnerData.nameById;

  const lastActivity = new Map<string, string>();
  for (const a of (activityRes.data ?? []) as { client_id: string; last_activity: string }[]) {
    if (a.client_id && a.last_activity) lastActivity.set(a.client_id, a.last_activity);
  }

  // name → id resolver for rows missing client_id.
  const idByName = new Map<string, string>();
  for (const c of clients) if (c.name) idByName.set(c.name, c.id);
  const resolveId = (clientId: string | null, clientName: string | null): string | null =>
    clientId ?? (clientName ? idByName.get(clientName) ?? null : null);

  // Profit rolled up per client id.
  const profitByClient = new Map<string, ClientProfit>();
  for (const c of groupByClient(profitMatters)) {
    const key = resolveId(c.clientId, c.clientName);
    if (key) profitByClient.set(key, c);
  }

  // Matter counts per client id.
  const matterCount = new Map<string, number>();
  const activeMatterCount = new Map<string, number>();
  for (const m of (mattersRes.data ?? []) as { client_id: string | null; client_name: string | null; status: string | null }[]) {
    const key = resolveId(m.client_id, m.client_name);
    if (!key) continue;
    matterCount.set(key, (matterCount.get(key) ?? 0) + 1);
    if (ACTIVE_MATTER_STATUSES.has((m.status ?? '').toLowerCase())) {
      activeMatterCount.set(key, (activeMatterCount.get(key) ?? 0) + 1);
    }
  }

  // id→client map for attributing payments to clients.
  const invoiceClient = new Map<number, string>();
  for (const inv of (invoicesRes.data ?? []) as { id: number; client_id: string | null; client_name: string | null }[]) {
    const key = resolveId(inv.client_id, inv.client_name);
    if (key) invoiceClient.set(inv.id, key);
  }

  // Collected in the trailing 12 months, summed per client via invoice_payments.
  const { data: payments } = await supabase
    .from('invoice_payments')
    .select('invoice_id, amount, payment_date')
    .gte('payment_date', cutoff);
  const collected12mo = new Map<string, number>();
  for (const p of (payments ?? []) as { invoice_id: number; amount: number | null; payment_date: string }[]) {
    const key = invoiceClient.get(p.invoice_id);
    if (!key) continue;
    collected12mo.set(key, (collected12mo.get(key) ?? 0) + (Number(p.amount) || 0));
  }

  return clients.map((c) => {
    const profit = profitByClient.get(c.id);
    const mc = matterCount.get(c.id) ?? 0;
    const amc = activeMatterCount.get(c.id) ?? 0;
    return {
      id: c.id,
      name: c.name,
      clientCode: c.clientCode,
      lifecycle: deriveClientLifecycle(mc, amc),
      priority: c.priority,
      relationshipPartnerId: c.relationshipPartnerId,
      relationshipPartnerName: c.relationshipPartnerId ? nameByPersonId[c.relationshipPartnerId] ?? null : null,
      collected12mo: collected12mo.get(c.id) ?? 0,
      revenue: profit?.revenue ?? 0,
      profit: profit?.profit ?? 0,
      margin: profit?.margin ?? 0,
      hasProfitData: profit?.hasProfitData ?? false,
      activeMatterCount: amc,
      matterCount: mc,
      lastActivityAt: lastActivity.get(c.id) ?? null,
      receivables: c.receivables,
    };
  });
}

export interface ClientFinancialDetail {
  matters: MatterProfit[];
  revenue: number;
  profit: number;
  totalCost: number;
  margin: number;
  hasProfitData: boolean;
  billed: number;
  collectedLifetime: number;
  collected12mo: number;
  collectionRate: number | null;
  outstandingReceivables: number | null;
  overdueAmount: number;
}

/** Full financial breakdown for a single client's detail page, keyed by client id. */
export async function getClientFinancialDetail(firmId: string, 
  clientId: string,
  receivables: number | null,
): Promise<ClientFinancialDetail> {
  const supabase = getServiceDbForFirm(firmId);
  const cutoff = twelveMonthsAgoISO();
  const today = manilaToday();

  const [matters, invoicesRes] = await Promise.all([
    computeProfitability(supabase, firmId, { clientId }),
    supabase
      .from('invoices')
      .select('id, total_amount, total_expenses, status, due_date, paid_amount, billing_settings')
      .eq('client_id', clientId),
  ]);

  // Billed and collected are both on the FULL-invoice basis (fees + expenses +
  // VAT), so collectionRate is comparable to the gross cash collected.
  let billed = 0;
  let overdueAmount = 0;
  const invoiceIds: number[] = [];
  for (const inv of (invoicesRes.data ?? []) as {
    id: number;
    total_amount: number | null;
    total_expenses: number | null;
    status: string | null;
    due_date: string | null;
    paid_amount: number | null;
    billing_settings: { includeVAT?: boolean | string | null } | null;
  }[]) {
    invoiceIds.push(inv.id);
    if (!BILLED_STATUS_SET.has((inv.status ?? '').toLowerCase())) continue;
    const due = invoiceGrossDue(inv);
    billed += due;
    const unpaid = due - (Number(inv.paid_amount) || 0);
    if ((inv.status ?? '').toLowerCase() !== 'paid' && unpaid > 0 && inv.due_date && inv.due_date < today) {
      overdueAmount += unpaid;
    }
  }

  let collectedLifetime = 0;
  let collected12mo = 0;
  if (invoiceIds.length) {
    const { data: payments } = await supabase
      .from('invoice_payments')
      .select('amount, payment_date')
      .in('invoice_id', invoiceIds);
    for (const p of (payments ?? []) as { amount: number | null; payment_date: string }[]) {
      const amt = Number(p.amount) || 0;
      collectedLifetime += amt;
      if (p.payment_date >= cutoff) collected12mo += amt;
    }
  }

  const revenue = matters.reduce((s, m) => s + m.revenue, 0);
  const totalCost = matters.reduce((s, m) => s + m.totalCost, 0);
  const profit = revenue - totalCost;
  const margin = revenue > 0 ? (profit / revenue) * 100 : 0;

  return {
    matters,
    revenue,
    profit,
    totalCost,
    margin,
    hasProfitData: revenue > 0,
    billed,
    collectedLifetime,
    collected12mo,
    collectionRate: billed > 0 ? (collectedLifetime / billed) * 100 : null,
    outstandingReceivables: receivables,
    overdueAmount,
  };
}
