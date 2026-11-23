/**
 * Off-cycle invoices: a fee-only bill issued between monthly runs — an
 * acceptance fee, a reached milestone, or ad-hoc items —
 * with no time or expenses on it. Finance files a request, the managing partner
 * approves it, and the approval generates a draft that is sent like any other
 * invoice. It sits beside the client's monthly invoice for the month it is
 * generated in and draws its number from that month's sequence.
 *
 * The one hazard is double billing. A sent invoice flips the fee's flag
 * (acceptance_fee_paid, milestone.invoiced) and
 * deriveFeeLines honours it, but a fee on a request still awaiting approval, or
 * on a draft not yet sent, has no flag yet. `oneTimeFeeClaims` reads those and
 * `dropClaimedFeeLines` keeps the other bill from offering the fee again.
 *
 * Every read and write is the firm's own: the callers pass a client scoped to
 * one firm (the caller's JWT, or getServiceDbForFirm), and generation runs on
 * the firm-scoped service client of the firm the request belongs to.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { deriveFeeLines } from '@/lib/billing/derive-fee-lines';
import { persistInvoice, type FeeLinePayload, type InvoiceSettingsSnapshot } from '@/lib/billing/persist-invoice';
import { letterSettingsFromConfig } from '@/lib/billing/generate-bundle-invoice';
import { loadClientProfile } from '@/lib/billing/client-profile';
import { defaultPeriodLabel } from '@/lib/billing/off-cycle-label';
import { manilaMonth } from '@/lib/dates';

export { defaultPeriodLabel };

/** Fees billed once per engagement, which an off-cycle invoice can carry. */
export type OneTimeFeeKind = 'acceptance' | 'milestone';

export interface OneTimeFeeClaims {
  acceptance: Set<string>;
  milestones: Set<number>;
}

/** A one-time fee still owed by the client and not on any pending bill. */
export interface OutstandingFee {
  kind: OneTimeFeeKind;
  matterId: string;
  matterName: string | null;
  description: string;
  amount: number;
  /** The milestone row, for kind 'milestone'. */
  milestoneId?: number;
}

export interface ClientMatter {
  id: string;
  name: string;
}

/** What finance picks in the request form; amounts for the one-time kinds are
 *  read from the matter's config server-side, never taken from the form. */
export type OffCycleItem =
  | { kind: 'acceptance'; matterId: string }
  | { kind: 'milestone'; milestoneId: number }
  | { kind: 'adhoc'; description: string; amount: number; matterId?: string | null };

export interface OffCycleRequestRow {
  id: number;
  client_name: string;
  billing_month: string;
  period_label: string;
  fee_lines: FeeLinePayload[];
}

type FeeLineLike = { kind: string; matterId?: string | null; sourceIds?: number[] };

function emptyClaims(): OneTimeFeeClaims {
  return { acceptance: new Set(), milestones: new Set() };
}

function addClaims(claims: OneTimeFeeClaims, lines: FeeLineLike[] | null | undefined): void {
  for (const f of lines ?? []) {
    if (!f) continue;
    if (f.kind === 'acceptance' && f.matterId) claims.acceptance.add(f.matterId);
    else if (f.kind === 'milestone') {
      for (const id of f.sourceIds ?? []) if (typeof id === 'number') claims.milestones.add(id);
    }
  }
}

/**
 * One-time fees each client's unsent bills already hold: draft invoices, plus
 * off-cycle requests awaiting approval or whose generation hasn't produced an
 * invoice yet. `offCycleOnly` limits the draft invoices to off-cycle ones —
 * what the monthly run must leave alone, since its own draft is the invoice
 * being regenerated.
 */
export async function oneTimeFeeClaimsByClient(
  supabase: SupabaseClient,
  clientNames: string[],
  opts: { offCycleOnly?: boolean; excludeRequestId?: number } = {},
): Promise<Map<string, OneTimeFeeClaims>> {
  const byClient = new Map<string, OneTimeFeeClaims>();
  const names = [...new Set(clientNames)];
  for (const n of names) byClient.set(n, emptyClaims());

  for (let i = 0; i < names.length; i += 100) {
    const batch = names.slice(i, i + 100);
    let invoiceQuery = supabase
      .from('invoices')
      .select('client_name, fee_lines')
      .in('client_name', batch)
      .eq('status', 'draft');
    if (opts.offCycleOnly) invoiceQuery = invoiceQuery.eq('invoice_kind', 'off_cycle');

    const [{ data: drafts, error: draftErr }, { data: requests, error: reqErr }] = await Promise.all([
      invoiceQuery,
      supabase
        .from('off_cycle_invoice_requests')
        .select('id, client_name, fee_lines, status, invoice_gen_status')
        .in('client_name', batch)
        .in('status', ['pending', 'approved']),
    ]);
    // Failing open here is the double bill this module exists to prevent.
    if (draftErr) throw new Error(`Failed to read draft invoices: ${draftErr.message}`);
    if (reqErr) throw new Error(`Failed to read off-cycle requests: ${reqErr.message}`);

    for (const d of drafts ?? []) {
      const claims = byClient.get(d.client_name as string);
      if (claims) addClaims(claims, d.fee_lines as FeeLineLike[]);
    }
    for (const r of requests ?? []) {
      if (r.id === opts.excludeRequestId) continue;
      // An approved request hands its claim to the invoice it generated; until
      // then (generating, or failed and awaiting a retry) it holds the claim.
      const open = r.status === 'pending' || r.invoice_gen_status === 'pending' || r.invoice_gen_status === 'failed';
      const claims = byClient.get(r.client_name as string);
      if (open && claims) addClaims(claims, r.fee_lines as FeeLineLike[]);
    }
  }
  return byClient;
}

