import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { TRADEMARK_SELECT, rowToTrademark } from '@/lib/trademark-row';
import { validateBody, internationalRegistrationCreateSchema } from '@/lib/validation';
import { logAudit, getClientIP } from '@/lib/audit';
import { manilaToday } from '@/lib/dates';
import { basicMarkProblem, designationCountries, insertDesignations, loadRegistrations } from '@/lib/trademarks/international';

/** GET /api/trademark/[id]/international-registrations — the mark's IRs with their designated countries. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  const supabase = await getSupabaseServerAuthClient();
  return NextResponse.json({ registrations: await loadRegistrations(supabase, id) });
}

/**
 * POST /api/trademark/[id]/international-registrations — extends a
 * Philippine mark abroad: the international application through IPOPHL and
 * one mark per country it designates.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const validation = await validateBody(req, internationalRegistrationCreateSchema);
  if (!validation.success) return validation.response;
  const body = validation.data;
  const { id } = await params;

  const supabase = await getSupabaseServerAuthClient();
  const { data: row } = await supabase.from('trademarks').select(TRADEMARK_SELECT).eq('id', id).maybeSingle();
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const base = rowToTrademark(row);

  const problem = basicMarkProblem(base);
  if (problem) return NextResponse.json({ error: problem }, { status: 409 });
  const today = manilaToday();
  for (const [label, d] of [['filing with IPOPHL', body.applicationFiledDate], ['international registration', body.irDate]] as const) {
    if (d && d > today) return NextResponse.json({ error: `The date of the ${label} is in the future.` }, { status: 400 });
    if (d && d < base.filingDate!) return NextResponse.json({ error: `The date of the ${label} is before the Philippine filing.` }, { status: 400 });
  }
  // WIPO dates the IR no earlier than IPOPHL's receipt of the international application.
  if (body.irDate && body.applicationFiledDate && body.irDate < body.applicationFiledDate) {
    return NextResponse.json({ error: 'The international registration is dated before the application was filed with IPOPHL.' }, { status: 400 });
  }
  const countries = designationCountries(body.countries);
  if ('error' in countries) return NextResponse.json({ error: countries.error }, { status: 400 });

  const { data: ir, error } = await supabase
    .from('international_registrations')
    .insert({
      firm_id: session.firmId,
      base_trademark_id: id,
      ir_no: body.irNo || null,
      ir_date: body.irDate ?? null,
      application_filed_date: body.applicationFiledDate ?? null,
      created_by: session.user.notionUserId,
    })
    .select('id, ir_no, ir_date')
    .single();
  if (error || !ir) return NextResponse.json({ error: error?.message ?? 'Could not record the international registration' }, { status: 500 });

  const added = await insertDesignations(supabase, session.firmId, base, { id: ir.id, irNo: ir.ir_no, irDate: ir.ir_date }, {
    codes: countries.codes,
    designationDate: null,
    refusalPeriodMonths: body.refusalPeriodMonths,
    createdBy: session.user.notionUserId,
  });
  if ('error' in added) {
    // No country went in, so the IR would rest on the mark with nothing designated.
    await supabase.from('international_registrations').delete().eq('id', ir.id);
    return NextResponse.json({ error: added.error }, { status: 500 });
  }

  logAudit({
    firmId: session.firmId,
    entityType: 'Trademark',
    entityId: id,
    entityName: base.mark || undefined,
    action: 'updated',
    fieldChanged: 'international_registration',
    newValue: JSON.stringify({ irId: ir.id, countries: countries.codes }),
    performedBy: session.user.notionUserId,
    ipAddress: getClientIP(req),
  });

  return NextResponse.json({ ok: true, registrations: await loadRegistrations(supabase, id) });
}
