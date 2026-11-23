import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { mintId } from '@/lib/ids';
import { DELIVERABLE_STATUS } from '@/lib/deliverable-status';

export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const {
    name,
    matterId,
    deadline,
    type,
    drafterIds,
    reviewerIds: incomingReviewerIds,
    reviewDates: incomingReviewDates,
  } = await req.json();

  if (!name || !matterId || !deadline) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  try {
    const supabase = await getSupabaseServerAuthClient();

    // Resolve matter name + client
    const { data: matterRow } = await supabase
      .from('matters')
      .select('name, client_name')
      .eq('notion_id', matterId)
      .single();
    const matterName = matterRow?.name ?? '';
    const clientName = matterRow?.client_name ?? '';

    const reviewerIds: string[] = incomingReviewerIds ?? [];
    const reviewDates: (string | null)[] = incomingReviewDates ?? [];

    const newId = mintId('deliverable');
    const { error: dbErr } = await supabase.from('deliverables').insert({
      firm_id: session.firmId,
      notion_id: newId,
      notion_url: '',
      name,
      matter_id: matterId,
      matter_name: matterName,
      client_name: clientName,
      type: type || '',
      status: DELIVERABLE_STATUS.DRAFTING,
      drafter_ids: drafterIds ?? [],
      reviewer_ids: reviewerIds,
      review_dates: reviewDates,
      currently_with_ids: drafterIds ?? [],
      external_due_date: deadline,
      priority: '',
      date_done: null,
      revision_count: 0,
      parent_deliverable_id: null,
      related_hearing_id: null,
      created_time: new Date().toISOString(),
      notion_last_edited_at: new Date().toISOString(),
      synced_at: new Date().toISOString(),
    });

    if (dbErr) {
      console.error('[filing] Supabase insert error:', dbErr.message);
      return NextResponse.json({ error: dbErr.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, deliverableId: newId });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[filing] Error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
