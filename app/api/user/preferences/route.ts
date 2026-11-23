import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';

const DEFAULTS = {
  notify_deadlines: true,
  notify_hearings: true,
  notify_new_deliverables: true,
  notify_meetings: true,
  notify_email_briefer: true,
  notify_emails: true,
  notify_deliverable_transfer_email: true,
  notify_meeting_attendee_email: true,
  notify_hearing_attendee_email: true,
  notify_status_changes_watching: false,
  notify_push_enabled: false,
  notify_chat: true,
};

export async function GET() {
  const session = await getSession();
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = await getSupabaseServerAuthClient();
  // RLS (user_preferences_own) scopes to email = current_email().
  const { data } = await supabase
    .from('user_preferences')
    .select('*')
    .eq('email', session.user.email.toLowerCase().trim())
    .single();

  return NextResponse.json(data ?? { ...DEFAULTS, email: session.user.email });
}

export async function PUT(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json();
  const email = session.user.email.toLowerCase().trim();
  const supabase = await getSupabaseServerAuthClient();

  const { data, error } = await supabase
    .from('user_preferences')
    .upsert(
      {
        firm_id: session.firmId,
        email,
        notify_deadlines: body.notify_deadlines ?? DEFAULTS.notify_deadlines,
        notify_hearings: body.notify_hearings ?? DEFAULTS.notify_hearings,
        notify_new_deliverables: body.notify_new_deliverables ?? DEFAULTS.notify_new_deliverables,
        notify_meetings: body.notify_meetings ?? DEFAULTS.notify_meetings,
        notify_email_briefer: body.notify_email_briefer ?? DEFAULTS.notify_email_briefer,
        notify_emails: body.notify_emails ?? DEFAULTS.notify_emails,
        notify_deliverable_transfer_email:
          body.notify_deliverable_transfer_email ?? DEFAULTS.notify_deliverable_transfer_email,
        notify_meeting_attendee_email:
          body.notify_meeting_attendee_email ?? DEFAULTS.notify_meeting_attendee_email,
        notify_hearing_attendee_email:
          body.notify_hearing_attendee_email ?? DEFAULTS.notify_hearing_attendee_email,
        notify_status_changes_watching:
          body.notify_status_changes_watching ?? DEFAULTS.notify_status_changes_watching,
        notify_push_enabled:
          body.notify_push_enabled ?? DEFAULTS.notify_push_enabled,
        notify_chat: body.notify_chat ?? DEFAULTS.notify_chat,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'firm_id,email' },
    )
    .select()
    .single();

  if (error) {
    console.error('[preferences] Failed to save:', error);
    return NextResponse.json({ error: 'Failed to save preferences' }, { status: 500 });
  }

  return NextResponse.json(data);
}
