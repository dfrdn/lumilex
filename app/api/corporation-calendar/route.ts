import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { filingCalendarSchema, validateBody } from '@/lib/validation';
import { rowToFilingCalendarEntry } from '@/lib/corporations/filing-calendar';
import { redateOpenFilings } from '@/lib/corporations/redate';
import { logAudit, getClientIP } from '@/lib/audit';

/**
 * PUT /api/corporation-calendar — set one year's AFS or ITR deadline for
 * December year-end companies (upsert on obligation + filing year).
 *
 * Returns the row and the open filings the change would re-date, so the page
 * can offer to apply it (POST /api/corporation-calendar/redate).
 */
export async function PUT(req: Request) {
  const session = await getSession();
  if (!session?.user?.notionUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const validation = await validateBody(req, filingCalendarSchema);
  if (!validation.success) return validation.response;
  const v = validation.data;

  const supabase = await getSupabaseServerAuthClient();
  const { data, error } = await supabase
    .from('compliance_calendar')
    .upsert(
      {
        firm_id: session.firmId,
        obligation: v.obligation,
        filing_year: v.filingYear,
        due_date: v.dueDate,
        original_due_date: v.originalDueDate ?? null,
        digit_schedule: v.digitSchedule ?? null,
        source: v.source || null,
        updated_by: session.user.notionUserId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'firm_id,obligation,filing_year' },
    )
    .select('*')
    .single();
  if (error?.code === '42501') {
    return NextResponse.json({ error: 'Your role can view the filing calendar but not change it.' }, { status: 403 });
  }
  if (error || !data) return NextResponse.json({ error: error?.message ?? 'Save failed' }, { status: 500 });

  logAudit({
    firmId: session.firmId,
    entityType: 'FilingCalendar',
    entityId: `${v.obligation}-${v.filingYear}`,
    action: 'updated',
    newValue: v.dueDate ?? JSON.stringify(v.digitSchedule),
    performedBy: session.user.notionUserId,
    ipAddress: getClientIP(req),
  });

  const pending = await redateOpenFilings(supabase, { obligation: v.obligation, filingYear: v.filingYear, dryRun: true });
  return NextResponse.json({ entry: rowToFilingCalendarEntry(data as Record<string, unknown>), pending });
}

/** DELETE /api/corporation-calendar?id=… — the year falls back to its projection. */
export async function DELETE(req: Request) {
  const session = await getSession();
  if (!session?.user?.notionUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const id = Number(new URL(req.url).searchParams.get('id'));
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'id is required' }, { status: 400 });

  const supabase = await getSupabaseServerAuthClient();
  const { data, error } = await supabase.from('compliance_calendar').delete().eq('id', id).select('obligation, filing_year');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data?.length) return NextResponse.json({ error: 'Not found, or your role cannot change the calendar.' }, { status: 404 });

  logAudit({
    firmId: session.firmId,
    entityType: 'FilingCalendar',
    entityId: `${data[0].obligation}-${data[0].filing_year}`,
    action: 'deleted',
    performedBy: session.user.notionUserId,
    ipAddress: getClientIP(req),
  });
  return NextResponse.json({ ok: true });
}
