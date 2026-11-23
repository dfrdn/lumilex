import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { MATTER_STATUSES } from '@/lib/matter-status';

const PARTNER_ROLES = ['partner', 'super_user'];

interface MatterPatchBody {
  team_person_ids?: string[];
  status?: string;
  outcome?: string;
  related_matter_ids?: string[];
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const role = session.user.role ?? 'lawyer';
  if (!PARTNER_ROLES.includes(role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: 'Missing matter id' }, { status: 400 });
  }

  const body = (await req.json()) as MatterPatchBody;
  if (body.status !== undefined && !(MATTER_STATUSES as readonly string[]).includes(body.status)) {
    return NextResponse.json({ error: `Status must be one of ${MATTER_STATUSES.join(', ')}` }, { status: 400 });
  }
  const supabase = await getSupabaseServerAuthClient();

  const update: Record<string, unknown> = {};
  if (Array.isArray(body.team_person_ids)) update.team_person_ids = body.team_person_ids;
  if (typeof body.status === 'string') update.status = body.status;
  if (typeof body.outcome === 'string') update.outcome = body.outcome;

  // Related matters need bidirectional sync
  if (Array.isArray(body.related_matter_ids)) {
    const next = Array.from(new Set(body.related_matter_ids.filter((x) => x !== id)));

    // Fetch current value to compute diff
    const { data: current, error: currentErr } = await supabase
      .from('matters')
      .select('related_matter_ids')
      .eq('notion_id', id)
      .single();
    if (currentErr) {
      return NextResponse.json({ error: currentErr.message }, { status: 500 });
    }
    const prev: string[] = current?.related_matter_ids ?? [];
    const added = next.filter((x) => !prev.includes(x));
    const removed = prev.filter((x) => !next.includes(x));

    update.related_matter_ids = next;

    // For each added sibling, ensure it has our id in its related list
    for (const sibId of added) {
      const { data: sib } = await supabase
        .from('matters')
        .select('related_matter_ids')
        .eq('notion_id', sibId)
        .single();
      const sibRelated: string[] = sib?.related_matter_ids ?? [];
      if (!sibRelated.includes(id)) {
        await supabase
          .from('matters')
          .update({ related_matter_ids: [...sibRelated, id] })
          .eq('notion_id', sibId);
      }
    }

    // For each removed sibling, drop our id from their related list
    for (const sibId of removed) {
      const { data: sib } = await supabase
        .from('matters')
        .select('related_matter_ids')
        .eq('notion_id', sibId)
        .single();
      const sibRelated: string[] = sib?.related_matter_ids ?? [];
      if (sibRelated.includes(id)) {
        await supabase
          .from('matters')
          .update({ related_matter_ids: sibRelated.filter((x) => x !== id) })
          .eq('notion_id', sibId);
      }
    }
  }

  if (Object.keys(update).length > 0) {
    const { error } = await supabase.from('matters').update(update).eq('notion_id', id);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true });
}
