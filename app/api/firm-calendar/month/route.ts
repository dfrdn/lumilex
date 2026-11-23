import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getFirmCalendarMonthData } from '@/lib/queries/firm-calendar-data';

// Re-export types for backward compatibility with existing imports
export type {
  CalendarLeave,
  CalendarDeliverable,
  CalendarErrand,
} from '@/lib/queries/firm-calendar-data';

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const start = req.nextUrl.searchParams.get('start');
  const end = req.nextUrl.searchParams.get('end');

  if (!start || !end) {
    return NextResponse.json({ error: 'start and end params required' }, { status: 400 });
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    return NextResponse.json({ error: 'Invalid date format (expected YYYY-MM-DD)' }, { status: 400 });
  }

  const data = await getFirmCalendarMonthData(session.firmId, start, end);
  return NextResponse.json(data);
}
