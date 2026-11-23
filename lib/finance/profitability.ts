import type { SupabaseClient } from '@supabase/supabase-js';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';

const WORKING_HOURS_PER_MONTH = 176; // 22 days × 8 hrs

/**
 * Invoice statuses that represent recognized (billed) revenue. 'partial' is
 * included deliberately: a partially-paid invoice has been billed, so its full
 * face value (`total_amount`) counts as billed revenue — collections are
 * tracked separately via invoice_payments.
 */
export const BILLED_STATUSES = ['sent', 'partial', 'paid'] as const;

interface LineItem {
  lawyerName: string;
  position: string;
  hourlyRate: number;
  totalHours: number;
  amount: number;
  entries: { id: string; date: string; decimalHours: number; matterId?: string }[];
}

export interface MatterProfit {
  matterId: string;
  matterName: string;
  clientId: string | null;
  clientName: string;
  matterType: string;
  revenue: number;
  laborCost: number;
  expenseCost: number;
  totalCost: number;
  profit: number;
  margin: number;
  lawyerBreakdown: { name: string; hours: number; laborCost: number; billedAmount: number }[];
  expenseBreakdown: { category: string; amount: number }[];
}

export interface ProfitabilityFilters {
  /** Restrict to one client by id (clients.notion_id / matters.client_id). Preferred. */
  clientId?: string;
  /** Restrict to one client by name (matches matters.client_name). Legacy filter. */
  clientName?: string;
  /** Inclusive lower bound on invoice billing_month (YYYY-MM…). */
  from?: string;
  /** Inclusive upper bound on invoice billing_month (YYYY-MM…). */
  to?: string;
}

interface InvoiceRow {
  id: number;
  client_name: string | null;
  client_id: string | null;
  matter_id: string | null;
  line_items: LineItem[] | null;
  total_amount: number | null;
  status: string | null;
  billing_month: string | null;
}

/**
 * Per-matter profitability. Revenue is the canonical billed figure
 * (`invoices.total_amount`, which already folds in retainers, fixed fees,
 * acceptance fees and discounts — see lib/billing/persist-invoice.ts).
 *
 * Each invoice's total_amount is distributed across the matters its line-item
 * entries touch (weighted by hourly billed amount), so multi-matter bundles and
 * null-`matter_id` invoices are attributed consistently with the labor side.
 * Invoices with no hourly entries fall back to their header `matter_id`.
 *
 * `supabase` is a caller-provided client (authed for API routes, service-role
 * for role-gated server pages) — the caller owns the auth/role decision.
 * Salaries are always read through the firm's service client: every caller
 * gates by role (finance / partner / super_user) first, and monthly_salary is
 * not for a user JWT to read.
 */
