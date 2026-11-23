import { NextRequest, NextResponse, after } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { canClearBundle, getRelationshipPartner } from '@/lib/auth/relationship-partner';
import { isManagingPartner } from '@/lib/auth/isManagingPartner';
import { generateBundleInvoice } from '@/lib/billing/generate-bundle-invoice';
import { createNotificationsBatch } from '@/lib/notifications';
import { logAudit, getClientIP } from '@/lib/audit';
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
 * POST /api/finance/dtr-review/clearance
 *
 * The client's relationship partner clears (or declines) a bundle the managing
 * partner has already approved. Clearance is the last gate before money leaves
 * the building: it's what triggers draft-invoice generation.
 *
 * Declining requires a note and returns the bundle to finance as "changes
 * requested", the same lane an MP rejection lands in.
 *
 * `decision: 'override'` is the managing partner's escape hatch for a bundle the
 * relationship partner is sitting on: it clears without their signature. It
 * demands a reason, notifies the partner it went around, and records itself as
 * an override on the review row + the audit log — the bill must never read as
 * though the relationship partner signed it.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as PostBody;
  const billingMonth = typeof body.billingMonth === 'string' ? body.billingMonth : '';
  const clientName = typeof body.clientName === 'string' ? body.clientName.trim() : '';
  const decision = typeof body.decision === 'string' ? body.decision : '';
  const notes = typeof body.notes === 'string' ? body.notes.trim() : '';

  if (!/^\d{4}-\d{2}$/.test(billingMonth)) {
    return NextResponse.json({ error: 'billingMonth must be YYYY-MM' }, { status: 400 });
  }
  if (!clientName) {
    return NextResponse.json({ error: 'clientName is required' }, { status: 400 });
  }
  if (decision !== 'clear' && decision !== 'decline' && decision !== 'override') {
    return NextResponse.json({ error: "decision must be 'clear', 'decline' or 'override'" }, { status: 400 });
  }
  if (decision === 'decline' && !notes) {
    return NextResponse.json({ error: 'A note explaining what needs to change is required' }, { status: 400 });
  }
  if (decision === 'override' && !notes) {
    return NextResponse.json(
      { error: 'A reason for overriding the relationship partner’s clearance is required' },
      { status: 400 },
    );
  }

  const relationshipPartner = await getRelationshipPartner(clientName, session.firmId);

  if (decision === 'override') {
    // Identity, not privilege: only the managing partner may bill over a
    // relationship partner's head. super_user doesn't stand in for that call.
    if (!(await isManagingPartner(session.user.notionUserId, session.firmId))) {
      return NextResponse.json(
        { error: 'Only the managing partner can override the clearance requirement.' },
        { status: 403 },
      );
    }
  } else if (!(await canClearBundle(session.user.notionUserId, clientName, session.firmId))) {
    return NextResponse.json(
      {
        error: !relationshipPartner
          ? `${clientName} has no relationship partner assigned. Assign one in Client Management before this bundle can be cleared.`
          : !relationshipPartner.active
            ? `${clientName}'s relationship partner (${relationshipPartner.name ?? 'unknown'}) is no longer active. Reassign the client in Client Management before this bundle can be cleared.`
            : `Only ${clientName}'s relationship partner can clear this bundle.`,
      },
      { status: 403 },
    );
  }

  const supabase = await getSupabaseServerAuthClient();

  // Clearance only applies to a bundle the managing partner has approved —
  // it's the second signature, not an alternative to the first.
  const { data: existing, error: existErr } = await supabase
    .from('dtr_revision_reviews')
    .select('id, status, clearance_status')
    .eq('billing_month', billingMonth)
    .eq('client_name', clientName)
    .maybeSingle();
  if (existErr) return NextResponse.json({ error: existErr.message }, { status: 500 });
  if (!existing) {
    return NextResponse.json({ error: 'No submitted bundle found for this client/month' }, { status: 404 });
  }
  if (existing.status !== 'approved') {
    return NextResponse.json(
      { error: 'The managing partner must approve this bundle before it can be cleared.' },
      { status: 409 },
    );
  }

  // The `.eq('status', 'approved')` below is not redundant with the check above:
  // finance can reset this bundle to pending (via a DTR/expense edit) between
  // the read and the write. Without it, clearance would land on a pending bundle
  // and the background job would generate an invoice for something no longer
  // approved. Matching no row means exactly that happened — 409 and let the
  // partner re-read.
  const clears = decision === 'clear' || decision === 'override';
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from('dtr_revision_reviews')
    .update({
      clearance_status: clears ? 'cleared' : 'declined',
      clearance_notes: notes,
      cleared_by: session.user.notionUserId,
      cleared_at: nowIso,
      // Who signed matters more than that someone did: an override names the
      // managing partner and their reason, and is nulled on any ordinary
      // clearance so the marker can't linger from an earlier round.
      clearance_override_by: decision === 'override' ? session.user.notionUserId : null,
      clearance_override_at: decision === 'override' ? nowIso : null,
      clearance_override_reason: decision === 'override' ? notes : null,
      // A decline sends the bundle back to finance in the same lane as an MP
      // rejection, so it shows up in their "changes requested" queue.
      ...(decision === 'decline' ? { status: 'rejected' } : {}),
      ...(clears
        ? {
            invoice_gen_status: 'pending',
            invoice_gen_error: null,
            invoice_gen_invoice_id: null,
            invoice_gen_invoice_number: null,
            invoice_gen_at: null,
          }
        : {}),
    })
    .eq('billing_month', billingMonth)
    .eq('client_name', clientName)
    .eq('status', 'approved')
    .select('id, status, clearance_status, cleared_at')
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) {
    return NextResponse.json(
      { error: 'This bundle changed while you were reviewing it — finance edited it and it needs the managing partner’s approval again. Reload to see the current state.' },
      { status: 409 },
    );
  }

  // Tell finance either way — they're the ones who act next (send the invoice,
  // or rework the bundle). On an override, the relationship partner who was
  // bypassed is told too: the point of the escape hatch is to unblock billing,
  // not to bill behind their back.
  after(async () => {
    const service = getServiceDbForFirm(session.firmId);
    const { data: financeTeam } = await service
      .from('team')
      .select('person_id')
      .eq('active', true)
      .in('role', ['finance', 'admin']);
    const recipients = (financeTeam ?? []).map((t: { person_id: string }) => t.person_id);

    const clearedLabel = decision === 'decline' ? 'declined' : 'cleared';
    const by = decision === 'override' ? 'the managing partner' : 'the relationship partner';
    const notices = recipients.map((person_id) => ({
      person_id,
      type: 'billing_clearance' as const,
      title: `${clientName} — bundle ${clearedLabel} by ${by}`,
      body:
        decision === 'override'
          ? `${billingMonth} bundle cleared without relationship-partner clearance: ${notes}`
          : decision === 'clear'
            ? `${billingMonth} bundle cleared. The draft invoice is being generated.`
            : `${billingMonth} bundle declined: ${notes}`,
      href: '/finance/dtr-review',
    }));

    if (decision === 'override' && relationshipPartner?.active) {
      notices.push({
        person_id: relationshipPartner.id,
        type: 'billing_clearance' as const,
        title: `${clientName} — the managing partner cleared this bundle for you`,
        body: `The ${billingMonth} bundle was cleared without your sign-off: ${notes}`,
        href: '/dashboard/partner/billing-review',
      });
    }

    if (notices.length === 0) return;
    await createNotificationsBatch(notices, session.firmId);
  });

  if (decision === 'override') {
    logAudit({
      firmId: session.firmId,
      entityType: 'BillingBundle',
      entityId: String(data.id),
      entityName: `${clientName} — ${billingMonth}`,
      action: 'clearance_overridden',
      fieldChanged: 'clearance_status',
      oldValue: 'awaiting relationship-partner clearance',
      newValue: `cleared by managing partner override: ${notes}`,
      performedBy: session.user.notionUserId,
      ipAddress: getClientIP(req),
    });
  }

  // ── Generate the draft invoice, now that both signatures are in ──────
  // Rendering + storage uploads take a while, so this runs in an `after()`
  // task; the outcome is written back onto the review row and the UI polls the
  // decision GET for it. A failure does NOT undo the clearance — finance can
  // regenerate from Review & Generate or the Invoices list.
  //
  // Service-role, deliberately: the whole billing surface (matter_expenses,
  // matter_billing_configs, billing_rates, reimbursements, invoices) is scoped
  // to finance/admin under RLS, so on a partner's JWT the bundle reads empty and
  // the invoice INSERT is refused — generation silently produced nothing for the
  // very people this route exists for. Clearance IS the authorization decision;
  // it was made above, against policy-backed rows. Dual-client per CLAUDE.md.
  if (clears) {
    const generatedByEmail = session.user.email ?? (decision === 'override' ? 'mp-override-gen' : 'rp-auto-gen');
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
        console.error('[clearance] Background invoice gen failed:', err);
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
    clearedAt: data.cleared_at,
    overridden: decision === 'override',
    invoiceGen: clears ? { pending: true } : null,
  });
}
