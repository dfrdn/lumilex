import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { isManagingPartner } from '@/lib/auth/isManagingPartner';
import { getDTRBundleEntries } from '@/lib/queries/effective-dtr';
import { computeBundleFees, type MatterBillingConfig } from '@/lib/billing/compute-bundle-fees';
import { deriveFeeLines, sumChargedFeeLines, parseAdHocFeeLines } from '@/lib/billing/derive-fee-lines';
import { dropClaimedFeeLines, oneTimeFeeClaimsByClient } from '@/lib/billing/off-cycle';
import { runningBalance, type BalanceInvoice } from '@/lib/finance/client-balance';
import { invoiceOpenBalance } from '@/lib/finance/invoice-amounts';
import { BILLED_STATUSES } from '@/lib/finance/profitability';
import { manilaToday } from '@/lib/dates';
import { resolveLawyerPositions } from '@/lib/billing/lawyer-positions';

const BILLED_STATUS_SET = new Set<string>((BILLED_STATUSES as readonly string[]).map((s) => s.toLowerCase()));

interface InvoiceRiskRow {
  client_name: string | null;
  billing_month: string | null;
  total_amount: number | string | null;
  total_expenses: number | string | null;
  paid_amount: number | string | null;
  status: string | null;
  due_date: string | null;
  sent_date: string | null;
  created_at: string | null;
  billing_settings: { includeVAT?: unknown } | null;
}

interface ReviewRow {
  client_name: string;
  status: 'pending' | 'approved' | 'rejected';
  clearance_status: 'cleared' | 'declined' | null;
  cleared_at: string | null;
  reviewed_at: string | null;
  // NULL means the row only exists to hold an invoice_settings_override
  // staged before formal submission.
  submitted_at: string | null;
  invoice_settings_override: Record<string, unknown> | null;
}

interface RawCountRow {
  client_name: string;
}

interface RevisionRow {
  client_name: string;
  original_dtr_id: string | null;
  created_entry_key: string | null;
  edited_at: string;
}