export async function oneTimeFeeClaims(
  supabase: SupabaseClient,
  clientName: string,
  opts: { offCycleOnly?: boolean; excludeRequestId?: number } = {},
): Promise<OneTimeFeeClaims> {
  const byClient = await oneTimeFeeClaimsByClient(supabase, [clientName], opts);
  return byClient.get(clientName) ?? emptyClaims();
}

/** Remove the one-time fees another unsent bill already holds. */
export function dropClaimedFeeLines<T extends FeeLineLike>(lines: T[], claims: OneTimeFeeClaims): T[] {
  return lines.filter((f) => {
    if (f.kind === 'acceptance') return !(f.matterId && claims.acceptance.has(f.matterId));
    if (f.kind === 'milestone') return !(f.sourceIds ?? []).some((id) => claims.milestones.has(id));
    return true;
  });
}

/**
 * The client's matters and every one-time fee still outstanding on them — the
 * choices the request form offers, and the check generation re-runs.
 */
export async function listOutstandingFees(
  supabase: SupabaseClient,
  clientName: string,
  opts: { excludeRequestId?: number } = {},
): Promise<{ matters: ClientMatter[]; fees: OutstandingFee[] }> {
  const { data: matterRows, error: matterErr } = await supabase
    .from('matters')
    .select('notion_id, name')
    .eq('client_name', clientName)
    .order('name', { ascending: true });
  if (matterErr) throw new Error(`Failed to read matters: ${matterErr.message}`);
  const matterIds = (matterRows ?? []).map((m) => m.notion_id as string);
  if (matterIds.length === 0) return { matters: [], fees: [] };

  const [{ data: configs, error: cfgErr }, { data: milestones, error: msErr }, claims] = await Promise.all([
    supabase
      .from('matter_billing_configs')
      .select('matter_id, billing_type, monthly_retainer, fixed_fee_amount, acceptance_fee, acceptance_fee_paid, billing_settings')
      .in('matter_id', matterIds),
    supabase
      .from('matter_billing_milestones')
      .select('id, matter_id, name, fee, reached_at, invoiced')
      .in('matter_id', matterIds)
      .order('order_index', { ascending: true }),
    oneTimeFeeClaims(supabase, clientName, { excludeRequestId: opts.excludeRequestId }),
  ]);
  if (cfgErr) throw new Error(`Failed to read billing configs: ${cfgErr.message}`);
  if (msErr) throw new Error(`Failed to read milestones: ${msErr.message}`);

  const matterNameById: Record<string, string> = {};
  for (const m of matterRows ?? []) matterNameById[m.notion_id as string] = m.name as string;

  const derived = deriveFeeLines({
    configs: configs ?? [],
    actions: [],
    actionEntries: [],
    milestones: milestones ?? [],
    hoursByMatter: {},
    matterNameById,
  });

  const fees: OutstandingFee[] = dropClaimedFeeLines(derived, claims)
    .filter((f): f is typeof f & { kind: OneTimeFeeKind; matterId: string } =>
      (f.kind === 'acceptance' || f.kind === 'milestone') && !!f.matterId)
    .map((f) => ({
      kind: f.kind,
      matterId: f.matterId,
      matterName: f.matterName,
      description: f.description,
      amount: Math.round(Number(f.amount) * 100) / 100,
      milestoneId: f.kind === 'milestone' ? f.sourceIds?.[0] : undefined,
    }));

  const matters: ClientMatter[] = (matterRows ?? []).map((m) => ({
    id: m.notion_id as string,
    name: m.name as string,
  }));

  return { matters, fees };
}

function sameFee(item: OffCycleItem, fee: OutstandingFee): boolean {
  if (item.kind === 'milestone') return fee.kind === 'milestone' && fee.milestoneId === item.milestoneId;
  if (item.kind === 'adhoc') return false;
  return fee.kind === item.kind && fee.matterId === item.matterId;
}

