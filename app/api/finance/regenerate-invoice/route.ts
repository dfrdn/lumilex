import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { fetchBillingData } from '@/lib/billing/fetch-billing-data';
import { unresolvedBundleLawyers } from '@/lib/billing/bundle-lawyers';
import { UnresolvedLawyerError } from '@/lib/billing/lawyer-positions';
import { persistInvoice, resolveInvoiceClientId, type FeeLinePayload, type InvoiceSettingsSnapshot } from '@/lib/billing/persist-invoice';
import { regenerateOffCycleInvoice } from '@/lib/billing/off-cycle';
import { GraphNotConfiguredError } from '@/lib/microsoft-graph';
import { formatBalanceLabel } from '@/lib/billing/letter-format';
import { findSignerAtty, getFirmInvoiceSettings } from '@/lib/billing/firm-defaults';
import { checkBundleCleared } from '@/lib/finance/bundle-gate';
import { parseAdHocFeeLines } from '@/lib/billing/derive-fee-lines';

export const maxDuration = 60;

/**
 * POST /api/finance/regenerate-invoice?id=X
 *
 * Re-runs invoice generation for an existing invoice using the latest DTRs and
 * expenses. The flags on the OLD line_items / expense_items are reversed first
 * so the fresh billing-data fetch picks them up alongside any new entries.
 * Status drops back to "draft" so finance must re-confirm before re-sending.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.notionUserId || !session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const role = session.user.role;
  if (role !== 'finance' && role !== 'super_user') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const idParam = req.nextUrl.searchParams.get('id');
  const invoiceId = idParam ? parseInt(idParam) : NaN;
  if (!Number.isFinite(invoiceId)) {
    return NextResponse.json({ error: 'id query param required' }, { status: 400 });
  }

  const supabase = await getSupabaseServerAuthClient();

  const { data: invoice, error: fetchErr } = await supabase
    .from('invoices')
    .select('id, invoice_number, client_name, matter_id, matter_name, billing_month, line_items, expense_items, fee_lines, billing_settings, sent_date, previously_sent_at, revision_count, invoice_kind')
    .eq('id', invoiceId)
    .maybeSingle();

  if (fetchErr) {
    console.error('[regenerate-invoice]', fetchErr.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
  if (!invoice) {
    return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
  }

  // ── An off-cycle invoice was approved on its own request and re-renders only
  // the fees approved there: the monthly bundle's gate doesn't apply, and the
  // month's time and expenses belong to the monthly invoice.
  if (invoice.invoice_kind === 'off_cycle') {
    try {
      const result = await regenerateOffCycleInvoice(supabase, session.firmId, {
        ...invoice,
        fee_lines: invoice.fee_lines as FeeLinePayload[] | null,
      }, session.user.email);
      return NextResponse.json(result);
    } catch (err) {
      console.error('[regenerate-invoice] Off-cycle error:', err);
      return NextResponse.json(
        { error: err instanceof Error ? err.message : 'Failed to regenerate invoice' },
        { status: err instanceof GraphNotConfiguredError ? 503 : 500 },
      );
    }
  }

  // ── Same two-signature gate as fresh generation. Super_user bypass.
  const gateFailure = await checkBundleCleared(supabase, invoice.billing_month, invoice.client_name, role);
  if (gateFailure) {
    return NextResponse.json({ error: gateFailure.error }, { status: gateFailure.status });
  }

  // ── A name on billable time that matches no team member can't be priced.
  // Refuse before any flag below is reversed, so the invoice stays as it was.
  const unresolved = await unresolvedBundleLawyers(session.firmId, invoice.client_name, invoice.billing_month);
  if (unresolved.length > 0) {
    return NextResponse.json({ error: new UnresolvedLawyerError(unresolved).message }, { status: 409 });
  }
  try {
    await resolveInvoiceClientId(supabase, invoice.client_name);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Client could not be resolved' }, { status: 409 });
  }

  // ── Reverse OLD flags now so the fresh billing-data fetch sees the previously
  // billed DTRs and expenses. persistInvoice will idempotently reverse them
  // again before re-applying the new set, which is a harmless no-op here.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const oldDtrIds = (invoice.line_items ?? []).flatMap((l: any) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (l.entries ?? []).map((e: any) => e.rawDtrId ?? e.id),
  ).filter(Boolean);
  if (oldDtrIds.length > 0) {
    await supabase.from('dtr').update({ billed: false }).in('notion_id', oldDtrIds);
  }
  const oldReimbIds = (invoice.expense_items ?? [])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((e: any) => e.source === 'reimbursement' || !e.source)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((e: any) => e.id)
    .filter((id: string) => id && !String(id).startsWith('mexp-'));
  if (oldReimbIds.length > 0) {
    await supabase.from('reimbursements').update({ billed: false, invoice_id: null }).in('notion_id', oldReimbIds);
  }
  const oldMexpIds = (invoice.expense_items ?? [])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((e: any) => e.source === 'finance' || (e.id && String(e.id).startsWith('mexp-')))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((e: any) => parseInt(String(e.id).replace('mexp-', '')))
    .filter((id: number) => !isNaN(id));
  if (oldMexpIds.length > 0) {
    await supabase.from('matter_expenses')
      .update({ billed: false, invoice_id: null })
      .in('id', oldMexpIds);
  }

  // ── Fetch fresh billing data (now includes previously-billed entries).
  const billingData = await fetchBillingData(supabase, session.firmId, invoice.client_name, invoice.billing_month);

  // The bundle's Additional Items live on its review row. Fresh generation
  // appends them (generateBundleInvoice), so regenerating must too, or they
  // silently drop off the reissued invoice.
  const { data: reviewRow } = await supabase
    .from('dtr_revision_reviews')
    .select('invoice_settings_override')
    .eq('billing_month', invoice.billing_month)
    .eq('client_name', invoice.client_name)
    .maybeSingle();
  const adHocFeeLines = parseAdHocFeeLines(
    (reviewRow?.invoice_settings_override ?? null) as Record<string, unknown> | null,
  );

  if (
    billingData.lineItems.length === 0 &&
    billingData.expenses.length === 0 &&
    billingData.feeLines.length === 0 &&
    adHocFeeLines.length === 0
  ) {
    return NextResponse.json(
      { error: 'No billable entries found for this client/month. Nothing to regenerate.' },
      { status: 409 },
    );
  }

  // ── Settings priority for regenerate:
  //   1. Matter billing config — source of truth for matter-stable defaults
  //      (signer, bank, attn, address, retainer cap, etc.)
  //   2. Invoice's billing_settings snapshot — fallback for per-client letter
  //      fields the matter doesn't have (attn, salutation, client address…).
  //   3. Live data — clients.receivables overrides any frozen previousBalance.
  //
  // FIRM-WIDE letterhead (address, TIN, bank, signer) is the exception: it
  // resolves matter-override → LIVE firm setting, NOT the frozen snapshot —
  // otherwise an edit in Firm Invoice Details would never reach existing
  // invoices on regenerate (the snapshot would keep printing the old letterhead).
  // This matches generate-bundle-invoice, so both regenerate paths agree.
  const cfg = billingData.billingConfig;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const matterSaved = (cfg?.billing_settings ?? {}) as Record<string, any>;
  const snapshot = (invoice.billing_settings ?? {}) as InvoiceSettingsSnapshot;
  const [firm, signerAtty] = await Promise.all([getFirmInvoiceSettings(session.firmId), findSignerAtty(session.firmId)]);
  // The letter and its recipient come from the client's billing profile as it
  // is now; what the profile leaves unset keeps the invoice's own value.
  const profile = billingData.clientProfile;

  const settings: InvoiceSettingsSnapshot = {
    clientAddress: profile.clientAddress ?? snapshot.clientAddress,
    attnName: profile.attnName ?? snapshot.attnName,
    attnTitle: profile.attnTitle ?? snapshot.attnTitle,
    throughName: profile.throughName ?? snapshot.throughName,
    salutation: profile.salutation ?? snapshot.salutation,
    letterAddressee: profile.letterAddressee ?? snapshot.letterAddressee,
    clientEmail: profile.clientEmail ?? snapshot.clientEmail,
    ccEmails: profile.ccEmails ?? snapshot.ccEmails,
    includeVAT: profile.includeVAT ?? snapshot.includeVAT,
    includeLessenFeesNote: profile.includeLessenFeesNote ?? snapshot.includeLessenFeesNote,
    initialStatement: profile.initialStatement ?? snapshot.initialStatement,
    optionalParagraphs: profile.optionalParagraphs ?? snapshot.optionalParagraphs,
    earlyPaymentDiscountPercent: profile.earlyPaymentDiscountPercent ?? snapshot.earlyPaymentDiscountPercent,
    earlyPaymentDays: profile.earlyPaymentDays ?? snapshot.earlyPaymentDays,
    bankName: matterSaved.bankName || firm.bankName,
    bankAccountNo: matterSaved.bankAccountNo || firm.bankAccountNo,
    bankAccountName: matterSaved.bankAccountName || firm.bankAccountName,
    signerName: firm.signerName,
    signerAtty,
    firmAddress: matterSaved.firmAddress || firm.firmAddress,
    firmAddress2: matterSaved.firmAddress2 || firm.firmAddress2,
    firmTIN: matterSaved.firmTIN || firm.firmTIN,
    // ON by default (matter value wins, then the frozen snapshot, then true) —
    // matches resolveBundleSettings so both regenerate paths agree.
    settleFromDeposit: (matterSaved.settleFromDeposit ?? snapshot.settleFromDeposit) == null
      ? true
      : (matterSaved.settleFromDeposit ?? snapshot.settleFromDeposit) === 'true'
        || (matterSaved.settleFromDeposit ?? snapshot.settleFromDeposit) === true,
    // Matter cfg columns are the canonical source
    engagementDate: cfg?.engagement_date ?? matterSaved.engagementDate ?? snapshot.engagementDate,
    retainerCap: cfg?.monthly_retainer != null ? Number(cfg.monthly_retainer) : snapshot.retainerCap,
    retainerHoursCap: cfg?.retainer_hours_cap != null ? Number(cfg.retainer_hours_cap) : snapshot.retainerHoursCap,
    monthlyRetainer: cfg?.monthly_retainer != null ? Number(cfg.monthly_retainer) : snapshot.monthlyRetainer,
    acceptanceFees: snapshot.acceptanceFees,
    // Live data — re-derive from the CURRENT running balance. Do NOT fall back to
    // the frozen snapshot: if the client has since paid down to zero,
    // clientReceivables is null and the regenerated invoice must show no previous
    // balance, not resurrect the old figure.
    previousBalance: billingData.clientReceivables ?? undefined,
    previousBalanceLabel: billingData.clientReceivables != null
      ? formatBalanceLabel(billingData.clientReceivablesUpdatedAt, billingData.clientReceivables)
      : undefined,
    depositOnHand: billingData.clientDepositOnHand > 0 ? billingData.clientDepositOnHand : undefined,
    hourlyDiscountPercent: matterSaved.hourlyDiscountPercent ?? snapshot.hourlyDiscountPercent,
    totalDiscountPercent: matterSaved.totalDiscountPercent ?? snapshot.totalDiscountPercent,
  };

  try {
    const result = await persistInvoice(supabase, {
      firmId: session.firmId,
      clientName: invoice.client_name,
      month: invoice.billing_month,
      matterId: invoice.matter_id,
      matterName: invoice.matter_name,
      lineItems: billingData.lineItems,
      expenses: billingData.expenses,
      feeLines: [...billingData.feeLines, ...adHocFeeLines],
      settings,
      generatedByEmail: session.user.email,
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
    return NextResponse.json(result);
  } catch (err) {
    console.error('[regenerate-invoice] Error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to regenerate invoice' },
      { status: err instanceof GraphNotConfiguredError ? 503 : 500 },
    );
  }
}
