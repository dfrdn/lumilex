import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { generateGroupBrief } from '@/lib/ai/group-brief';
import { getMatterGroupMemberIds } from '@/lib/queries/matter-groups';

/**
 * GET /api/matter-group-summary?rootId=xxx
 * Returns cached group brief (stale flag included).
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const rootId = req.nextUrl.searchParams.get('rootId');
  if (!rootId) return NextResponse.json({ error: 'rootId required' }, { status: 400 });

  const supabase = getServiceDbForFirm(session.firmId);
  const { data } = await supabase
    .from('matter_group_summaries')
    .select('*')
    .eq('root_matter_id', rootId)
    .maybeSingle();

  if (!data) return NextResponse.json({ summary: null });

  const ageMs = Date.now() - new Date(data.updated_at).getTime();
  const stale = ageMs > 24 * 60 * 60 * 1000;

  return NextResponse.json({
    rootMatterId: data.root_matter_id,
    memberMatterIds: data.member_matter_ids ?? [],
    summary: data.summary ?? '',
    posture: data.posture ?? null,
    progressionNotes: data.progression_notes ?? null,
    parties: data.parties ?? null,
    keyDates: data.key_dates ?? [],
    keyRulings: data.key_rulings ?? null,
    openIssues: data.open_issues ?? [],
    modelUsed: data.model_used ?? null,
    generatedAt: data.generated_at,
    stale,
  });
}

/**
 * POST /api/matter-group-summary { rootId: string }
 * Generates a fresh group brief and upserts into matter_group_summaries.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { rootId } = await req.json();
  if (!rootId) return NextResponse.json({ error: 'rootId required' }, { status: 400 });

  try {
    const memberIds = await getMatterGroupMemberIds(session.firmId, rootId);
    if (memberIds.length === 0) {
      return NextResponse.json({ error: 'Group not found' }, { status: 404 });
    }

    const canonicalRootId = memberIds.slice().sort()[0];

    const brief = await generateGroupBrief({
      firmId: session.firmId,
      root_matter_id: canonicalRootId,
      member_matter_ids: memberIds,
    });

    const supabase = getServiceDbForFirm(session.firmId);
    await supabase.from('matter_group_summaries').upsert({
      root_matter_id: canonicalRootId,
      member_matter_ids: memberIds,
      summary: brief.summary,
      posture: brief.posture,
      progression_notes: brief.progression_notes,
      parties: brief.parties,
      key_dates: brief.key_dates,
      key_rulings: brief.key_rulings,
      open_issues: brief.open_issues,
      model_used: brief.model,
      token_count_input: brief.input_tokens,
      token_count_output: brief.output_tokens,
      generated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'root_matter_id' });

    return NextResponse.json({
      rootMatterId: canonicalRootId,
      memberMatterIds: memberIds,
      summary: brief.summary,
      posture: brief.posture,
      progressionNotes: brief.progression_notes,
      parties: brief.parties,
      keyDates: brief.key_dates,
      keyRulings: brief.key_rulings,
      openIssues: brief.open_issues,
      modelUsed: brief.model,
      generatedAt: new Date().toISOString(),
      stale: false,
    });
  } catch (err) {
    console.error('[matter-group-summary] Error generating brief:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to generate group brief' },
      { status: 500 },
    );
  }
}
