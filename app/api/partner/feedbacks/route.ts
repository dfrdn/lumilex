import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { notifyApplicantOfFeedbackResponse } from '@/lib/notifications';
import { logAudit, getClientIP } from '@/lib/audit';

/**
 * GET — list all feedbacks (partner/super_user only)
 * PATCH — respond to a feedback, or dismiss / restore it (`{ notionId, dismissed }`)
 */
export async function GET() {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const role = session.user.role ?? 'lawyer';
  if (role !== 'partner' && role !== 'super_user') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const supabase = getServiceDbForFirm(session.firmId);
  const { data, error } = await supabase
    .from('feedbacks')
    .select('notion_id, notion_url, subject, type, feedback_date, message, response, dismissed_at, synced_at')
    .order('feedback_date', { ascending: false });

  if (error) {
    console.error('[partner-feedbacks]', error.message); return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }

  return NextResponse.json({ feedbacks: data ?? [] });
}

export async function PATCH(req: Request) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const role = session.user.role ?? 'lawyer';
  if (role !== 'partner' && role !== 'super_user') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { notionId, response, dismissed } = await req.json();

  // Dismissing takes a feedback out of the pending queue without a reply, so
  // the submitter is not notified.
  if (notionId && typeof dismissed === 'boolean') {
    const { error } = await getServiceDbForFirm(session.firmId)
      .from('feedbacks')
      .update(
        dismissed
          ? { dismissed_at: new Date().toISOString(), dismissed_by: session.user.notionUserId }
          : { dismissed_at: null, dismissed_by: null },
      )
      .eq('notion_id', notionId);
    if (error) {
      console.error('[partner/feedbacks] dismiss:', error.message);
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
    logAudit({
      firmId: session.firmId,
      entityType: 'Feedback',
      entityId: notionId,
      action: dismissed ? 'dismissed' : 'restored',
      performedBy: session.user.notionUserId,
      ipAddress: getClientIP(req),
    });
    return NextResponse.json({ ok: true });
  }

  if (!notionId || !response) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
  }

  const supabase = getServiceDbForFirm(session.firmId);

  try {
    const { data: feedbackRow } = await supabase
      .from('feedbacks')
      .select('submitted_by, subject, type')
      .eq('notion_id', notionId)
      .limit(1)
      .single();

    const { error } = await supabase
      .from('feedbacks')
      .update({ response })
      .eq('notion_id', notionId);

    if (error) throw error;

    if (feedbackRow?.submitted_by) {
      notifyApplicantOfFeedbackResponse({
        firmId: session.firmId,
        notionId,
        submitterId: feedbackRow.submitted_by,
        reviewerId: session.user.notionUserId,
        subject: feedbackRow.subject ?? '',
        feedbackType: feedbackRow.type ?? 'General',
        response,
      }).catch((err) => console.error('[partner/feedbacks] notifyApplicant failed:', err.message));
    }

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[partner/feedbacks] Error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