/**
 * GET /api/finance/dtr-review/clients?month=YYYY-MM
 * Lists every non-prospective client (plus anyone with DTR activity or a review
 * row this month), with their bundle review status, revision count, and a
 * preview of total legal fees. Entry point for the finance billing-review UI.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const role = session.user.role;
  const isMP = await isManagingPartner(session.user.notionUserId, session.firmId);
  // Finance/super_user/managing partner/partner can read; lawyers cannot.
  if (role !== 'finance' && role !== 'super_user' && role !== 'partner' && !isMP) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const month = req.nextUrl.searchParams.get('month');
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: 'month must be YYYY-MM' }, { status: 400 });
  }

  const [yStr, mStr] = month.split('-');
  const y = parseInt(yStr);
  const m = parseInt(mStr);
  const lastDay = new Date(y, m, 0).getDate();
  const start = `${yStr}-${mStr}-01`;
  const end = `${yStr}-${mStr}-${String(lastDay).padStart(2, '0')}`;

  const supabase = await getSupabaseServerAuthClient();

  const [
    { data: rawData, error: rawErr },
    { data: revData, error: revErr },
    { data: reviewData, error: reviewErr },
    // Every non-prospective client is billable and should appear in review,
    // even with zero DTR activity this month (retainer / fixed-fee clients, or
    // inactive clients the firm still bills monthly like Meralco).
    { data: clientRows, error: clientErr },
    // Full matter→client map so each surfaced client's billing configs resolve
    // (retainer cap, fixed fee) regardless of matter status or DTR activity.
    { data: matterRows, error: matterErr },
  ] = await Promise.all([
    supabase.from('dtr').select('client_name').gte('date', start).lte('date', end).neq('client_name', ''),
    supabase
      .from('dtr_revisions')
      .select('client_name, original_dtr_id, created_entry_key, edited_at')
      .eq('billing_month', month),
    supabase
      .from('dtr_revision_reviews')
      .select('client_name, status, clearance_status, cleared_at, reviewed_at, submitted_at, invoice_settings_override')
      .eq('billing_month', month),
    supabase.from('clients').select('name, status, collection_risk, receivables, receivables_as_of, relationship_partner_id'),
    supabase.from('matters').select('notion_id, client_name'),
  ]);

  if (rawErr) return NextResponse.json({ error: rawErr.message }, { status: 500 });
  if (revErr) return NextResponse.json({ error: revErr.message }, { status: 500 });
  if (reviewErr) return NextResponse.json({ error: reviewErr.message }, { status: 500 });
  if (clientErr) return NextResponse.json({ error: clientErr.message }, { status: 500 });
  if (matterErr) return NextResponse.json({ error: matterErr.message }, { status: 500 });

  const rawCounts: Record<string, number> = {};
  for (const r of (rawData ?? []) as RawCountRow[]) {
    if (!r.client_name) continue;
    rawCounts[r.client_name] = (rawCounts[r.client_name] ?? 0) + 1;
  }

  // Count distinct logical entities revised per client (latest per identity)
  const revsByClient: Record<string, Set<string>> = {};
  for (const r of (revData ?? []) as RevisionRow[]) {
    const key = r.original_dtr_id ?? `new:${r.created_entry_key ?? ''}`;
    (revsByClient[r.client_name] ||= new Set()).add(key);
  }

  const reviewsByClient: Record<string, ReviewRow> = {};
  for (const r of (reviewData ?? []) as ReviewRow[]) {
    reviewsByClient[r.client_name] = r;
  }

  // Every client that isn't a prospect — surfaced regardless of DTR activity.
  // Also stash each client's payment-risk inputs (finance's manual "unlikely to
  // pay" flag + opening receivables anchor) for the risk signals computed below.
  const nonProspectiveClients = new Set<string>();
  const riskByName = new Map<
    string,
    { collectionRisk: boolean; receivables: number | null; receivablesAsOf: string | null }
  >();
  // Who may clear each client's bundle, and whose queue it lands in.
  const relationshipPartnerByName = new Map<string, string | null>();
  for (const c of (clientRows ?? []) as {
    name: string | null;
    status: string | null;
    collection_risk: boolean | null;
    receivables: number | null;
    receivables_as_of: string | null;
    relationship_partner_id: string | null;
  }[]) {
    if (!c.name) continue;
    if (c.status !== 'Prospective') nonProspectiveClients.add(c.name);
    relationshipPartnerByName.set(c.name, c.relationship_partner_id ?? null);
    riskByName.set(c.name, {
      collectionRisk: c.collection_risk ?? false,
      receivables: c.receivables,
      receivablesAsOf: c.receivables_as_of,
    });
  }

  // Union: every non-prospective client, plus anyone with DTR activity or a
  // review row this month (so a prospect with billable hours isn't hidden).
  const allClients = new Set<string>([
    ...nonProspectiveClients,
    ...Object.keys(rawCounts),
    ...Object.keys(reviewsByClient),
  ]);
  const clientNames = [...allClients];

  // ── Payment-risk signals per client ──
  // `invoices` / `invoice_payments` RLS grants team read only to
  // finance/admin/super_user — NOT partner — so on this partner-facing route the
  // authed client would return 0 rows and every client would look risk-free.
  // Read them via the service-role client instead; the role gate at the top of
  // the handler is the authorization (same pattern the partner client-detail
  // page already uses). Yields overdue balance + overall running balance so the
  // UI can flag clients that are late or already flagged "unlikely to pay".
  const overdueByClient: Record<string, number> = {};
  const outstandingByClient: Record<string, number> = {};
  // Clients whose invoice for THIS month has gone out (sent, part-paid, paid).
  // "Generate cleared" leaves them alone — see sentInvoiceSkipReason.
  const billedThisMonth = new Set<string>();
  if (clientNames.length > 0) {
    const service = getServiceDbForFirm(session.firmId);
    const today = manilaToday();
    const { data: invRiskRows, error: invRiskErr } = await service
      .from('invoices')
      .select('client_name, billing_month, total_amount, total_expenses, paid_amount, status, due_date, sent_date, created_at, billing_settings, invoice_kind')
      .in('client_name', clientNames);
    // Don't silently degrade to an all-risk-free view — surface the failure like
    // every other query in this handler.
    if (invRiskErr) return NextResponse.json({ error: invRiskErr.message }, { status: 500 });

    const openInvoicesByClient: Record<string, BalanceInvoice[]> = {};
    for (const inv of (invRiskRows ?? []) as (InvoiceRiskRow & { invoice_kind: string | null })[]) {
      const name = inv.client_name;
      if (!name) continue;
      const status = (inv.status ?? '').toLowerCase();
      if (!BILLED_STATUS_SET.has(status)) continue;
      if (inv.billing_month === month && inv.invoice_kind !== 'off_cycle') billedThisMonth.add(name);
      const open = invoiceOpenBalance(inv);
      if (open <= 0) continue;
      // Overdue = still-open, past its due date, not yet marked paid.
      if (status !== 'paid' && inv.due_date && inv.due_date < today) {
        overdueByClient[name] = (overdueByClient[name] ?? 0) + open;
      }
      (openInvoicesByClient[name] ||= []).push({
        billingMonth: inv.billing_month ?? '',
        balance: open,
        sentDate: inv.sent_date ?? null,
        createdDate: inv.created_at ? inv.created_at.slice(0, 10) : null,
      });
    }
    for (const name of clientNames) {
      const r = riskByName.get(name);
      outstandingByClient[name] = runningBalance({
        receivables: r?.receivables ?? null,
        receivablesAsOf: r?.receivablesAsOf ?? null,
        invoices: openInvoicesByClient[name] ?? [],
      });
    }
  }

  // matter → client for every surfaced client (all matter statuses), so each
  // client's configs (retainer cap, fixed fee) resolve below even with no DTR.
  const matterToClient = new Map<string, string>();
  for (const mrow of (matterRows ?? []) as { notion_id: string; client_name: string | null }[]) {
    if (mrow.client_name && allClients.has(mrow.client_name)) {
      matterToClient.set(mrow.notion_id, mrow.client_name);
    }
  }

  // ── Compute total legal fees per client ──
  // One bundle fetch (covers all clients in the month), then one fee calc per client.
  const allEntries = clientNames.length > 0
    ? await getDTRBundleEntries(session.firmId, { billingMonth: month, clientNames })
    : [];

  // DTR-entry matters might not be in `matterRows` (defensive), and a DTR row's
  // client may differ from the matter's — attribute by the DTR's client.
  for (const e of allEntries) {
    const mid = e.effective?.matterId ?? e.raw?.matterId;
    if (mid && e.clientName) matterToClient.set(mid, e.clientName);
  }
  // Include with_names meeting attendees so their position rates resolve —
  // computeBundleFees fans out to each attendee; without their position they'd
  // fall back to the Junior Associate rate and under-count the bundle total.
  // The shared resolver also prices a renamed author off their stable person id.
  const lawyerRows = allEntries.flatMap((e) => [e.effective, e.raw].filter((s): s is NonNullable<typeof s> => !!s));

  // Matters belonging to any surfaced client — scope the fee-source fetches.
  const allMatterIds = [...matterToClient.keys()];

  const [ratesRes, configsRes, lawyers, actionsRes, actionEntriesRes, milestonesRes] = await Promise.all([
    supabase.from('billing_rates').select('position, hourly_rate'),
    // Small table — fetch all configs and scope per client below. Includes the
    // fee-bearing columns so deriveFeeLines can roll up acceptance / fixed-fee
    // charges (the same lines the bundle preview and the invoice include).
    supabase
      .from('matter_billing_configs')
      .select('matter_id, billing_type, retainer_hours_cap, hourly_rate_override, monthly_retainer, acceptance_fee, acceptance_fee_paid, fixed_fee_amount')
      .order('matter_id', { ascending: true }),
    resolveLawyerPositions(supabase, session.firmId, lawyerRows),
    allMatterIds.length > 0
      ? supabase.from('matter_billing_actions').select('id, matter_id, name, rate, cap, unit_label').in('matter_id', allMatterIds)
      : Promise.resolve({ data: [], error: null }),
    allMatterIds.length > 0
      ? supabase.from('matter_action_entries').select('id, action_id, matter_id, quantity, invoiced').in('matter_id', allMatterIds).gte('entry_date', start).lte('entry_date', end)
      : Promise.resolve({ data: [], error: null }),
    allMatterIds.length > 0
      ? supabase.from('matter_billing_milestones').select('id, matter_id, name, fee, reached_at, invoiced').in('matter_id', allMatterIds)
      : Promise.resolve({ data: [], error: null }),
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

  // Fee-source rows for deriveFeeLines (acceptance / fixed-fee / per-action /
  // milestone charges). These DON'T flow through computeBundleFees — that only
  // sees DTR hours — so a per-action / fixed-fee client would otherwise show
  // ₱0. Scoped per client below.
  const feeConfigs = (configsRes.data ?? []) as Array<{
    matter_id: string; billing_type: string;
    monthly_retainer: number | null; fixed_fee_amount: number | null;
    acceptance_fee: number | null; acceptance_fee_paid: boolean;
  }>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const actionsAll = (actionsRes.data ?? []) as any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const actionEntriesAll = (actionEntriesRes.data ?? []) as any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const milestonesAll = (milestonesRes.data ?? []) as any[];

  // Scope configs per-client (via matterToClient, built above) so
  // resolveBundleRetainerParams inside computeBundleFees only sees this client's
  // matters — otherwise "first retainer wins" could pull in another client's cap.
  // A fee already on an off-cycle bill isn't part of this month's bundle.
  const offCycleClaims = await oneTimeFeeClaimsByClient(getServiceDbForFirm(session.firmId), clientNames, { offCycleOnly: true });
  const feesByClient: Record<string, ReturnType<typeof computeBundleFees>> = {};
  const chargedByClient: Record<string, number> = {};
  for (const name of clientNames) {
    const snapshots = allEntries
      .filter((e) => e.clientName === name && e.effective)
      .map((e) => e.effective!);
    const clientConfigs = new Map<string, MatterBillingConfig>();
    const clientMatterIds = new Set<string>();
    for (const [mid, c] of configsByMatter) {
      if (matterToClient.get(mid) === name) {
        clientConfigs.set(mid, c);
        clientMatterIds.add(mid);
      }
    }
    feesByClient[name] = computeBundleFees({
      snapshots,
      configsByMatter: clientConfigs,
      ratesByPosition,
      positionByLawyerName,
    });
    // Charged non-DTR fee lines for this client (matterName/hours irrelevant to
    // the total — only amounts matter here). Retainer lines are excluded by
    // sumChargedFeeLines since computeBundleFees already counts the retainer.
    const derived = deriveFeeLines({
      configs: feeConfigs.filter((c) => clientMatterIds.has(c.matter_id)),
      actions: actionsAll.filter((a) => clientMatterIds.has(a.matter_id)),
      actionEntries: actionEntriesAll.filter((e) => clientMatterIds.has(e.matter_id)),
      milestones: milestonesAll.filter((m) => clientMatterIds.has(m.matter_id)),
      hoursByMatter: {},
      matterNameById: {},
    });
    const claims = offCycleClaims.get(name);
    chargedByClient[name] = sumChargedFeeLines(claims ? dropClaimedFeeLines(derived, claims) : derived);
  }

  // Relationship-partner display names. Read via service-role: `team` RLS is
  // scoped per-viewer, and finance needs to see which partner a bundle is
  // waiting on even for partners outside their own visibility.
  const rpIds = [...new Set([...relationshipPartnerByName.values()].filter((id): id is string => !!id))];
  const rpNameById = new Map<string, string>();
  if (rpIds.length > 0) {
    const { data: rpRows } = await getServiceDbForFirm(session.firmId).from('team').select('person_id, name').in('person_id', rpIds);
    for (const r of (rpRows ?? []) as { person_id: string; name: string | null }[]) {
      if (r.name) rpNameById.set(r.person_id, r.name);
    }
  }

  const clients = clientNames
    .map((name) => {
      const review = reviewsByClient[name];
      const fees = feesByClient[name];
      const rpId = relationshipPartnerByName.get(name) ?? null;
      // Ad-hoc items staged on this client's bundle (per-invoice override) are
      // part of the bill too, so the dashboard total matches the invoice.
      const adHocTotal = sumChargedFeeLines(parseAdHocFeeLines(review?.invoice_settings_override));
      return {
        clientName: name,
        rawCount: rawCounts[name] ?? 0,
        revisedCount: revsByClient[name]?.size ?? 0,
        reviewStatus: (review?.status ?? null) as 'pending' | 'approved' | 'rejected' | null,
        clearanceStatus: (review?.clearance_status ?? null) as 'cleared' | 'declined' | null,
        clearedAt: review?.cleared_at ?? null,
        relationshipPartnerId: rpId,
        relationshipPartnerName: rpId ? (rpNameById.get(rpId) ?? null) : null,
        submittedAt: review?.submitted_at ?? null,
        reviewedAt: review?.reviewed_at ?? null,
        // DTR/retainer fees + charged non-DTR fee lines + ad-hoc = full potential bill.
        totalLegalFees: (fees?.totalLegalFees ?? 0) + (chargedByClient[name] ?? 0) + adHocTotal,
        // Payment-risk signals for the "unlikely to pay" sort/filter.
        collectionRisk: riskByName.get(name)?.collectionRisk ?? false,
        overdueAmount: overdueByClient[name] ?? 0,
        outstandingBalance: outstandingByClient[name] ?? 0,
        billedThisMonth: billedThisMonth.has(name),
      };
    })
    .sort((a, b) => a.clientName.localeCompare(b.clientName));

  return NextResponse.json({ clients });
}
