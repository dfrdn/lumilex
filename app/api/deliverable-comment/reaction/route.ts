import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';

/** Toggle a reaction on a comment — POST to add, DELETE to remove */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const personId = session.user.notionUserId;
  const { commentId, emoji } = await req.json();

  if (!commentId || !emoji) {
    return NextResponse.json({ error: 'Missing commentId or emoji' }, { status: 400 });
  }

  const supabase = await getSupabaseServerAuthClient();

  try {
    // Check if reaction already exists — toggle behavior
    const { data: existing } = await supabase
      .from('deliverable_comment_reactions')
      .select('id')
      .eq('comment_id', commentId)
      .eq('person_id', personId)
      .eq('emoji', emoji)
      .single();

    if (existing) {
      // Remove the reaction
      await supabase
        .from('deliverable_comment_reactions')
        .delete()
        .eq('id', existing.id);
      return NextResponse.json({ action: 'removed' });
    }

    // Add the reaction
    const { error } = await supabase
      .from('deliverable_comment_reactions')
      .insert({ firm_id: session.firmId, comment_id: commentId, person_id: personId, emoji });

    if (error) throw error;
    return NextResponse.json({ action: 'added' }, { status: 201 });
  } catch (err) {
    console.error('[comment-reaction]', err);
    return NextResponse.json({ error: 'Failed to toggle reaction' }, { status: 500 });
  }
}
