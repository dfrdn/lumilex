/**
 * Shared billing-data fetch used by /api/finance/billing-data and the
 * regenerate-invoice flow. Returns the same payload the API endpoint produces.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { toDecimal } from '@/lib/dtr-utils';
import { getDTRBundleEntries, type DTRSnapshot } from '@/lib/queries/effective-dtr';
import { getExpenseRevisions, applyExpenseRevisions, type ExpenseEntry } from '@/lib/queries/effective-expenses';
import { resolveBundleRetainerParams, computeCapAwareFees } from '@/lib/billing/cap-split';
import {
  runningBalance,
  balanceInvoices,
  billingMonthEnd,
  type BalanceInvoice,
} from '@/lib/finance/client-balance';
import { invoiceOpenBalance } from '@/lib/finance/invoice-amounts';
import { deriveFeeLines } from '@/lib/billing/derive-fee-lines';
import { readClientProfile, type ClientBillingProfile } from '@/lib/billing/client-profile';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { dropClaimedFeeLines, oneTimeFeeClaims } from '@/lib/billing/off-cycle';
import { resolveLawyerPositions } from '@/lib/billing/lawyer-positions';

/** A non-DTR fee line — retainer, fixed-fee, per-action aggregate,
 *  per-milestone, or a free-form ad-hoc item added on a specific invoice.
 *  Surfaces alongside the lawyer-grouped DTR `lineItems` so totals stay
 *  coherent and the invoice record captures everything. */
export interface FeeLine {
  kind: 'retainer' | 'fixed_fee' | 'acceptance' | 'action' | 'milestone' | 'informational_hours' | 'discount' | 'adhoc';
  matterId: string | null;
  matterName: string | null;
  description: string;
  /** Negative for discount lines (a credit against the bill). */
  amount: number;
  /** For 'action': aggregated quantity within billing month. */
  quantity?: number;
  /** For 'action' / 'milestone': source row IDs so persist can flip invoiced. */
  sourceIds?: number[];
}

/** Per-matter context surfaced to the Invoice Generator so finance can log
 *  occurrences / mark milestones inline while previewing a bill. */
export interface MatterActionContext {
  matterId: string;
  matterName: string;
  /** All action definitions for this matter, in user-defined order. */
  actions: Array<{
    id: number;
    name: string;
    rate: number;
    cap: number | null;
    unit_label: string;
    /** Quantity already logged in the billing month (any invoiced state). */
    monthlyQuantity: number;
  }>;
  /** Unbilled entries in this billing month, most recent first. */
  entries: Array<{
    id: number;
    action_id: number;
    entry_date: string;
    quantity: number;
    description: string;
    invoiced: boolean;
  }>;
}

export interface MatterMilestoneContext {
  matterId: string;
  matterName: string;
  milestones: Array<{
    id: number;
    name: string;
    description: string;
    fee: number;
    target_date: string | null;
    reached_at: string | null;
    invoiced: boolean;
  }>;
}

