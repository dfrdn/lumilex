import { NextRequest, NextResponse } from 'next/server';
import { cleanChoices, readSavedSidebar, setAreaChoices } from '@/lib/nav/custom-sidebar';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { sidebarLayoutSaveSchema, validateBody } from '@/lib/validation';

/** Save the person's sidebar for one area; `choices: null` puts that area back on the role's default. */
export async function PUT(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.notionUserId || !session.user.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const validation = await validateBody(req, sidebarLayoutSaveSchema);
  if (!validation.success) return validation.response;
  const { area, choices } = validation.data;
  const email = session.user.email.toLowerCase().trim();

  // RLS (user_preferences_own) scopes the row to the signed-in email in their
  // firm. The other areas are kept from the row, not from what this browser
  // last saw.
  const supabase = await getSupabaseServerAuthClient();
  const { data: row, error: readError } = await supabase
    .from('user_preferences')
    .select('sidebar_layout')
    .eq('firm_id', session.firmId)
    .eq('email', email)
    .maybeSingle();
  if (readError) {
    console.error('[sidebar] Failed to read before saving:', readError);
    return NextResponse.json({ error: 'Failed to save sidebar' }, { status: 500 });
  }

  const next = setAreaChoices(readSavedSidebar(row?.sidebar_layout), area, choices && cleanChoices(choices));
  const { error } = await supabase
    .from('user_preferences')
    .upsert(
      {
        firm_id: session.firmId,
        email,
        sidebar_layout: Object.keys(next).length > 0 ? next : null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'firm_id,email' },
    );

  if (error) {
    console.error('[sidebar] Failed to save:', error);
    return NextResponse.json({ error: 'Failed to save sidebar' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
