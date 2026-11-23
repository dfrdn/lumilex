import { NextRequest, NextResponse, after } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { isManagingPartner } from '@/lib/auth/isManagingPartner';
import { getRelationshipPartner } from '@/lib/auth/relationship-partner';
import { createNotificationsBatch } from '@/lib/notifications';
import { generateBundleInvoice } from '@/lib/billing/generate-bundle-invoice';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';

// Invoice generation (DOCX/XLSX/PDF rendering + storage uploads) runs in an
// `after()` background task, which counts toward the function's max duration.
export const maxDuration = 60;

interface PostBody {
  billingMonth?: unknown;
  clientName?: unknown;
  decision?: unknown;
  notes?: unknown;
}

/**
 * POST /api/finance/dtr-review/decision
 * The managing partner approves or rejects a finance-submitted bundle.
 * Rejecting requires a note. Once approved, finance can still re-edit which
 * resets the bundle to pending (handled in /revision route).
 *
 * Approval is the FIRST of two signatures — it no longer generates the invoice.
 * The client's relationship partner clears the approved bundle via /clearance,
 * and that's what triggers generation. The exception is when the approver IS
 * that relationship partner: one action carries both signatures, so the bundle
 * clears and the invoice generates here.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!(await isManagingPartner(session.user.notionUserId, session.firmId))) {
    return NextResponse.json({ error: 'Only the managing partner can approve or reject bundles' }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as PostBody;
  const billingMonth = typeof body.billingMonth === 'string' ? body.billingMonth : '';
  const clientName = typeof body.clientName === 'string' ? body.clientName : '';
  const decision = typeof body.decision === 'string' ? body.decision : '';
  const notes = typeof body.notes === 'string' ? body.notes.trim() : '';

  if (!/^\d{4}-\d{2}$/.test(billingMonth)) {
    return NextResponse.json({ error: 'billingMonth must be YYYY-MM' }, { status: 400 });
  }
  if (!clientName) {
    return NextResponse.json({ error: 'clientName is required' }, { status: 400 });
  }
  if (decision !== 'approve' && decision !== 'reject') {
    return NextResponse.json({ error: "decision must be 'approve' or 'reject'" }, { status: 400 });
  }
  if (decision === 'reject' && !notes) {
    return NextResponse.json({ error: 'A note explaining the rejection is required' }, { status: 400 });
  }

  // ── Hard block: no ACTIVE relationship partner, no billing ──
  // Approving would strand the bundle — nobody, not even a super_user, is
  // authorised to clear it, and clearance is what generates the invoice. An
  // inactive partner is as blocking as no partner: they can't sign in to clear.
  const relationshipPartner = await getRelationshipPartner(clientName, session.firmId);
  if (decision === 'approve' && !relationshipPartner?.active) {
    return NextResponse.json(
      {
        error: relationshipPartner
          ? `${clientName}'s relationship partner (${relationshipPartner.name ?? 'unknown'}) is no longer active, so nobody can clear this bundle. Reassign the client in Client Management, then approve.`
          : `${clientName} has no relationship partner assigned, so nobody can clear this bundle. Assign one in Client Management, then approve.`,
      },
      { status: 409 },
    );
  }
  const relationshipPartnerId = relationshipPartner?.id ?? null;

  const supabase = await getSupabaseServerAuthClient();

  // Verify a pending review row exists — partner can't approve a bundle that wasn't submitted.
  const { data: existing, error: existErr } = await supabase
    .from('dtr_revision_reviews')
    .select('id, status')
    .eq('billing_month', billingMonth)
    .eq('client_name', clientName)
    .maybeSingle();
  if (existErr) return NextResponse.json({ error: existErr.message }, { status: 500 });
  if (!existing) {
    return NextResponse.json({ error: 'No submitted bundle found for this client/month' }, { status: 404 });
  }

  // When the approver IS the client's relationship partner, one action carries
  // both signatures — there's no second person to wait for, so the bundle is
  // cleared and the invoice generates immediately.
  const selfClears = decision === 'approve' && relationshipPartnerId === session.user.notionUserId;
  const nowIso = new Date().toISOString();

  // Otherwise approving hands the bundle on: reset any prior clearance so a
  // re-approval after edits can't inherit a stale sign-off.
  const { data, error } = await supabase
    .from('dtr_revision_reviews')
    .update({
      status: decision === 'approve' ? 'approved' : 'rejected',
      notes,
      reviewed_by: session.user.notionUserId,
      reviewed_at: nowIso,
      ...(selfClears
        ? {
            clearance_status: 'cleared',
            clearance_notes: notes,
            cleared_by: session.user.notionUserId,
            cleared_at: nowIso,
            clearance_override_by: null,
            clearance_override_at: null,
            clearance_override_reason: null,
            invoice_gen_status: 'pending',
            invoice_gen_error: null,
            invoice_gen_invoice_id: null,
            invoice_gen_invoice_number: null,
            invoice_gen_at: null,
          }
        : {
            clearance_status: null,
            clearance_notes: '',
            cleared_by: null,
            cleared_at: null,
            // A fresh round needs a fresh signature — including the record of
            // any earlier managing-partner override.
            clearance_override_by: null,
            clearance_override_at: null,
            clearance_override_reason: null,
          }),
    })
    .eq('billing_month', billingMonth)
    .eq('client_name', clientName)
    .select('id, status, clearance_status, reviewed_at')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Approval hands the bundle to a different relationship partner — tell them
  // it's waiting. Nothing else happens until they clear it.
  if (decision === 'approve' && relationshipPartnerId && !selfClears) {
    after(() =>
      createNotificationsBatch(
        [
          {
            person_id: relationshipPartnerId,
            type: 'billing_clearance',
            title: `${clientName} — billing bundle awaiting your clearance`,
            body: `The managing partner approved the ${billingMonth} bundle. The invoice is generated once you clear it.`,
            href: '/dashboard/partner/billing-review',
          },
        ],
        session.firmId,
      ),
    );
  }

  // ── Both signatures in: generate the draft invoice in the background ──
  // Same pipeline the /clearance route runs, service-role for the same reason:
  // the approver here is a partner, and the billing tables are finance-scoped
  // under RLS. The two signatures were checked above; this is the work that
  // follows them.
  if (selfClears) {
    const generatedByEmail = session.user.email ?? 'mp-auto-gen';
    after(async () => {
      const service = getServiceDbForFirm(session.firmId);
      try {
        const { data: reviewRow } = await service
          .from('dtr_revision_reviews')
          .select('invoice_settings_override')
          .eq('billing_month', billingMonth)
          .eq('client_name', clientName)
          .maybeSingle();
        const override = (reviewRow?.invoice_settings_override ?? null) as Record<string, unknown> | null;

        const result = await generateBundleInvoice({
          supabase: service,
          firmId: session.firmId,
          billingMonth,
          clientName,
          generatedByEmail,
          override,
        });

        await service
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
      } catch (err) {
        console.error('[decision] Background invoice gen failed:', err);
        await service
          .from('dtr_revision_reviews')
          .update({
            invoice_gen_status: 'failed',
            invoice_gen_error: err instanceof Error ? err.message : 'Invoice generation failed',
            invoice_gen_at: new Date().toISOString(),
          })
          .eq('billing_month', billingMonth)
          .eq('client_name', clientName);
      }
    });
  }

  return NextResponse.json({
    id: data.id,
    status: data.status,
    clearanceStatus: data.clearance_status,
    reviewedAt: data.reviewed_at,
    selfCleared: selfClears,
    awaitingClearance: decision === 'approve' && !selfClears,
    invoiceGen: selfClears ? { pending: true } : null,
  });
}

/**
 * GET /api/finance/dtr-review/decision?month=YYYY-MM&client=NAME
 * Poll the outcome of the background invoice generation kicked off on approval.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const role = session.user.role;
  const isMP = await isManagingPartner(session.user.notionUserId, session.firmId);
  if (role !== 'finance' && role !== 'super_user' && role !== 'partner' && !isMP) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const billingMonth = req.nextUrl.searchParams.get('month') ?? '';
  const clientName = req.nextUrl.searchParams.get('client') ?? '';
  if (!/^\d{4}-\d{2}$/.test(billingMonth)) {
    return NextResponse.json({ error: 'month must be YYYY-MM' }, { status: 400 });
  }
  if (!clientName) {
    return NextResponse.json({ error: 'client is required' }, { status: 400 });
  }

  const supabase = await getSupabaseServerAuthClient();
  const { data, error } = await supabase
    .from('dtr_revision_reviews')
    .select('invoice_gen_status, invoice_gen_error, invoice_gen_invoice_id, invoice_gen_invoice_number')
    .eq('billing_month', billingMonth)
    .eq('client_name', clientName)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const status = data?.invoice_gen_status ?? null;
  const invoiceGen =
    status === 'pending'
      ? { pending: true }
      : status === 'success'
        ? { ok: true, invoiceId: data?.invoice_gen_invoice_id ?? undefined, invoiceNumber: data?.invoice_gen_invoice_number ?? undefined }
        : status === 'skipped'
          ? { ok: true, skipped: true }
          : status === 'failed'
            ? { ok: false, error: data?.invoice_gen_error ?? 'Invoice generation failed' }
            : null;

  return NextResponse.json({ invoiceGen });
}
