import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { filingCalendarRedateSchema, validateBody } from '@/lib/validation';
import { redateOpenFilings } from '@/lib/corporations/redate';
import { CALENDAR_EDITOR_ROLES } from '@/lib/corporations/filing-calendar';
import { logAudit, getClientIP } from '@/lib/audit';

/**
 * POST /api/corporation-calendar/redate — move every open AFS or ITR filing
 * for a filing year onto the calendar's date. `dryRun` lists them only.
 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.user?.notionUserId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const role = session.user.role ?? '';
  if (!CALENDAR_EDITOR_ROLES.includes(role)) {
    return NextResponse.json({ error: 'Your role can view the filing calendar but not change it.' }, { status: 403 });
  }

  const validation = await validateBody(req, filingCalendarRedateSchema);
  if (!validation.success) return validation.response;
  const { obligation, filingYear, dryRun } = validation.data;

  const supabase = await getSupabaseServerAuthClient();
  try {
    const changes = await redateOpenFilings(supabase, { obligation, filingYear, dryRun: !!dryRun });
    if (!dryRun && changes.length) {
      logAudit({
        firmId: session.firmId,
        entityType: 'FilingCalendar',
        entityId: `${obligation}-${filingYear}`,
        action: 'redated_filings',
        newValue: `${changes.length} filing(s)`,
        performedBy: session.user.notionUserId,
        ipAddress: getClientIP(req),
      });
    }
    return NextResponse.json({ changes });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Re-date failed' }, { status: 500 });
  }
}