export async function computeProfitability(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, 'public', any>,
  firmId: string,
  filters?: ProfitabilityFilters,
): Promise<MatterProfit[]> {
  const { clientId, clientName, from, to } = filters ?? {};
  const scoped = !!(clientId || clientName);

  // 1. Invoices — total_amount for revenue, line_items for labor hours.
  let invoiceQuery = supabase
    .from('invoices')
    .select('id, client_name, client_id, matter_id, line_items, total_amount, status, billing_month')
    .in('status', BILLED_STATUSES as unknown as string[]);
  if (clientId) invoiceQuery = invoiceQuery.eq('client_id', clientId);
  else if (clientName) invoiceQuery = invoiceQuery.eq('client_name', clientName);
  if (from) invoiceQuery = invoiceQuery.gte('billing_month', from.slice(0, 7));
  if (to) invoiceQuery = invoiceQuery.lte('billing_month', to.slice(0, 7));

  // 2. Matters metadata (scoped to the client when filtering).
  let matterQuery = supabase.from('matters').select('notion_id, name, client_name, client_id, type');
  if (clientId) matterQuery = matterQuery.eq('client_id', clientId);
  else if (clientName) matterQuery = matterQuery.eq('client_name', clientName);

  // 3. Team salaries for labor cost (always firm-wide — keyed by name).
  const teamQuery = getServiceDbForFirm(firmId).from('team').select('name, monthly_salary, position').eq('active', true);

  const [{ data: invoices }, { data: matters }, { data: teamData }] = await Promise.all([
    invoiceQuery,
    matterQuery,
    teamQuery,
  ]);

  const salaryMap = new Map<string, number>();
  for (const t of (teamData ?? []) as { name: string; monthly_salary: number | null }[]) {
    if (t.monthly_salary) salaryMap.set(t.name, Number(t.monthly_salary));
  }

  const matterMap = new Map<string, { name: string; clientName: string; clientId: string | null; type: string }>();
  for (const m of (matters ?? []) as { notion_id: string; name: string; client_name: string; client_id: string | null; type: string }[]) {
    matterMap.set(m.notion_id, { name: m.name, clientName: m.client_name, clientId: m.client_id, type: m.type ?? '' });
  }

  // 4 & 5. Expenses + reimbursements (firm-borne cost), scoped to this client's
  // matters when filtering to avoid full-table scans on detail pages.
  let expQuery = supabase.from('matter_expenses').select('matter_id, amount, category');
  let reimbQuery = supabase.from('reimbursements').select('matter_id, amount, expense_category');
  if (scoped) {
    const ids = [...matterMap.keys()];
    expQuery = expQuery.in('matter_id', ids);
    reimbQuery = reimbQuery.in('matter_id', ids);
  }
  const [{ data: matterExpenses }, { data: reimbursements }] = await Promise.all([expQuery, reimbQuery]);

  // ── Revenue + labor per matter ──
  const revenueByMatter = new Map<string, number>();
  const lawyerHoursByMatter = new Map<string, Map<string, { hours: number; billedAmount: number }>>();

  for (const inv of (invoices ?? []) as InvoiceRow[]) {
    // Per-matter hourly weight for THIS invoice (also feeds labor accumulation).
    const weightByMatter = new Map<string, number>();
    let totalWeight = 0;

    for (const li of inv.line_items ?? []) {
      for (const entry of li.entries ?? []) {
        const mid = entry.matterId ?? inv.matter_id;
        if (!mid) continue;
        const hours = Number(entry.decimalHours) || 0;
        const billedAmount = hours * (Number(li.hourlyRate) || 0);

        if (!lawyerHoursByMatter.has(mid)) lawyerHoursByMatter.set(mid, new Map());
        const lm = lawyerHoursByMatter.get(mid)!;
        const existing = lm.get(li.lawyerName) ?? { hours: 0, billedAmount: 0 };
        existing.hours += hours;
        existing.billedAmount += billedAmount;
        lm.set(li.lawyerName, existing);

        weightByMatter.set(mid, (weightByMatter.get(mid) ?? 0) + billedAmount);
        totalWeight += billedAmount;
      }
    }

    const total = Number(inv.total_amount) || 0;
    if (weightByMatter.size > 0 && totalWeight > 0) {
      // Distribute by hourly weight (handles multi-matter bundles).
      for (const [mid, w] of weightByMatter) {
        revenueByMatter.set(mid, (revenueByMatter.get(mid) ?? 0) + total * (w / totalWeight));
      }
    } else if (weightByMatter.size > 0) {
      // Entries exist but zero hourly value (e.g. informational hours) — split evenly.
      const share = total / weightByMatter.size;
      for (const mid of weightByMatter.keys()) {
        revenueByMatter.set(mid, (revenueByMatter.get(mid) ?? 0) + share);
      }
    } else if (inv.matter_id) {
      // No hourly entries (pure fixed-fee / retainer) — attribute to the header matter.
      revenueByMatter.set(inv.matter_id, (revenueByMatter.get(inv.matter_id) ?? 0) + total);
    }
    // else: no entries and no matter_id → cannot attribute (rare consolidated invoice).
  }

  // ── Expense cost per matter ──
  const expenseCostByMatter = new Map<string, Map<string, number>>();

  for (const e of (matterExpenses ?? []) as { matter_id: string; amount: number; category: string }[]) {
    if (!expenseCostByMatter.has(e.matter_id)) expenseCostByMatter.set(e.matter_id, new Map());
    const cm = expenseCostByMatter.get(e.matter_id)!;
    cm.set(e.category, (cm.get(e.category) ?? 0) + Number(e.amount));
  }

  for (const r of (reimbursements ?? []) as { matter_id: string | null; amount: number; expense_category: string }[]) {
    if (!r.matter_id) continue;
    if (!expenseCostByMatter.has(r.matter_id)) expenseCostByMatter.set(r.matter_id, new Map());
    const cm = expenseCostByMatter.get(r.matter_id)!;
    const cat = r.expense_category ?? 'Other';
    cm.set(cat, (cm.get(cat) ?? 0) + Number(r.amount));
  }

  // ── Build profitability per matter ──
  const allMatterIds = new Set([...revenueByMatter.keys(), ...expenseCostByMatter.keys()]);
  const results: MatterProfit[] = [];

  for (const mid of allMatterIds) {
    const info = matterMap.get(mid);
    if (!info) continue; // matter not in scope / unknown

    const revenue = revenueByMatter.get(mid) ?? 0;

    let laborCost = 0;
    const lawyerBreakdown: MatterProfit['lawyerBreakdown'] = [];
    const lm = lawyerHoursByMatter.get(mid);
    if (lm) {
      for (const [lawyerName, data] of lm) {
        const salary = salaryMap.get(lawyerName);
        const hourlyLaborCost = salary ? salary / WORKING_HOURS_PER_MONTH : 0;
        const cost = hourlyLaborCost * data.hours;
        laborCost += cost;
        lawyerBreakdown.push({ name: lawyerName, hours: data.hours, laborCost: cost, billedAmount: data.billedAmount });
      }
    }

    let expenseCost = 0;
    const expenseBreakdown: MatterProfit['expenseBreakdown'] = [];
    const em = expenseCostByMatter.get(mid);
    if (em) {
      for (const [category, amount] of em) {
        expenseCost += amount;
        expenseBreakdown.push({ category, amount });
      }
    }

    const totalCost = laborCost + expenseCost;
    const profit = revenue - totalCost;
    const margin = revenue > 0 ? (profit / revenue) * 100 : 0;

    results.push({
      matterId: mid,
      matterName: info.name,
      clientId: info.clientId,
      clientName: info.clientName,
      matterType: info.type,
      revenue,
      laborCost,
      expenseCost,
      totalCost,
      profit,
      margin,
      lawyerBreakdown: lawyerBreakdown.sort((a, b) => b.hours - a.hours),
      expenseBreakdown: expenseBreakdown.sort((a, b) => b.amount - a.amount),
    });
  }

  results.sort((a, b) => b.revenue - a.revenue);
  return results;
}

