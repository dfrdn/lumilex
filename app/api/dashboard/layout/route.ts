import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { dashboardLayoutSaveSchema, validateBody } from '@/lib/validation';

/** Save the person's dashboard layout: which widgets they show, in what order, and whose calendar. */
export async function PUT(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.notionUserId || !session.user.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const validation = await validateBody(req, dashboardLayoutSaveSchema);
  if (!validation.success) return validation.response;

  // RLS (user_preferences_own) scopes the row to the signed-in email in their firm.
  const supabase = await getSupabaseServerAuthClient();
  const { error } = await supabase
    .from('user_preferences')
    .upsert(
      {
        firm_id: session.firmId,
        email: session.user.email.toLowerCase().trim(),
        dashboard_layout: validation.data.layout,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'firm_id,email' },
    );

  if (error) {
    console.error('[dashboard-layout] Failed to save:', error);
    return NextResponse.json({ error: 'Failed to save layout' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
