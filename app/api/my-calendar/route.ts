import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getMeetingsForWeek } from '@/lib/queries/meetings';
import { getHearingsForWeek } from '@/lib/queries/hearings';
import { getFilingsForWeek } from '@/lib/queries/filings';
import { getTasksForWeek } from '@/lib/queries/tasks';


export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = session.user.notionUserId;
  const start = req.nextUrl.searchParams.get('start');
  const end = req.nextUrl.searchParams.get('end');

  if (!start || !end) {
    return NextResponse.json({ error: 'start and end params required' }, { status: 400 });
  }

  // Basic date format validation
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    return NextResponse.json({ error: 'Invalid date format (expected YYYY-MM-DD)' }, { status: 400 });
  }

  const [meetings, hearings, filings, tasks] = await Promise.all([
    getMeetingsForWeek(session.firmId, userId, start, end),
    getHearingsForWeek(session.firmId, start, end, userId),
    getFilingsForWeek(session.firmId, start, end, userId),
    getTasksForWeek(session.firmId, userId, start, end),
  ]);

  return NextResponse.json({ meetings, hearings, filings, tasks });
}
