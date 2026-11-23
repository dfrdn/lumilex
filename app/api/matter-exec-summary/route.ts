import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { generateExecSummary, type MatterCtx } from '@/lib/ai/exec-summary';

export const maxDuration = 120;

/**
 * GET  /api/matter-exec-summary?matterId=xxx
 *   Returns the cached summary + staleness flag (stale if > 24h old).
 *
 * POST /api/matter-exec-summary  { matterId }
 *   Regenerates and upserts.
 */
export async function GET(req: Request) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  const matterId = url.searchParams.get('matterId');
  if (!matterId) return NextResponse.json({ error: 'matterId required' }, { status: 400 });

  const supabase = getServiceDbForFirm(session.firmId);
  const { data } = await supabase
    .from('matter_exec_summaries')
    .select('*')
    .eq('matter_id', matterId)
    .maybeSingle();

  if (!data) return NextResponse.json({ summary: null });

  const ageMs = Date.now() - new Date(data.updated_at).getTime();
  const stale = ageMs > 24 * 60 * 60 * 1000;

  return NextResponse.json({
    overview: data.overview,
    currentPosture: data.current_posture,
    parties: data.parties ?? [],
    timeline: data.timeline ?? [],
    keyRulings: data.key_rulings ?? [],
    openItems: data.open_items ?? [],
    readingList: data.reading_list ?? [],
    generatedAt: data.generated_at,
    stale,
  });
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { matterId } = await req.json();
  if (!matterId) return NextResponse.json({ error: 'matterId required' }, { status: 400 });

  const supabase = getServiceDbForFirm(session.firmId);
  const { data: matter, error: mErr } = await supabase
    .from('matters')
    .select('notion_id, name, matter_code, type, status, case_title, case_number, case_description, court, client_name, is_case')
    .eq('notion_id', matterId)
    .single();

  if (mErr || !matter) {
    return NextResponse.json({ error: 'Matter not found' }, { status: 404 });
  }

  const ctx: MatterCtx = {
    notion_id: matter.notion_id,
    name: matter.name,
    matter_code: matter.matter_code,
    type: matter.type,
    status: matter.status,
    case_title: matter.case_title,
    case_number: matter.case_number,
    case_description: matter.case_description,
    court: matter.court,
    client_name: matter.client_name,
    is_case: !!matter.is_case,
  };

  try {
    const result = await generateExecSummary(ctx, session.firmId);

    const nowIso = new Date().toISOString();
    await supabase.from('matter_exec_summaries').upsert({
      matter_id: matterId,
      overview: result.overview,
      current_posture: result.current_posture,
      parties: result.parties,
      timeline: result.timeline,
      key_rulings: result.key_rulings,
      open_items: result.open_items,
      reading_list: result.reading_list,
      model_used: result.model,
      token_count_input: result.input_tokens,
      token_count_output: result.output_tokens,
      generated_at: nowIso,
      updated_at: nowIso,
    }, { onConflict: 'matter_id' });

    return NextResponse.json({
      overview: result.overview,
      currentPosture: result.current_posture,
      parties: result.parties,
      timeline: result.timeline,
      keyRulings: result.key_rulings,
      openItems: result.open_items,
      readingList: result.reading_list,
      generatedAt: nowIso,
      stale: false,
    });
  } catch (err) {
    console.error('[matter-exec-summary] Generation failed:', err);
    return NextResponse.json({ error: 'Failed to generate executive summary' }, { status: 500 });
  }
}
