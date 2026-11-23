import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { validateBody, muteCreateSchema, muteDeleteSchema } from '@/lib/validation';

// Per-entity notification mutes. Muting an entity stops all future
// notifications about it (createNotificationsBatch filters muted pairs before
// insert + push) and clears any existing ones from the bell.

export async function GET() {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = await getSupabaseServerAuthClient();
  const { data } = await supabase
    .from('notification_mutes')
    .select('entity_id, label, created_at')
    .order('created_at', { ascending: false });

  return NextResponse.json({ mutes: data ?? [] });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const validation = await validateBody(req, muteCreateSchema);
  if (!validation.success) return validation.response;
  const { entityId, label } = validation.data;
  const personId = session.user.notionUserId;

  const supabase = await getSupabaseServerAuthClient();
  // RLS with-check gates person_id to the caller.
  const { error } = await supabase
    .from('notification_mutes')
    .upsert(
      { firm_id: session.firmId, person_id: personId, entity_id: entityId, label: label ?? null },
      { onConflict: 'firm_id,person_id,entity_id' },
    );
  if (error) {
    return NextResponse.json({ error: 'Failed to mute' }, { status: 500 });
  }

  // Clear the entity's existing notifications from the bell (RLS scopes the
  // delete to the caller's own rows).
  await supabase.from('notifications').delete().eq('entity_id', entityId);

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const validation = await validateBody(req, muteDeleteSchema);
  if (!validation.success) return validation.response;

  const supabase = await getSupabaseServerAuthClient();
  await supabase
    .from('notification_mutes')
    .delete()
    .eq('entity_id', validation.data.entityId);

  return NextResponse.json({ ok: true });
}
