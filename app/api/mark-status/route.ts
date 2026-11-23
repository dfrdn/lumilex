import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { logAudit, getClientIP } from '@/lib/audit';
import {
  ensureStatusReportForHearing,
  ensureStatusReportForFiledDeliverable,
} from '@/lib/status-report-auto';
import { DELIVERABLE_STATUS } from '@/lib/deliverable-status';

// Marking a hearing/filing also awaits status-report creation (a short chain of
// Supabase round-trips) so the client can toast it. Give the response timeout
// headroom — a 504 here would make the client revert an action that persisted.
export const maxDuration = 30;

export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { entity, notionId, action } = await req.json();

  if (!entity || !notionId || !action) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
  }

  const supabase = await getSupabaseServerAuthClient();

  try {
    if (entity === 'meetings' && action === 'attended') {
      const { error } = await supabase
        .from('meetings')
        .update({ is_attended: true })
        .eq('notion_id', notionId);
      if (error) throw error;

      logAudit({
        firmId: session.firmId,
        entityType: 'meeting',
        entityId: notionId,
        action: 'attended',
        fieldChanged: 'is_attended',
        oldValue: 'false',
        newValue: 'true',
        performedBy: session.user.notionUserId,
        ipAddress: getClientIP(req),
      });

      return NextResponse.json({ ok: true });
    }

    if (entity === 'hearings' && action === 'attended') {
      const { error } = await supabase
        .from('hearings')
        .update({ is_attended: true })
        .eq('notion_id', notionId);
      if (error) throw error;

      logAudit({
        firmId: session.firmId,
        entityType: 'hearing',
        entityId: notionId,
        action: 'attended',
        fieldChanged: 'is_attended',
        oldValue: 'false',
        newValue: 'true',
        performedBy: session.user.notionUserId,
        ipAddress: getClientIP(req),
      });

      // Auto-create Status Report deliverable. The helper catches internally
      // and returns { created } (never throws), so we read the flag and tell
      // the user when one was made.
      const { created: statusReportCreated } = await ensureStatusReportForHearing(notionId, {
        performedBy: session.user.notionUserId,
        firmId: session.firmId,
      });

      return NextResponse.json({ ok: true, statusReportCreated });
    }

    if (entity === 'hearings' && action === 'cancelled') {
      const { error } = await supabase
        .from('hearings')
        .update({ status: 'Cancelled' })
        .eq('notion_id', notionId);
      if (error) throw error;

      logAudit({
        firmId: session.firmId,
        entityType: 'hearing',
        entityId: notionId,
        action: 'cancelled',
        fieldChanged: 'status',
        oldValue: undefined,
        newValue: 'Cancelled',
        performedBy: session.user.notionUserId,
        ipAddress: getClientIP(req),
      });

      return NextResponse.json({ ok: true });
    }

    if (entity === 'filings' && action === 'filed') {
      // Filings are deliverables — update status to 'Filed or Sent out'
      const { error } = await supabase
        .from('deliverables')
        .update({ status: DELIVERABLE_STATUS.FILED_OR_SENT_OUT })
        .eq('notion_id', notionId);
      if (error) throw error;

      logAudit({
        firmId: session.firmId,
        entityType: 'filing',
        entityId: notionId,
        action: 'filed',
        fieldChanged: 'status',
        oldValue: undefined,
        newValue: DELIVERABLE_STATUS.FILED_OR_SENT_OUT,
        performedBy: session.user.notionUserId,
        ipAddress: getClientIP(req),
      });

      // Auto-create Status Report deliverable. The helper catches internally
      // and returns { created } (never throws), so we read the flag and tell
      // the user when one was made.
      const { created: statusReportCreated } = await ensureStatusReportForFiledDeliverable(notionId, {
        performedBy: session.user.notionUserId,
        firmId: session.firmId,
      });

      return NextResponse.json({ ok: true, statusReportCreated });
    }

    return NextResponse.json({ error: 'Invalid entity/action' }, { status: 400 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[mark-status] Error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