export interface ClientProfit {
  clientId: string | null;
  clientName: string;
  revenue: number;
  laborCost: number;
  expenseCost: number;
  profit: number;
  margin: number;
  matterCount: number;
  /** True when the client has ≥1 matter with billed revenue. */
  hasProfitData: boolean;
}

/** Roll per-matter profitability up to one row per client, keyed by client id. */
export function groupByClient(matters: MatterProfit[]): ClientProfit[] {
  const byClient = new Map<string, ClientProfit>();
  for (const m of matters) {
    const key = m.clientId ?? `name:${m.clientName}`;
    if (!key) continue;
    const c = byClient.get(key) ?? {
      clientId: m.clientId,
      clientName: m.clientName,
      revenue: 0,
      laborCost: 0,
      expenseCost: 0,
      profit: 0,
      margin: 0,
      matterCount: 0,
      hasProfitData: false,
    };
    c.revenue += m.revenue;
    c.laborCost += m.laborCost;
    c.expenseCost += m.expenseCost;
    c.profit += m.profit;
    c.matterCount += 1;
    if (m.revenue > 0) c.hasProfitData = true;
    byClient.set(key, c);
  }
  for (const c of byClient.values()) {
    c.margin = c.revenue > 0 ? (c.profit / c.revenue) * 100 : 0;
  }
  return [...byClient.values()];
}