/**
 * Turn the form's picks into the fee lines the managing partner approves.
 * One-time fees are priced from the matter's config; an item that isn't
 * outstanding any more is refused rather than billed twice.
 */
export function resolveOffCycleLines(
  items: OffCycleItem[],
  outstanding: { matters: ClientMatter[]; fees: OutstandingFee[] },
): { ok: true; feeLines: FeeLinePayload[] } | { ok: false; error: string } {
  const matterById = new Map(outstanding.matters.map((m) => [m.id, m]));
  const feeLines: FeeLinePayload[] = [];

  for (const item of items) {
    if (item.kind === 'adhoc') {
      const matter = item.matterId ? matterById.get(item.matterId) : undefined;
      if (item.matterId && !matter) return { ok: false, error: 'An additional item names a matter that is not this client’s.' };
      feeLines.push({
        kind: 'adhoc',
        matterId: matter?.id ?? null,
        matterName: matter?.name ?? null,
        description: item.description.trim(),
        amount: Math.round(item.amount * 100) / 100,
      });
      continue;
    }
    const fee = outstanding.fees.find((f) => sameFee(item, f));
    if (!fee) {
      return { ok: false, error: 'One of the selected fees is no longer outstanding — it is already on another invoice or request.' };
    }
    feeLines.push({
      kind: fee.kind,
      matterId: fee.matterId,
      matterName: fee.matterName,
      description: fee.description,
      amount: fee.amount,
      ...(fee.milestoneId != null ? { sourceIds: [fee.milestoneId] } : {}),
    });
  }

  if (feeLines.length === 0) return { ok: false, error: 'Pick at least one fee to bill.' };
  return { ok: true, feeLines };
}

async function offCycleSettings(
  supabase: SupabaseClient,
  firmId: string,
  clientName: string,
  feeLines: FeeLinePayload[],
  periodLabel: string,
): Promise<InvoiceSettingsSnapshot> {
  // Address, bank and signer come from the billed matter's config — or, for a
  // bill of matterless items, the client's first configured matter.
  const matterId = feeLines.find((f) => f.matterId)?.matterId ?? null;
  let cfg: Record<string, unknown> | null = null;
  if (matterId) {
    const { data } = await supabase.from('matter_billing_configs').select('*').eq('matter_id', matterId).maybeSingle();
    cfg = data;
  }
  if (!cfg) {
    const { data: matters } = await supabase.from('matters').select('notion_id').eq('client_name', clientName);
    const ids = (matters ?? []).map((m) => m.notion_id as string);
    if (ids.length > 0) {
      const { data } = await supabase
        .from('matter_billing_configs')
        .select('*')
        .in('matter_id', ids)
        .order('matter_id', { ascending: true })
        .limit(1);
      cfg = data?.[0] ?? null;
    }
  }
  const { profile } = await loadClientProfile(supabase, clientName);
  return {
    ...(await letterSettingsFromConfig(firmId, cfg, clientName, profile)),
    billingPeriodLabel: periodLabel,
    // A standalone bill for named fees: it carries no running balance (the
    // monthly letter does that) and draws on no deposit, so the client pays
    // exactly what the managing partner approved.
    settleFromDeposit: false,
  };
}

function singleMatter(feeLines: FeeLinePayload[]): { matterId: string | null; matterName: string | null } {
  const ids = new Set(feeLines.map((f) => f.matterId));
  if (ids.size !== 1) return { matterId: null, matterName: null };
  const first = feeLines[0];
  return { matterId: first.matterId, matterName: first.matterName };
}

/**
 * Generate the draft for an approved request. The fees are re-checked first:
 * one billed elsewhere since the request was filed fails the generation rather
 * than going out twice.
 */
export async function generateOffCycleInvoice(
  supabase: SupabaseClient,
  firmId: string,
  request: OffCycleRequestRow,
  generatedByEmail: string,
): Promise<{ invoiceId: number; invoiceNumber: string }> {
  const lines = request.fee_lines ?? [];
  const oneTime = lines.filter((l) => l.kind !== 'adhoc');
  if (oneTime.length > 0) {
    const outstanding = await listOutstandingFees(supabase, request.client_name, { excludeRequestId: request.id });
    const claims = emptyClaims();
    addClaims(claims, outstanding.fees.map((f) => ({
      kind: f.kind,
      matterId: f.matterId,
      sourceIds: f.milestoneId != null ? [f.milestoneId] : undefined,
    })));
    const stale = oneTime.filter((l) => dropClaimedFeeLines([l], claims).length === 1);
    if (stale.length > 0) {
      throw new Error(`${stale.map((l) => `${l.description}${l.matterName ? ` (${l.matterName})` : ''}`).join(', ')} is no longer outstanding — it was billed elsewhere after this request was filed.`);
    }
  }

  const settings = await offCycleSettings(supabase, firmId, request.client_name, lines, request.period_label);
  const result = await persistInvoice(supabase, {
    firmId,
    clientName: request.client_name,
    month: request.billing_month,
    ...singleMatter(lines),
    lineItems: [],
    expenses: [],
    feeLines: lines.map((l) => ({ ...l })),
    settings,
    generatedByEmail,
    invoiceKind: 'off_cycle',
  });
  return { invoiceId: result.invoice.id, invoiceNumber: result.invoice.invoice_number };
}

