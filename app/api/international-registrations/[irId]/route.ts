import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { validateBody, internationalRegistrationPatchSchema } from '@/lib/validation';
import { logAudit, getClientIP } from '@/lib/audit';
import { manilaToday } from '@/lib/dates';
import { loadRegistrations } from '@/lib/trademarks/international';

const COLUMN = {
  irNo: 'ir_no',
  irDate: 'ir_date',
  applicationFiledDate: 'application_filed_date',
  renewalFilingDate: 'renewal_filing_date',
  ceasedDate: 'ceased_date',
  notes: 'notes',
} as const;

/**
 * PATCH /api/international-registrations/[irId] — completes or corrects an
 * international registration: its number and date once WIPO registers it,
 * its renewal, or the day it ceased with the basic mark. Its designations
 * take the number and date by trigger.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ irId: string }> }) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const validation = await validateBody(req, internationalRegistrationPatchSchema);
  if (!validation.success) return validation.response;
  const { irId } = await params;

  const today = manilaToday();
  const updates: Record<string, string | null> = {};
  for (const [key, col] of Object.entries(COLUMN) as [keyof typeof COLUMN, string][]) {
    const v = validation.data[key];
    if (v === undefined) continue;
    if (key !== 'irNo' && key !== 'notes' && v && v > today) {
      return NextResponse.json({ error: 'That date is in the future' }, { status: 400 });
    }
    updates[col] = typeof v === 'string' ? v.trim() || null : v;
  }
  if (!Object.keys(updates).length) return NextResponse.json({ error: 'Nothing to change' }, { status: 400 });

  const supabase = await getSupabaseServerAuthClient();
  const { data: before } = await supabase
    .from('international_registrations')
    .select('base_trademark_id, ir_date, application_filed_date, renewal_filing_date, ceased_date')
    .eq('id', irId)
    .maybeSingle();
  if (!before) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const after = (col: 'ir_date' | 'application_filed_date' | 'renewal_filing_date' | 'ceased_date') =>
    (col in updates ? updates[col] : before[col]) as string | null;
  const irDate = after('ir_date');
  const filed = after('application_filed_date');
  // WIPO dates the IR no earlier than IPOPHL's receipt of the international application.
  if (irDate && filed && irDate < filed) {
    return NextResponse.json({ error: 'The international registration is dated before the application was filed with IPOPHL.' }, { status: 400 });
  }
  // Checked against the stored dates too, so moving the IR date can't leave a renewal or cessation before it.
  for (const col of ['renewal_filing_date', 'ceased_date'] as const) {
    const d = after(col);
    if (d && irDate && d < irDate) {
      return NextResponse.json({ error: `The ${col === 'ceased_date' ? 'date it ceased' : 'renewal'} is before the international registration.` }, { status: 400 });
    }
  }
  if ('ir_date' in updates && irDate) {
    const { data: later } = await supabase
      .from('trademarks').select('designation_date').eq('ir_id', irId).lt('designation_date', irDate).limit(1);
    if (later?.length) {
      return NextResponse.json({ error: 'A later designation is dated before that — correct its designation date first.' }, { status: 400 });
    }
  }

  const { error } = await supabase
    .from('international_registrations')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', irId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  logAudit({
    firmId: session.firmId,
    entityType: 'Trademark',
    entityId: before.base_trademark_id,
    action: 'updated',
    fieldChanged: 'international_registration',
    newValue: JSON.stringify({ irId, ...updates }),
    performedBy: session.user.notionUserId,
    ipAddress: getClientIP(req),
  });

  return NextResponse.json({ ok: true, registrations: await loadRegistrations(supabase, before.base_trademark_id) });
}
