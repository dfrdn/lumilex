import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';

/** Toggle a reaction on a version submission — add if missing, remove if exists */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const personId = session.user.notionUserId;
  const { deliverableId, version, emoji } = await req.json();

  if (!deliverableId || version == null || !emoji) {
    return NextResponse.json({ error: 'Missing deliverableId, version, or emoji' }, { status: 400 });
  }

  const supabase = await getSupabaseServerAuthClient();

  try {
    // Check if reaction already exists — toggle behavior
    const { data: existing } = await supabase
      .from('deliverable_version_reactions')
      .select('id')
      .eq('deliverable_id', deliverableId)
      .eq('version', version)
      .eq('person_id', personId)
      .eq('emoji', emoji)
      .single();

    if (existing) {
      await supabase
        .from('deliverable_version_reactions')
        .delete()
        .eq('id', existing.id);
      return NextResponse.json({ action: 'removed' });
    }

    const { error } = await supabase
      .from('deliverable_version_reactions')
      .insert({ firm_id: session.firmId, deliverable_id: deliverableId, version, person_id: personId, emoji });

    if (error) throw error;
    return NextResponse.json({ action: 'added' }, { status: 201 });
  } catch (err) {
    console.error('[version-reaction]', err);
    return NextResponse.json({ error: 'Failed to toggle reaction' }, { status: 500 });
  }
}
