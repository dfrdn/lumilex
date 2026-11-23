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
    type,
    subtype,
    priority,
    externalDueDate,
    drafterIds,
    reviewerIds: incomingReviewerIds,
    reviewDates: incomingReviewDates,
    subjectId,
  } = await req.json();

  if (!name || !type) {
    return NextResponse.json({ error: 'Name and type are required' }, { status: 400 });
  }
  if (subjectId != null && (typeof subjectId !== 'string' || !subjectId.trim() || subjectId.length > 100)) {
    return NextResponse.json({ error: 'Invalid subjectId' }, { status: 400 });
  }

  try {
    const supabase = await getSupabaseServerAuthClient();

    // Work for a company or mark sits on a matter that covers it.
    if (subjectId) {
      const { data: link } = matterId
        ? await supabase.from('matter_subjects').select('subject_id').eq('matter_id', matterId).eq('subject_id', subjectId).maybeSingle()
        : { data: null };
      if (!link) return NextResponse.json({ error: 'That matter does not cover this company' }, { status: 400 });
    }

    // Resolve matter name + client
    let matterName = '';
    let clientName = '';
    if (matterId) {
      const { data: matterRow } = await supabase
        .from('matters')
        .select('name, client_name')
        .eq('notion_id', matterId)
        .single();
      matterName = matterRow?.name ?? '';
      clientName = matterRow?.client_name ?? '';
    }

    const reviewerIds: string[] = incomingReviewerIds ?? [];
    const reviewDates: (string | null)[] = incomingReviewDates ?? [];

    const newId = mintId('deliverable');
    const { data: created, error: dbErr } = await supabase
      .from('deliverables')
      .insert({
        firm_id: session.firmId,
        notion_id: newId,
        notion_url: '',
        name,
        matter_id: matterId ?? null,
        subject_id: subjectId ?? null,
        matter_name: matterName,
        client_name: clientName,
        type,
        subtype: subtype ?? null,
        status: DELIVERABLE_STATUS.NOT_STARTED,
        drafter_ids: drafterIds ?? [],
        reviewer_ids: reviewerIds,
        review_dates: reviewDates,
        currently_with_ids: drafterIds ?? [],
        external_due_date: externalDueDate ?? null,
        priority: priority ?? '',
        date_done: null,
        revision_count: 0,
        parent_deliverable_id: null,
        related_hearing_id: null,
        created_time: new Date().toISOString(),
        notion_last_edited_at: new Date().toISOString(),
        synced_at: new Date().toISOString(),
      })
      .select('notion_id, name, matter_id, matter_name, status, drafter_ids, reviewer_ids')
      .single();

    if (dbErr) {
      console.error('[deliverable] Supabase insert error:', dbErr.message);
      if (dbErr.code === '42501') {
        return NextResponse.json(
          { error: 'You cannot create this deliverable because you are not part of the matter.' },
          { status: 403 },
        );
      }
      return NextResponse.json({ error: dbErr.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, deliverable: created });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[deliverable] Error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