/**
 * Re-render an off-cycle invoice in place: the same approved fees, with the
 * letter details read fresh from the matter config. Never runs the monthly
 * pipeline, which would pull the month's time and expenses onto it.
 */
export async function regenerateOffCycleInvoice(
  supabase: SupabaseClient,
  firmId: string,
  invoice: {
    id: number;
    invoice_number: string;
    client_name: string;
    billing_month: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    line_items: any[] | null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expense_items: any[] | null;
    fee_lines: FeeLinePayload[] | null;
    billing_settings: Record<string, unknown> | null;
    sent_date: string | null;
    previously_sent_at: string | null;
    revision_count: number | null;
  },
  generatedByEmail: string,
) {
  const lines = (invoice.fee_lines ?? []).filter((l) => l.kind !== 'discount');
  const snapshot = invoice.billing_settings ?? {};
  const settings = await offCycleSettings(
    supabase,
    firmId,
    invoice.client_name,
    lines,
    typeof snapshot.billingPeriodLabel === 'string' ? snapshot.billingPeriodLabel : defaultPeriodLabel(lines),
  );
  return persistInvoice(supabase, {
    firmId,
    clientName: invoice.client_name,
    month: invoice.billing_month,
    ...singleMatter(lines),
    lineItems: [],
    expenses: [],
    feeLines: lines.map((l) => ({ ...l })),
    settings,
    generatedByEmail,
    existingInvoice: {
      id: invoice.id,
      invoice_number: invoice.invoice_number,
      line_items: invoice.line_items ?? [],
      expense_items: invoice.expense_items ?? [],
      fee_lines: invoice.fee_lines ?? [],
      sent_date: invoice.sent_date ?? null,
      previously_sent_at: invoice.previously_sent_at ?? null,
      revision_count: invoice.revision_count ?? 0,
    },
  });
}

/**
 * Generation runs in an `after()` task capped by the route's 60-second
 * `maxDuration`. One still `pending` well past that was cut off before it could
 * record an outcome; it reads as failed and can be retried.
 */
export const GENERATION_STALE_MS = 3 * 60 * 1000;

export function generationStalled(
  r: { status: string; invoice_gen_status: string | null; updated_at: string },
  now: number = Date.now(),
): boolean {
  return r.status === 'approved' && r.invoice_gen_status === 'pending' && now - new Date(r.updated_at).getTime() > GENERATION_STALE_MS;
}

/**
 * Generate an approved request's draft and record the outcome on the request.
 * Service-role, scoped to the request's firm: the approver is the managing
 * partner, and the billing tables are finance-scoped under RLS — the approval
 * was checked before this runs.
 */
export async function runOffCycleGeneration(firmId: string, requestId: number, generatedByEmail: string): Promise<void> {
  const service = getServiceDbForFirm(firmId);
  const finish = (patch: Record<string, unknown>) =>
    service
      .from('off_cycle_invoice_requests')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', requestId);
  try {
    const { data: request, error } = await service
      .from('off_cycle_invoice_requests')
      .select('id, client_name, billing_month, period_label, fee_lines, status')
      .eq('id', requestId)
      .single();
    if (error) throw new Error(error.message);
    if (request.status !== 'approved') throw new Error('Request is not approved');
    // The bill belongs to the month it is issued in, not the month it was
    // asked for: a request filed on the 31st and approved on the 3rd is
    // numbered and dated in the new month.
    const billingMonth = manilaMonth();
    const { invoiceId } = await generateOffCycleInvoice(
      service,
      firmId,
      { ...(request as OffCycleRequestRow), billing_month: billingMonth },
      generatedByEmail,
    );
    await finish({ invoice_gen_status: 'success', invoice_gen_error: null, invoice_id: invoiceId, billing_month: billingMonth });
  } catch (err) {
    console.error('[off-cycle] generation failed:', err);
    await finish({
      invoice_gen_status: 'failed',
      invoice_gen_error: err instanceof Error ? err.message : 'Invoice generation failed',
    });
  }
}
