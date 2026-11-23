import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import {
  ensureStatusReportForHearing,
  ensureStatusReportForFiledDeliverable,
} from '@/lib/status-report-auto';

/**
 * Admin action: manually create a Status Report deliverable from a parent
 * hearing or filing. Reuses the idempotent helpers from status-report-auto —
 * if a status report already exists for this parent, returns the existing id.
 *
 * Body: { source: 'hearing' | 'filing', notionId: string }
 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!['admin', 'super_user'].includes(session.user.role ?? '')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { source, notionId } = (await req.json()) as {
    source: 'hearing' | 'filing';
    notionId: string;
  };

  if (!notionId || !source) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
  }

  try {
    const result =
      source === 'hearing'
        ? await ensureStatusReportForHearing(notionId, {
            performedBy: session.user.notionUserId,
            firmId: session.firmId,
          })
        : await ensureStatusReportForFiledDeliverable(notionId, {
            performedBy: session.user.notionUserId,
            firmId: session.firmId,
          });

    return NextResponse.json({
      ok: true,
      created: result.created,
      deliverableId: result.deliverableId,
      reason: result.reason,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[status-report/from-parent]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