export interface BillingDataResult {
  clientName: string;
  month: string;
  matters: (string | null)[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  lineItems: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  expenses: any[];
  /** Per-expense raw + revision + effective views for the Review editor. */
  expenseEntries: ExpenseEntry[];
  feeLines: FeeLine[];
  /** Per-matter action context for matters with billing_type='acceptance_per_action'. */
  actionContexts: MatterActionContext[];
  /** Per-matter milestone context for matters with billing_type='acceptance_per_milestone'. */
  milestoneContexts: MatterMilestoneContext[];
  totalHours: number;
  totalFees: number;
  totalExpenses: number;
  grandTotal: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  billingConfig: any | null;
  /** The client's billing profile — the letter and its recipient. Empty when none is saved. */
  clientProfile: ClientBillingProfile;
  /** Bundle-resolved retainer terms — the single shared cap + monthly retainer
   *  across ALL the client's matters (first non-null wins, via
   *  resolveBundleRetainerParams), NOT whichever matter sorts first by id. Use
   *  these for the invoice snapshot so a multi-matter client (e.g. a retainer
   *  matter alongside incorporation matters) bills against its one real cap. */
  retainerHoursCap: number | null;
  monthlyRetainer: number;
  /** Signed running balance with the client: positive = owed by client,
   *  negative = advance deposit credit owed to client. */
  clientReceivables: number | null;
  clientReceivablesUpdatedAt: string | null;
  /** Advance deposit held on hand (trust balance), independent of amount due. */
  clientDepositOnHand: number;
  excludedNonBillableCount: number;
  /** Attendees on billable time who resolve to no `team` row — their position,
   *  and so their rate, would be a guess. Their lines are priced at the junior
   *  card so a preview still renders, but generation refuses while this is
   *  non-empty (UnresolvedLawyerError). */
  unresolvedLawyers: string[];
}

export async function fetchBillingData(
  supabase: SupabaseClient,
  firmId: string,
  clientName: string,
  month: string,
): Promise<BillingDataResult> {
  // Get unbilled DTR entries for this client + month
  const startDate = `${month}-01`;
  const endDate = billingMonthEnd(month);

  // Get client's matters for expense lookup
  const { data: clientMatters } = await supabase
    .from('matters')
    .select('notion_id')
    .eq('client_name', clientName);
  const clientMatterIds = (clientMatters ?? []).map((m: { notion_id: string }) => m.notion_id);

  // Effective DTR entries (post finance revisions)
  const allBundleEntries = await getDTRBundleEntries(firmId, {
    billingMonth: month,
    clientNames: [clientName],
    includeNonBillable: true,
  });

  const billableEntries = allBundleEntries
    .filter((e) => e.effective && !e.effective.nonBillable && e.effective.date)
    .map((e) => e.effective!);
  const excludedNonBillableCount = allBundleEntries.filter(
    (e) => e.effective && e.effective.nonBillable,
  ).length;

  const [
    expensesResult, ratesResult, matterExpResult, billingConfigResult,
    actionsResult, actionEntriesResult, milestonesResult, matterNamesResult,
    expenseRevisions,
  ] = await Promise.all([
    supabase
      .from('reimbursements')
      .select('*')
      .eq('client_name', clientName)
      .gte('expense_date', startDate)
      .lte('expense_date', endDate)
      .eq('billed', false)
      .order('expense_date', { ascending: true }),
    supabase
      .from('billing_rates')
      .select('position, hourly_rate'),
    clientMatterIds.length > 0
      ? supabase
          .from('matter_expenses')
          .select('*')
          .in('matter_id', clientMatterIds)
          .gte('expense_date', startDate)
          .lte('expense_date', endDate)
          .eq('billed', false)
          .order('expense_date', { ascending: true })
      : Promise.resolve({ data: [], error: null }),
    clientMatterIds.length > 0
      ? supabase
          .from('matter_billing_configs')
          .select('*')
          .in('matter_id', clientMatterIds)
          .order('matter_id', { ascending: true })
      : Promise.resolve({ data: [], error: null }),
    clientMatterIds.length > 0
      ? supabase
          .from('matter_billing_actions')
          .select('*')
          .in('matter_id', clientMatterIds)
          .order('order_index', { ascending: true })
      : Promise.resolve({ data: [], error: null }),
    clientMatterIds.length > 0
      ? supabase
          .from('matter_action_entries')
          .select('*')
          .in('matter_id', clientMatterIds)
          .gte('entry_date', startDate)
          .lte('entry_date', endDate)
          .order('entry_date', { ascending: true })
      : Promise.resolve({ data: [], error: null }),
    clientMatterIds.length > 0
      ? supabase
          .from('matter_billing_milestones')
          .select('*')
          .in('matter_id', clientMatterIds)
          .order('order_index', { ascending: true })
      : Promise.resolve({ data: [], error: null }),
    clientMatterIds.length > 0
      ? supabase
          .from('matters')
          .select('notion_id, name, matter_code')
          .in('notion_id', clientMatterIds)
      : Promise.resolve({ data: [], error: null }),
    // Bundle-scoped expense edits/exclusions — fetched alongside the rest rather
    // than in a separate serial round-trip; applied to allExpenses below.
    getExpenseRevisions(firmId, month, clientName),
  ]);

  const { data: expenses } = expensesResult;
  const { data: rates } = ratesResult;
  const { data: matterExpenses } = matterExpResult;
  const { data: billingConfigs } = billingConfigResult;
  const { data: actions } = actionsResult;
  const { data: actionEntries } = actionEntriesResult;
  const { data: milestones } = milestonesResult;
  const { data: matterNames } = matterNamesResult;

  const matterNameById: Record<string, string> = {};
  const matterCodeById: Record<string, string> = {};
  (matterNames ?? []).forEach((m: { notion_id: string; name: string; matter_code: string | null }) => {
    matterNameById[m.notion_id] = m.name;
    if (m.matter_code) matterCodeById[m.notion_id] = m.matter_code;
  });

  const rateMap: Record<string, number> = {};
  (rates ?? []).forEach((r: { position: string; hourly_rate: number }) => {
    const rate = Number(r.hourly_rate);
    rateMap[r.position] = isNaN(rate) ? 0 : rate;
  });

  // Shared with the review preview and billing efficiency so every surface
  // resolves a lawyer the same way: by the stable author key as well as by
  // name, so a renamed partner never reprices as a junior.
  const lawyers = await resolveLawyerPositions(supabase, firmId, billableEntries);
  const { positionByLawyerName: positionMap, initialsByLawyerName: initialsMap, authorName } = lawyers;

  /** Attendee names that matched no team row. Their position — and so their
   *  rate — would have to be guessed. Reported, and generation refuses. */
  const unresolvedLawyers = new Set<string>();

  // Compose a DTR-style particulars line that mirrors the breakdown spreadsheet
  // download: "Task - Remarks (Firm Attendees: ...)" for meetings/hearings, or
  // "(Attendees: ...)" for internal discussions. Initials win over full names
  // when known.
  function composeParticulars(s: DTRSnapshot): string {
    const task = (s.task ?? '').trim();
    const remarks = (s.remarks ?? '').trim();
    const base = task && remarks ? `${task} - ${remarks}` : (task || remarks);
    const taskLower = task.toLowerCase();
    const attendeesLabel =
      taskLower === 'internal discussion' ? 'Attendees' :
      taskLower === 'meeting' || taskLower === 'hearing' ? 'Firm Attendees' :
      null;
    if (!attendeesLabel) return base;
    const seen = new Set<string>();
    const display: string[] = [];
    for (const n of [authorName(s), ...(s.withNames ?? [])]) {
      const trimmed = (n ?? '').trim();
      if (!trimmed) continue;
      const out = initialsMap[trimmed] || trimmed;
      const key = out.toLowerCase();
      if (!seen.has(key)) { seen.add(key); display.push(out); }
    }
    if (display.length === 0) return base;
    const suffix = `(${attendeesLabel}: ${display.join(', ')})`;
    return base ? `${base} ${suffix}` : suffix;
  }

  interface LawyerEntryOut {
    rawDtrId: string | null;
    date: string;
    remarks: string;
    task: string;
    /** Composed "Task - Remarks (Attendees: …)" line that the PDF/XLSX
     *  breakdown renders. Mirrors the dtr-export download so the invoice
     *  particulars match the DTR download verbatim. */
    description: string;
    hours: number;
    minutes: number;
    decimalHours: number;
    matterId: string | null;
    /** Matter identity carried into the breakdown so each lawyer's entries are
     *  grouped under "[code] Matter name". */
    matterName: string | null;
    matterCode: string | null;
    /** Waived (goodwill): shown in the breakdown but billed at ₱0. */
    waived: boolean;
  }
  const lawyerGroups: Record<string, {
    lawyerName: string;
    initials: string;
    position: string;
    hourlyRate: number;
    totalHours: number;
    entries: LawyerEntryOut[];
  }> = {};

  const rawIdBySnapshot = new Map<DTRSnapshot, string | null>();
  for (const e of allBundleEntries) {
    if (e.effective) rawIdBySnapshot.set(e.effective, e.rawId);
  }

  // Fan out across attendees (principal + with_names) at each lawyer's rate.
  for (const s of billableEntries) {
    const principal = authorName(s);
    const attendees = new Set<string>();
    if (principal) attendees.add(principal);
    for (const n of s.withNames ?? []) {
      if (n) attendees.add(n);
    }

    const decimal = toDecimal(s.hours ?? 0, s.minutes ?? 0);
    const rawDtrId = rawIdBySnapshot.get(s) ?? null;
    const particulars = composeParticulars(s);

    for (const name of attendees) {
      if (!lawyerGroups[name]) {
        // No team row means no position, and no position means the rate would
        // be a guess. Price it as junior so the rest of the bundle still
        // computes, but flag it — the bundle won't be allowed to bill.
        const resolved = positionMap[name];
        if (!resolved) unresolvedLawyers.add(name);
        const position = resolved ?? 'Junior Associate';
        lawyerGroups[name] = {
          lawyerName: name,
          initials: initialsMap[name] ?? '',
          position,
          hourlyRate: rateMap[position] ?? 0,
          totalHours: 0,
          entries: [],
        };
      }
      lawyerGroups[name].totalHours += decimal;
      lawyerGroups[name].entries.push({
        rawDtrId,
        date: s.date ?? '',
        remarks: s.remarks,
        task: s.task,
        description: particulars,
        hours: s.hours,
        minutes: s.minutes,
        decimalHours: decimal,
        matterId: s.matterId,
        matterName: s.matterId ? (matterNameById[s.matterId] ?? null) : null,
        matterCode: s.matterId ? (matterCodeById[s.matterId] ?? null) : null,
        // Per-attendee: only THIS attendee's fanned line is waived, not co-attendees.
        // Trim-tolerant to match compute-bundle-fees (fanOut trims; waived_with is verbatim).
        waived: (s.waivedWith ?? []).some((w) => w.trim() === name.trim()),
      });
    }
  }

  const lineItems = Object.values(lawyerGroups).map((g) => ({
    ...g,
    totalHours: Math.round(g.totalHours * 10) / 10,
    amount: Math.round(g.totalHours * g.hourlyRate * 100) / 100,
  }));

  const totalHours = lineItems.reduce((s, l) => s + l.totalHours, 0);

  // Hours per matter (used both for fixed-retainer informational rows and
  // for retainer/litigation invoices that report hours).
  const hoursByMatter: Record<string, number> = {};
  for (const s of billableEntries) {
    if (!s.matterId) continue;
    const dec = toDecimal(s.hours ?? 0, s.minutes ?? 0);
    hoursByMatter[s.matterId] = (hoursByMatter[s.matterId] ?? 0) + dec;
  }

  // Derive non-DTR fee lines from billing configs + action entries + milestones.
  const feeLines: FeeLine[] = [];
  const configByMatter: Record<string, {
    matter_id: string;
    billing_type: string;
    monthly_retainer: number | null;
    fixed_fee_amount: number | null;
    acceptance_fee: number | null;
    acceptance_fee_paid: boolean;
  }> = {};
  (billingConfigs ?? []).forEach((c: {
    matter_id: string;
    billing_type: string;
    monthly_retainer: number | null;
    fixed_fee_amount: number | null;
    acceptance_fee: number | null;
    acceptance_fee_paid: boolean;
  }) => {
    configByMatter[c.matter_id] = c;
  });

  // Acceptance / retainer / fixed-fee / informational rows + per-action
  // aggregates + milestones. Shared with the billing-review dashboard so the
  // two computations of "what this client bills" can't drift.
  // A one-time fee already on an off-cycle bill (awaiting approval, or a draft
  // not yet sent) stays off this one; once sent, its flag keeps it off.
  const offCycleClaims = await oneTimeFeeClaims(supabase, clientName, { offCycleOnly: true });
  feeLines.push(
    ...dropClaimedFeeLines(deriveFeeLines({
      configs: Object.values(configByMatter),
      // These arrive from `select('*')` (untyped); deriveFeeLines reads a fixed
      // subset of columns.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      actions: (actions ?? []) as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      actionEntries: (actionEntries ?? []) as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      milestones: (milestones ?? []) as any,
      hoursByMatter,
      matterNameById,
    }), offCycleClaims),
  );

  // Per-matter contexts for the Invoice Generator's inline logger + milestone toggle.
  const actionContexts: MatterActionContext[] = [];
  for (const c of Object.values(configByMatter)) {
    if (c.billing_type !== 'acceptance_per_action') continue;
    const matterActions = (actions ?? []).filter((a: { matter_id: string }) => a.matter_id === c.matter_id);
    if (matterActions.length === 0) continue;
    const monthlyQtyByAction: Record<number, number> = {};
    (actionEntries ?? []).forEach((e: { action_id: number; matter_id: string; quantity: number }) => {
      if (e.matter_id !== c.matter_id) return;
      monthlyQtyByAction[e.action_id] = (monthlyQtyByAction[e.action_id] ?? 0) + (e.quantity ?? 1);
    });
    actionContexts.push({
      matterId: c.matter_id,
      matterName: matterNameById[c.matter_id] ?? '',
      actions: matterActions.map((a: { id: number; name: string; rate: number; cap: number | null; unit_label: string }) => ({
        id: a.id,
        name: a.name,
        rate: Number(a.rate),
        cap: a.cap,
        unit_label: a.unit_label,
        monthlyQuantity: monthlyQtyByAction[a.id] ?? 0,
      })),
      entries: (actionEntries ?? [])
        .filter((e: { matter_id: string }) => e.matter_id === c.matter_id)
        .map((e: { id: number; action_id: number; entry_date: string; quantity: number; description: string; invoiced: boolean }) => ({
          id: e.id,
          action_id: e.action_id,
          entry_date: e.entry_date,
          quantity: e.quantity,
          description: e.description,
          invoiced: e.invoiced,
        })),
    });
  }

  const milestoneContexts: MatterMilestoneContext[] = [];
  for (const c of Object.values(configByMatter)) {
    if (c.billing_type !== 'acceptance_per_milestone') continue;
    const matterMilestones = (milestones ?? []).filter((m: { matter_id: string }) => m.matter_id === c.matter_id);
    if (matterMilestones.length === 0) continue;
    milestoneContexts.push({
      matterId: c.matter_id,
      matterName: matterNameById[c.matter_id] ?? '',
      milestones: matterMilestones.map((m: { id: number; name: string; description: string; fee: number; target_date: string | null; reached_at: string | null; invoiced: boolean }) => ({
        id: m.id,
        name: m.name,
        description: m.description,
        fee: Number(m.fee),
        target_date: m.target_date,
        reached_at: m.reached_at,
        invoiced: m.invoiced,
      })),
    });
  }

  // Union matter list: matters with DTR entries OR a billing config that
  // implies invoicing OR unbilled matter expenses OR unbilled action entries
  // OR reached-but-uninvoiced milestones.
  const matterSet = new Set<string>();
  for (const e of billableEntries) {
    if (e.matterId) matterSet.add(e.matterId);
  }
  for (const c of Object.values(configByMatter)) {
    if (
      c.billing_type === 'retainer' ||
      c.billing_type === 'fixed_retainer' ||
      c.billing_type === 'fixed_fee' ||
      c.billing_type === 'acceptance_per_action' ||
      c.billing_type === 'acceptance_per_milestone'
    ) {
      matterSet.add(c.matter_id);
    }
    if (
      !c.acceptance_fee_paid &&
      c.acceptance_fee != null &&
      c.acceptance_fee > 0 &&
      c.billing_type === 'litigation'
    ) {
      matterSet.add(c.matter_id);
    }
  }
  (matterExpenses ?? []).forEach((e: { matter_id: string }) => {
    if (e.matter_id) matterSet.add(e.matter_id);
  });
  (actionEntries ?? []).forEach((e: { matter_id: string }) => {
    if (e.matter_id) matterSet.add(e.matter_id);
  });
  (milestones ?? []).forEach((m: { matter_id: string }) => {
    if (m.matter_id) matterSet.add(m.matter_id);
  });
  const matters = [...matterSet];

  const allExpenses = [
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...(expenses ?? []).map((e: any) => {
      const amt = Number(e.amount);
      return {
        id: e.notion_id,
        date: e.expense_date,
        category: e.expense_category,
        expense: e.expense,
        amount: isNaN(amt) ? 0 : amt,
        matterName: e.matter_name,
        source: 'reimbursement' as const,
      };
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...(matterExpenses ?? []).map((e: any) => ({
      id: `mexp-${e.id}`,
      date: e.expense_date,
      category: e.category,
      expense: e.description,
      amount: Number(e.amount),
      matterName: null,
      source: 'finance' as const,
    })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ].sort((a: any, b: any) => (a.date ?? '').localeCompare(b.date ?? ''));

  // Layer finance's bundle-scoped expense edits/exclusions (mirrors the DTR
  // revision flow), using the revisions fetched in the Promise.all above. The
  // effective list drives the preview + the generated invoice; `expenseEntries`
  // carries raw+revision+effective for the editor.
  const { effective: effectiveExpenses, entries: expenseEntries } = applyExpenseRevisions(
    allExpenses,
    expenseRevisions,
  );
  const totalExpenses = effectiveExpenses.reduce((s, e) => {
    if (e.waived) return s; // waived expenses are shown but billed at ₱0
    const amt = Number(e.amount ?? 0);
    return s + (isNaN(amt) ? 0 : amt);
  }, 0);

  const primaryConfig = billingConfigs?.[0] ?? null;

  const { data: clientRow } = await supabase
    .from('clients')
    .select('notion_id, receivables, receivables_as_of, receivables_updated_at, deposit_balance')
    .eq('name', clientName)
    .maybeSingle();
  // The profile is finance's; read it on the firm-scoped client so whoever
  // previews or generates the bill gets the same letter settings.
  const { data: profileRow } = clientRow?.notion_id
    ? await getServiceDbForFirm(firmId).from('client_billing_profiles').select('settings').eq('client_id', clientRow.notion_id).maybeSingle()
    : { data: null };

  // Outstanding balance "as of" date: the business date finance recorded, else
  // the day the row was last edited. It both drives the invoice's "as of" label
  // AND gates whether the opening figure belongs on this bill — an opening dated
  // after the billing month's end is from a later period and is left off.
  const receivablesAsOf: string | null =
    clientRow?.receivables_as_of ??
    (clientRow?.receivables_updated_at
      ? new Date(clientRow.receivables_updated_at).toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' })
      : null);
  const rawReceivables = clientRow?.receivables == null ? null : Number(clientRow.receivables);
  const openingApplies =
    rawReceivables != null && (receivablesAsOf == null || receivablesAsOf <= endDate);

  // True running balance going INTO this billing month = opening figure + every
  // still-open invoice issued before it. Reuses the same helper the receivables
  // page uses (lib/finance/client-balance) so the "Previous Balance" on the
  // letter can never drift from the A/R page again.
  // Only SENT invoices (and partials / legacy paid-with-residual) count toward a
  // client's previous balance — a draft hasn't been billed to them yet.
  const { data: openInvoiceRows } = await supabase
    .from('invoices')
    .select('billing_month, total_amount, total_expenses, paid_amount, sent_date, created_at, billing_settings')
    .eq('client_name', clientName)
    .in('status', ['sent', 'partial', 'paid']);
  const openInvoices: BalanceInvoice[] = (openInvoiceRows ?? [])
    .map((r) => ({
      billingMonth: r.billing_month as string,
      // VAT-inclusive — the carried balance must match what the client was billed.
      balance: invoiceOpenBalance(r),
      sentDate: (r.sent_date as string | null) ?? null,
      createdDate: typeof r.created_at === 'string' ? r.created_at.split('T')[0] : null,
    }))
    .filter((i) => i.balance > 0.005);
  const balanceInputs = {
    receivables: openingApplies ? rawReceivables : null,
    receivablesAsOf,
    invoices: openInvoices,
  };
  const prevBalance = runningBalance(balanceInputs, month);
  const prevBalanceRounded = Math.round(prevBalance * 100) / 100;
  // "As of" for the label: the NEWEST date among the pieces that make up the
  // carried balance — the override's recorded date and the close of every billed
  // period stacked on top of it. A later billing supersedes the override's date,
  // so a June letter carrying April's opening plus May's invoice reads "as of
  // 31 May 2026", not "as of 30 April 2026". Dated by billing period rather than
  // sent_date so the label describes what the balance covers and doesn't drift
  // with when finance happened to press Send (nor land inside the month being
  // billed, whose charges are NOT in this figure). Never "today", which would
  // misdate a months-old balance.
  const carriedMonthEnds = balanceInvoices(balanceInputs, month)
    .map((i) => (i.billingMonth ? billingMonthEnd(i.billingMonth) : null));
  const balanceAsOf = [openingApplies ? receivablesAsOf : null, ...carriedMonthEnds]
    .reduce<string | null>((m, d) => (d && (!m || d > m) ? d : m), null);

  // Cap-aware legal fees. Hours within the retainer cap are absorbed by the
  // flat monthly retainer; only hours beyond the cap bill hourly. This mirrors
  // lib/billing/persist-invoice (same splitLineItemsAtCap on the same
  // lineItems) so the Generate preview and the persisted invoice are identical,
  // and matches the Billing Review engine for the reported case. `totalFees`
  // (the all-hours sum above) is used only as the no-cap hourly charge.
  const { retainerHoursCap, monthlyRetainer } = resolveBundleRetainerParams(
    (billingConfigs ?? []) as Array<{ retainer_hours_cap: number | null; monthly_retainer: number | null }>,
  );
  // Shared roll-up so the Generate preview and the persisted invoice agree.
  // Retainer is counted once via `monthlyRetainer`; retainer fee lines are
  // excluded from the total but stay in `feeLines` for display.
  const grandFees = computeCapAwareFees(lineItems, retainerHoursCap, monthlyRetainer, feeLines).legalFees;

  return {
    clientName,
    month,
    matters,
    lineItems,
    expenses: effectiveExpenses,
    expenseEntries,
    feeLines,
    actionContexts,
    milestoneContexts,
    totalHours: Math.round(totalHours * 10) / 10,
    totalFees: Math.round(grandFees * 100) / 100,
    totalExpenses: Math.round(totalExpenses * 100) / 100,
    grandTotal: Math.round((grandFees + totalExpenses) * 100) / 100,
    billingConfig: primaryConfig,
    clientProfile: readClientProfile(profileRow?.settings),
    retainerHoursCap,
    monthlyRetainer,
    clientReceivables: prevBalanceRounded !== 0 ? prevBalanceRounded : null,
    clientReceivablesUpdatedAt: prevBalanceRounded !== 0 ? balanceAsOf : null,
    clientDepositOnHand: Math.round(Number(clientRow?.deposit_balance ?? 0) * 100) / 100,
    excludedNonBillableCount,
    unresolvedLawyers: [...unresolvedLawyers].sort(),
  };
}
