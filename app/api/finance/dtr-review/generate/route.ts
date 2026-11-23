import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { generateBundleInvoice } from '@/lib/billing/generate-bundle-invoice';
import { checkBundleCleared } from '@/lib/finance/bundle-gate';

export const maxDuration = 60;

/**
 * POST /api/finance/dtr-review/generate  { clientName, billingMonth }
 *
 * Finance-triggered Generate / Regenerate for a bundle, from the Review page.
 * Same two-signature gate as the rest of generation — MP approval plus
 * relationship-partner clearance (super_user bypasses). If an invoice already
 * exists for the client+month it is regenerated in place (number reused,
 * revision bumped); otherwise a fresh draft is created. Runs the shared
 * `generateBundleInvoice` pipeline so the result matches clearance auto-gen.
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

  const body = await req.json().catch(() => ({}));
  const { clientName, billingMonth } = body as { clientName?: string; billingMonth?: string };
  if (!clientName || !billingMonth) {
    return NextResponse.json({ error: 'clientName and billingMonth are required' }, { status: 400 });
  }
  if (!/^\d{4}-\d{2}$/.test(billingMonth)) {
    return NextResponse.json({ error: 'billingMonth must be in YYYY-MM format' }, { status: 400 });
  }

  const supabase = await getSupabaseServerAuthClient();

  // ── Approval + clearance gate (super_user bypasses for emergency back-fills).
  const gateFailure = await checkBundleCleared(supabase, billingMonth, clientName, role);
  if (gateFailure) {
    return NextResponse.json({ error: gateFailure.error }, { status: gateFailure.status });
  }

  // Per-bundle settings override (applied on top of the matter config).
  const { data: reviewRow } = await supabase
    .from('dtr_revision_reviews')
    .select('invoice_settings_override')
    .eq('billing_month', billingMonth)
    .eq('client_name', clientName)
    .maybeSingle();
  const override = (reviewRow?.invoice_settings_override ?? null) as Record<string, unknown> | null;

  // generateBundleInvoice detects an existing invoice for this client+month and
  // regenerates it in place (reuse number, bump revision), so we don't dedup here.
  const result = await generateBundleInvoice({
    supabase,
    firmId: session.firmId,
    billingMonth,
    clientName,
    generatedByEmail: session.user.email,
    override,
  });

  // Persist the outcome on the review row (mirrors the MP-approval path) so the
  // bundle's Generate/Regenerate button label and poll state stay accurate.
  await supabase
    .from('dtr_revision_reviews')
    .update({
      invoice_gen_status: result.ok ? (result.skipped ? 'skipped' : 'success') : 'failed',
      invoice_gen_error: result.ok ? null : (result.error ?? 'Invoice generation failed'),
      invoice_gen_invoice_id: result.invoiceId ?? null,
      invoice_gen_invoice_number: result.invoiceNumber ?? null,
      invoice_gen_at: new Date().toISOString(),
    })
    .eq('billing_month', billingMonth)
    .eq('client_name', clientName);

  return NextResponse.json({ invoiceGen: result });
}
