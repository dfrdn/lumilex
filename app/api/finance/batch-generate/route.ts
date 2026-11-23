import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { generateBundleInvoice } from '@/lib/billing/generate-bundle-invoice';
import { bundleSkipReason, sentInvoiceSkipReason } from '@/lib/finance/bundle-gate';

export const maxDuration = 120;

interface ClientRequest {
  clientName: string;
}

/**
 * POST /api/finance/batch-generate
 *
 * Generate invoices for multiple clients in parallel via the shared
 * `generateBundleInvoice` pipeline — the SAME path the per-bundle Generate
 * button and the MP-approval auto-gen use. That means each client gets its saved
 * per-bundle override applied AND regenerates in place if an invoice already
 * exists (reuse number, bump revision) instead of inserting a duplicate.
 * A client whose invoice for the month has already gone out is skipped, for
 * every role — see `sentInvoiceSkipReason`.
 *
 * Failures on one client don't block others; the response splits results
 * into `generated`, `skipped`, and `failed`.
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

  const { clients, month } = await req.json();
  if (!Array.isArray(clients) || clients.length === 0 || !month) {
    return NextResponse.json({ error: 'clients array and month are required' }, { status: 400 });
  }
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: 'month must be in YYYY-MM format' }, { status: 400 });
  }

  const supabase = await getSupabaseServerAuthClient();
  const generatedByEmail = session.user.email;

  // The invoice generateBundleInvoice would regenerate is the newest one for
  // the client and month, so that is the status that decides — ascending order
  // lets the newest overwrite older ones in the map.
  const clientNames = (clients as ClientRequest[]).map((c) => c.clientName);
  const { data: existingRows, error: existingErr } = await supabase
    .from('invoices')
    .select('id, client_name, status')
    .eq('billing_month', month)
    .in('client_name', clientNames)
    .order('id', { ascending: true });
  if (existingErr) {
    console.error('[batch-generate]', existingErr.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
  const invoiceStatus = new Map((existingRows ?? []).map((r) => [r.client_name as string, r.status as string | null]));

  const results = await Promise.allSettled(
    (clients as ClientRequest[]).map(async ({ clientName }) => {
      const sentReason = sentInvoiceSkipReason(invoiceStatus.get(clientName));
      if (sentReason) return { clientName, skipped: true, reason: sentReason };

      // Review state + saved per-bundle override in one read.
      const { data: review } = await supabase
        .from('dtr_revision_reviews')
        .select('status, clearance_status, invoice_settings_override')
        .eq('billing_month', month)
        .eq('client_name', clientName)
        .maybeSingle();

      // ── Gate: MP approval + relationship-partner clearance (super_user bypasses) ──
      if (role !== 'super_user') {
        const reason = bundleSkipReason(review);
        if (reason) return { clientName, skipped: true, reason };
      }

      const override = (review?.invoice_settings_override ?? null) as Record<string, unknown> | null;

      const result = await generateBundleInvoice({
        supabase,
        firmId: session.firmId,
        billingMonth: month,
        clientName,
        generatedByEmail,
        override,
      });

      // Persist the outcome on the review row so the dashboard's badges/state
      // stay accurate (mirrors the per-bundle generate + MP-approval paths).
      await supabase
        .from('dtr_revision_reviews')
        .update({
          invoice_gen_status: result.ok ? (result.skipped ? 'skipped' : 'success') : 'failed',
          invoice_gen_error: result.ok ? null : (result.error ?? 'Invoice generation failed'),
          invoice_gen_invoice_id: result.invoiceId ?? null,
          invoice_gen_invoice_number: result.invoiceNumber ?? null,
          invoice_gen_at: new Date().toISOString(),
        })
        .eq('billing_month', month)
        .eq('client_name', clientName);

      if (!result.ok) throw new Error(result.error ?? 'Invoice generation failed');
      if (result.skipped) return { clientName, skipped: true, reason: 'No billable entries' };
      return { clientName, invoiceId: result.invoiceId, invoiceNumber: result.invoiceNumber };
    })
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fulfilled: any[] = [];
  const failed: { clientName: string; error: string }[] = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      fulfilled.push(r.value);
    } else {
      failed.push({
        clientName: (clients as ClientRequest[])[i]?.clientName ?? 'Unknown',
        error: r.reason?.message ?? 'Unknown error',
      });
    }
  });

  return NextResponse.json({
    generated: fulfilled.filter((g) => !g.skipped),
    skipped: fulfilled.filter((g) => g.skipped),
    failed,
    total: clients.length,
  });
}
