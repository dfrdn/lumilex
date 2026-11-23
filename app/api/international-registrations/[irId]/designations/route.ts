import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { TRADEMARK_SELECT, rowToTrademark } from '@/lib/trademark-row';
import { validateBody, designationsAddSchema } from '@/lib/validation';
import { logAudit, getClientIP } from '@/lib/audit';
import { manilaToday } from '@/lib/dates';
import { designationCountries, insertDesignations, loadRegistrations } from '@/lib/trademarks/international';

/**
 * POST /api/international-registrations/[irId]/designations — designates
 * more countries after the international registration (a subsequent
 * designation). Each one's refusal period counts from its own date.
 */
export async function POST(req: Request, { params }: { params: Promise<{ irId: string }> }) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const validation = await validateBody(req, designationsAddSchema);
  if (!validation.success) return validation.response;
  const body = validation.data;
  const { irId } = await params;

  const supabase = await getSupabaseServerAuthClient();
  const { data: ir } = await supabase
    .from('international_registrations').select('id, base_trademark_id, ir_no, ir_date, ceased_date').eq('id', irId).maybeSingle();
  if (!ir) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (ir.ceased_date) return NextResponse.json({ error: 'The international registration has ceased; it can’t designate more countries.' }, { status: 409 });
  if (!ir.ir_date) return NextResponse.json({ error: 'Record the international registration date first.' }, { status: 409 });
  if (body.designationDate > manilaToday()) return NextResponse.json({ error: 'The designation date is in the future.' }, { status: 400 });
  if (body.designationDate < ir.ir_date) return NextResponse.json({ error: 'The designation date is before the international registration.' }, { status: 400 });

  const [{ data: baseRow }, { data: existing }] = await Promise.all([
    supabase.from('trademarks').select(TRADEMARK_SELECT).eq('id', ir.base_trademark_id).maybeSingle(),
    supabase.from('trademarks').select('country').eq('ir_id', irId),
  ]);
  if (!baseRow) return NextResponse.json({ error: 'The basic mark is not on record.' }, { status: 409 });
  const countries = designationCountries(body.countries, (existing ?? []).map((r) => r.country as string));
  if ('error' in countries) return NextResponse.json({ error: countries.error }, { status: 400 });

  const base = rowToTrademark(baseRow);
  const added = await insertDesignations(supabase, session.firmId, base, { id: ir.id, irNo: ir.ir_no, irDate: ir.ir_date }, {
    codes: countries.codes,
    designationDate: body.designationDate,
    refusalPeriodMonths: body.refusalPeriodMonths,
    createdBy: session.user.notionUserId,
  });
  if ('error' in added) return NextResponse.json({ error: added.error }, { status: 500 });

  logAudit({
    firmId: session.firmId,
    entityType: 'Trademark',
    entityId: base.id,
    entityName: base.mark || undefined,
    action: 'updated',
    fieldChanged: 'international_registration',
    newValue: JSON.stringify({ irId, designated: countries.codes, on: body.designationDate }),
    performedBy: session.user.notionUserId,
    ipAddress: getClientIP(req),
  });

  return NextResponse.json({ ok: true, registrations: await loadRegistrations(supabase, base.id) });
}
