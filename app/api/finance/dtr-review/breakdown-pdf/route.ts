import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { isManagingPartner } from '@/lib/auth/isManagingPartner';
import { fetchBillingData } from '@/lib/billing/fetch-billing-data';
import { resolveBundleSettings } from '@/lib/billing/generate-bundle-invoice';
import { buildBreakdownParams } from '@/lib/billing/build-breakdown-params';
import { generateBillingBreakdownPdf } from '@/lib/pdf/billing-breakdown';
import { loadFirmBrand } from '@/lib/pdf/firm-brand';
import type { FeeLinePayload } from '@/lib/billing/persist-invoice';

/**
 * POST /api/finance/dtr-review/breakdown-pdf
 * Body: { billingMonth: 'YYYY-MM', clientName: string }
 *
 * Renders the billing breakdown PDF for a bundle ON DEMAND — including bundles
 * still in review (not yet approved). Unapproved bundles are stamped with a
 * "DRAFT" watermark so a preview can never be mistaken for the final invoice.
 * Uses the same billing data + settings the approval will persist, so the draft
 * matches the eventual invoice.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const role = session.user.role;
  const isMP = await isManagingPartner(session.user.notionUserId, session.firmId);
  if (role !== 'finance' && role !== 'super_user' && role !== 'partner' && !isMP) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as { billingMonth?: string; clientName?: string } | null;
  const billingMonth = body?.billingMonth;
  const clientName = body?.clientName;
  if (!billingMonth || !clientName) {
    return NextResponse.json({ error: 'billingMonth and clientName are required' }, { status: 400 });
  }
  if (!/^\d{4}-\d{2}$/.test(billingMonth)) {
    return NextResponse.json({ error: 'billingMonth must be YYYY-MM' }, { status: 400 });
  }

  const supabase = getServiceDbForFirm(session.firmId);

  // A generated invoice already has a stored (final, un-watermarked) breakdown.
  // If this bundle's invoice exists, the draft preview is still allowed but marked
  // draft until BOTH signatures are in — MP approval plus relationship-partner
  // clearance. Cleared → no watermark.
  const { data: review } = await supabase
    .from('dtr_revision_reviews')
    .select('status, clearance_status, invoice_settings_override')
    .eq('billing_month', billingMonth)
    .eq('client_name', clientName)
    .maybeSingle();

  const isApproved = review?.status === 'approved' && review?.clearance_status === 'cleared';
  const override = (review?.invoice_settings_override ?? null) as Record<string, unknown> | null;

  const data = await fetchBillingData(supabase, session.firmId, clientName, billingMonth);
  const { settings, adHocFeeLines } = await resolveBundleSettings({ firmId: session.firmId, data, clientName, override });

  if (data.lineItems.length === 0 && data.expenses.length === 0 && data.feeLines.length === 0 && adHocFeeLines.length === 0) {
    return NextResponse.json({ error: 'Nothing to bill for this client/month yet.' }, { status: 409 });
  }

  const params = buildBreakdownParams({
    clientName,
    month: billingMonth,
    lineItems: data.lineItems,
    expenses: data.expenses,
    feeLines: [...(data.feeLines as FeeLinePayload[]), ...adHocFeeLines],
    settings,
  });

  const brand = await loadFirmBrand(session.firmId);
  const pdf = await generateBillingBreakdownPdf(brand, { ...params, draft: !isApproved });

  const safe = `${clientName}`.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 60);
  const filename = `${safe} - ${billingMonth}${isApproved ? '' : ' - DRAFT'} - Breakdown.pdf`;

  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
