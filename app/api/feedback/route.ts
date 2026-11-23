import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { mintId } from '@/lib/ids';
import { notifyPartnersOfFeedback } from '@/lib/notifications';

export async function GET() {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const personId = session.user.notionUserId;

  try {
    const supabase = await getSupabaseServerAuthClient();
    // RLS (feedbacks_select) scopes to own + admin/partner role override.
    const { data, error } = await supabase
      .from('feedbacks')
      .select('notion_id, subject, type, feedback_date, message, response')
      .eq('submitted_by', personId)
      .order('feedback_date', { ascending: false });

    if (error) {
      console.error('[feedback]', error.message); return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }

    return NextResponse.json({ feedbacks: data ?? [] });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const personId = session.user.notionUserId;
  const { subject, type, message } = await req.json();

  if (!subject || !type || !message) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  try {
    const supabase = await getSupabaseServerAuthClient();
    const newId = mintId('feedback');

    const { data: created, error: dbErr } = await supabase
      .from('feedbacks')
      .insert({
        firm_id: session.firmId,
        notion_id: newId,
        notion_url: '',
        subject,
        type,
        feedback_date: new Date().toISOString(),
        message,
        response: '',
        submitted_by: personId,
        synced_at: new Date().toISOString(),
      })
      .select('notion_id, subject, type, feedback_date, message, response')
      .single();

    if (dbErr) {
      console.error('[feedback] Supabase insert error:', dbErr.message);
      return NextResponse.json({ error: 'Failed to submit feedback' }, { status: 500 });
    }

    notifyPartnersOfFeedback({
      firmId: session.firmId,
      notionId: newId,
      submitterId: personId,
      subject,
      feedbackType: type,
      message,
    }).catch((err) => console.error('[feedback] notifyPartners failed:', err.message));

    return NextResponse.json({ ok: true, feedback: created });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[feedback] Error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
