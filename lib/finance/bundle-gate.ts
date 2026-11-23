import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * The two-signature gate on invoice generation: the managing partner approves
 * the bundle, then the client's relationship partner clears it. Every
 * generation path (per-bundle Generate, batch-generate, regenerate, and the
 * auto-gen fired on clearance) runs through here so they can't drift.
 *
 * super_user bypasses for emergency back-fills, matching the previous
 * approval-only gate.
 */
export interface BundleGateFailure {
  error: string;
  status: number;
}

export async function checkBundleCleared(
  supabase: SupabaseClient,
  billingMonth: string,
  clientName: string,
  role: string | null | undefined,
): Promise<BundleGateFailure | null> {
  if (role === 'super_user') return null;

  const { data: review, error } = await supabase
    .from('dtr_revision_reviews')
    .select('status, clearance_status')
    .eq('billing_month', billingMonth)
    .eq('client_name', clientName)
    .maybeSingle();

  if (error) return { error: error.message, status: 500 };
  if (!review) {
    return {
      error:
        "This bundle hasn't been submitted for review. Submit it, then wait for the managing partner to approve and the relationship partner to clear it.",
      status: 409,
    };
  }
  if (review.status !== 'approved') {
    const stateLabel = review.status === 'pending' ? 'still pending review' : 'has changes requested';
    return {
      error: `This bundle is ${stateLabel}. The managing partner must approve it before invoices can be generated.`,
      status: 409,
    };
  }
  if (review.clearance_status !== 'cleared') {
    return {
      error:
        'This bundle is approved but not yet cleared by the relationship partner. Invoices are generated once clearance is given.',
      status: 409,
    };
  }
  return null;
}

/** Short reason string for batch paths that skip rather than fail. */
export function bundleSkipReason(
  review: { status: string; clearance_status: string | null } | null,
): string | null {
  if (!review) return 'Bundle not submitted for review';
  if (review.status !== 'approved') {
    return `Bundle is ${review.status === 'pending' ? 'pending review' : 'changes requested'}`;
  }
  if (review.clearance_status !== 'cleared') return 'Awaiting relationship-partner clearance';
  return null;
}

/**
 * Batch generation only creates or refreshes drafts. Regenerating an invoice
 * that has gone out turns it back into a draft and unbills its entries, so a
 * sent, part-paid or paid invoice is re-issued one at a time from the invoice
 * list (Regenerate), never as a side effect of a month-wide run.
 */
export function sentInvoiceSkipReason(status: string | null | undefined): string | null {
  const s = (status ?? '').toLowerCase();
  if (!s || s === 'draft') return null;
  return `Invoice already ${s === 'sent' ? 'sent' : s === 'partial' ? 'part-paid' : s === 'paid' ? 'paid' : s}`;
}
