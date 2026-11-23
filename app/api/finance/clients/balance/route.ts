import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { manilaToday } from '@/lib/finance/format';

/**
 * PATCH /api/finance/clients/balance
 * Set a client's outstanding balance (override) with audit trail.
 * Body: { clientName, balance, note?, asOf? }
 *   asOf (YYYY-MM-DD) = the date the balance is accurate as of. Billing only
 *   carries it into invoices whose period ends on/after this date. Defaults to
 *   today when a balance is set; cleared to null when the balance is cleared.
 */
export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const role = session.user.role;
  if (role !== 'finance' && role !== 'super_user') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json();
  const { clientName, balance, note, asOf } = body;

  if (!clientName || typeof clientName !== 'string') {
    return NextResponse.json({ error: 'clientName is required' }, { status: 400 });
  }

  const parsed = balance === null || balance === '' || balance === undefined ? null : Number(balance);
  if (parsed !== null && !Number.isFinite(parsed)) {
    return NextResponse.json({ error: 'balance must be a number or null' }, { status: 400 });
  }
  // Note: negative balance = client paid an advance deposit (firm owes them).

  // As-of date: explicit YYYY-MM-DD, else default to today (Manila) when a
  // balance is set. Always null when the balance is cleared.
  const dateRe = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
  let asOfDate: string | null = null;
  if (parsed !== null) {
    if (asOf === null || asOf === undefined || asOf === '') {
      asOfDate = manilaToday();
    } else if (typeof asOf === 'string' && dateRe.test(asOf)) {
      asOfDate = asOf;
    } else {
      return NextResponse.json({ error: 'asOf must be YYYY-MM-DD' }, { status: 400 });
    }
  }

  const supabase = await getSupabaseServerAuthClient();
  const updatedBy = session.user.name ?? session.user.email ?? 'unknown';
  const updatedAt = new Date().toISOString();

  const { error } = await supabase
    .from('clients')
    .update({
      receivables: parsed,
      receivables_note: note ?? null,
      receivables_as_of: asOfDate,
      receivables_updated_at: updatedAt,
      receivables_updated_by: updatedBy,
    })
    .eq('name', clientName);

  if (error) {
    console.error('[finance-clients-balance]', error.message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    receivables: parsed,
    receivables_note: note ?? null,
    receivables_as_of: asOfDate,
    receivables_updated_at: updatedAt,
    receivables_updated_by: updatedBy,
  });
}
