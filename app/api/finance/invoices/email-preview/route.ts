import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { renderBillingEmail } from '@/lib/billing/email-blocks';
import { loadEmailWording } from '@/lib/billing/wording-store';
import { loadEmailBrand } from '@/lib/email';

/**
 * GET /api/finance/invoices/email-preview?invoiceId=<id>
 * The billing email exactly as Send will deliver it for this invoice — same
 * renderer, same wording — so Batch Send can show it before it goes.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.notionUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!['admin', 'super_user', 'finance'].includes(session.user.role ?? '')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const invoiceId = Number(req.nextUrl.searchParams.get('invoiceId'));
  if (!Number.isFinite(invoiceId)) return NextResponse.json({ error: 'invoiceId is required' }, { status: 400 });

  const supabase = await getSupabaseServerAuthClient();
  const [{ data: inv }, wording, brand] = await Promise.all([
    supabase
      .from('invoices')
      .select('invoice_number, client_name, billing_month, total_amount, total_expenses, billing_settings')
      .eq('id', invoiceId)
      .maybeSingle(),
    loadEmailWording(supabase),
    loadEmailBrand(session.firmId),
  ]);
  if (!inv) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const email = renderBillingEmail(inv, { paragraphs: wording.paragraphs, subject: wording.subject, brand });
  return NextResponse.json(email);
}
