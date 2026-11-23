import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';

/**
 * POST /api/finance/dtr-review/override
 *
 * Save a per-invoice settings override on the bundle review row. The fields
 * are a partial InvoiceSettingsSnapshot — most commonly:
 *   - hourlyDiscountPercent
 *   - totalDiscountPercent
 *   - clientEmail / ccEmails
 *   - attnName
 *   - earlyPaymentDiscountPercent / earlyPaymentDays
 *   - letterInitialStatement / letterDeferredAcceptanceFee / letterPaymentArrangement
 *
 * When the managing partner approves and the bundle auto-generates an
 * invoice, this object is merged on top of the matter's billing_settings
 * so the override wins.
 *
 * Body: { billingMonth, clientName, override }
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const role = session.user.role;
  if (role !== 'finance' && role !== 'super_user' && role !== 'partner') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const { billingMonth, clientName, override } = body ?? {};
  if (typeof billingMonth !== 'string' || !/^\d{4}-\d{2}$/.test(billingMonth)) {
    return NextResponse.json({ error: 'billingMonth must be YYYY-MM' }, { status: 400 });
  }
  if (typeof clientName !== 'string' || !clientName) {
    return NextResponse.json({ error: 'clientName is required' }, { status: 400 });
  }
  if (override && typeof override !== 'object') {
    return NextResponse.json({ error: 'override must be an object' }, { status: 400 });
  }

  const supabase = await getSupabaseServerAuthClient();

  // Upsert the review row so finance can save an override even before
  // submitting the bundle for partner review.
  const { data: existing } = await supabase
    .from('dtr_revision_reviews')
    .select('id, status, invoice_settings_override')
    .eq('billing_month', billingMonth)
    .eq('client_name', clientName)
    .maybeSingle();

  // Two writers share this jsonb blob: the "Additional Items" card owns
  // `adHocItems`, the settings panel owns the scalar fields. Preserve the saved
  // ad-hoc items whenever the caller doesn't mention them, so the settings
  // panel's save can never wipe items the card just wrote (and vice versa). The
  // card always sends an explicit `adHocItems` (possibly []) to set/clear them.
  const incoming = override && typeof override === 'object' ? { ...(override as Record<string, unknown>) } : null;
  let finalOverride: Record<string, unknown> | null = incoming;
  const existingAdHoc = (existing?.invoice_settings_override as Record<string, unknown> | null)?.adHocItems;
  if ((finalOverride === null || !('adHocItems' in finalOverride)) && Array.isArray(existingAdHoc) && existingAdHoc.length > 0) {
    finalOverride = { ...(finalOverride ?? {}), adHocItems: existingAdHoc };
  }
  if (finalOverride && Object.keys(finalOverride).length === 0) finalOverride = null;

  if (existing) {
    const { error } = await supabase
      .from('dtr_revision_reviews')
      .update({ invoice_settings_override: finalOverride })
      .eq('id', existing.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  // No review row yet — create a stub one with submitted_at=NULL so the
  // override sticks. Partner-side queues filter on submitted_at IS NOT NULL
  // so this stub does NOT appear in the "pending review" list until finance
  // formally submits.
  const { error } = await supabase
    .from('dtr_revision_reviews')
    .insert({
      firm_id: session.firmId,
      billing_month: billingMonth,
      client_name: clientName,
      status: 'pending',
      submitted_at: null,
      submitted_by: session.user.notionUserId,
      invoice_settings_override: finalOverride,
    });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
