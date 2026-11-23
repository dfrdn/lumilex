import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { getRelationshipPartner } from '@/lib/auth/relationship-partner';

interface PostBody {
  billingMonth?: unknown;
  clientName?: unknown;
  notes?: unknown;
  invoiceSettingsOverride?: unknown;
}

/**
 * POST /api/finance/dtr-review/submit
 * Marks a (billingMonth, clientName) bundle as ready for managing-partner review.
 * Idempotent: re-submitting an already-pending bundle just bumps submitted_at.
 * Re-submitting a rejected bundle returns it to pending so the partner re-reviews.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const role = session.user.role;
  if (role !== 'finance' && role !== 'super_user') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as PostBody;
  const billingMonth = typeof body.billingMonth === 'string' ? body.billingMonth : '';
  const clientName = typeof body.clientName === 'string' ? body.clientName : '';
  const notes = typeof body.notes === 'string' ? body.notes : '';
  const invoiceSettingsOverride =
    body.invoiceSettingsOverride && typeof body.invoiceSettingsOverride === 'object'
      ? (body.invoiceSettingsOverride as Record<string, unknown>)
      : null;

  if (!/^\d{4}-\d{2}$/.test(billingMonth)) {
    return NextResponse.json({ error: 'billingMonth must be YYYY-MM' }, { status: 400 });
  }
  if (!clientName) {
    return NextResponse.json({ error: 'clientName is required' }, { status: 400 });
  }

  // A bundle needs an active relationship partner to clear it before an invoice
  // can be generated, so block at the earliest point rather than letting it
  // stall in the partner queue. No super_user bypass: the approve step enforces
  // the same rule with no escape, so bypassing here would only let a bundle in
  // that could never advance.
  const relationshipPartner = await getRelationshipPartner(clientName, session.firmId);
  if (!relationshipPartner?.active) {
    return NextResponse.json(
      {
        error: relationshipPartner
          ? `${clientName}'s relationship partner (${relationshipPartner.name ?? 'unknown'}) is no longer active. Reassign the client in Client Management before submitting this bundle for review.`
          : `${clientName} has no relationship partner assigned. Assign one in Client Management before submitting this bundle for review.`,
      },
      { status: 409 },
    );
  }

  const supabase = await getSupabaseServerAuthClient();

  const { data, error } = await supabase
    .from('dtr_revision_reviews')
    .upsert(
      {
        firm_id: session.firmId,
        billing_month: billingMonth,
        client_name: clientName,
        status: 'pending',
        notes,
        submitted_by: session.user.notionUserId,
        submitted_at: new Date().toISOString(),
        reviewed_by: null,
        reviewed_at: null,
        ...(invoiceSettingsOverride !== null
          ? { invoice_settings_override: invoiceSettingsOverride }
          : {}),
      },
      { onConflict: 'firm_id,billing_month,client_name' },
    )
    .select('id, status, submitted_at')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ id: data.id, status: data.status, submittedAt: data.submitted_at });
}
