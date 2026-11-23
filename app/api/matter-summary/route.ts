import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabase } from '@/lib/supabase';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { generateMatterBrief, type MatterContext } from '@/lib/ai/matter-brief';
import { generateEmbeddingsForMatterSummary } from '@/lib/ai/embeddings';

/**
 * GET /api/matter-summary?matterId=xxx
 * Returns cached summary if fresh (< 24h), otherwise returns cached + stale flag.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const matterId = req.nextUrl.searchParams.get('matterId');
  if (!matterId) return NextResponse.json({ error: 'matterId required' }, { status: 400 });

  const supabase = getServiceDbForFirm(session.firmId);
  const { data } = await supabase
    .from('matter_summaries')
    .select('*')
    .eq('matter_id', matterId)
    .single();

  if (!data) {
    return NextResponse.json({ summary: null });
  }

  // Also pull is_case flag so the client can decide which sections to render.
  const { data: matterRow } = await supabase
    .from('matters')
    .select('is_case')
    .eq('notion_id', matterId)
    .single();

  const ageMs = Date.now() - new Date(data.updated_at).getTime();
  const stale = ageMs > 24 * 60 * 60 * 1000;

  return NextResponse.json({
    summary: data.summary,
    latestIncident: data.latest_incident,
    latestIncidentDate: data.latest_incident_date,
    posture: data.posture ?? null,
    parties: data.parties ?? null,
    claimsAndDefenses: data.claims_and_defenses ?? null,
    courtAndVenue: data.court_and_venue ?? null,
    keyDates: data.key_dates ?? [],
    keyRulings: data.key_rulings ?? null,
    relevantAuthorities: data.relevant_authorities ?? null,
    openIssues: data.open_issues ?? [],
    briefVersion: data.brief_version ?? 1,
    isCase: !!matterRow?.is_case,
    generatedAt: data.generated_at,
    stale,
  });
}

/**
 * POST /api/matter-summary  { matterId: string }
 * Generates a new summary and caches it.
 */
export async function POST(req: NextRequest) {
  // Allow access via CRON_SECRET (for DB triggers) or authenticated session
  let sessionFirmId: string | null = null;
  const cronSecret = req.headers.get('x-cron-secret');
  if (cronSecret && cronSecret === process.env.CRON_SECRET) {
    // Authorized via cron secret
  } else {
    const session = await getSession();
    if (!session?.user?.notionUserId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    sessionFirmId = session.firmId;
  }

  const { matterId, firmId: payloadFirmId } = await req.json();
  if (!matterId) return NextResponse.json({ error: 'matterId required' }, { status: 400 });

  try {
    // Resolve the firm scope: a session pins it to the caller's firm; the
    // trigger payload carries firmId; a legacy payload without one falls back
    // to looking the matter up unscoped. A payload firmId that doesn't match
    // the matter's real firm makes the scoped reads/writes below no-ops — the
    // desired fail-safe.
    let firmId = sessionFirmId ?? (typeof payloadFirmId === 'string' ? payloadFirmId : null);
    if (!firmId) {
      // firm-resolution lookup: scoped client follows.
      const { data: owner } = await getSupabase()
        .from('matters')
        .select('firm_id')
        .eq('notion_id', matterId)
        .single();
      if (!owner?.firm_id) {
        return NextResponse.json({ error: 'Matter not found' }, { status: 404 });
      }
      firmId = owner.firm_id as string;
    }
    const supabase = getServiceDbForFirm(firmId);

    // Load matter with all fields the brief generator needs, including is_case.
    const { data: matter, error: matterErr } = await supabase
      .from('matters')
      .select('notion_id, name, matter_code, type, status, case_title, case_number, case_description, court, client_name, is_case')
      .eq('notion_id', matterId)
      .single();

    if (matterErr || !matter) {
      return NextResponse.json({ error: 'Matter not found' }, { status: 404 });
    }

    const context: MatterContext = {
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
      firmId,
    };

    const brief = await generateMatterBrief(context);

    // When the juris.ph pass was unavailable (null) the upsert below preserves
    // the stored authorities — echo those same stored ones in the response so
    // the client's setData doesn't blank a section the DB still has.
    let relevantAuthorities = brief.relevant_authorities;
    if (relevantAuthorities === null && matter.is_case) {
      const { data: existing } = await supabase
        .from('matter_summaries')
        .select('relevant_authorities')
        .eq('matter_id', matterId)
        .maybeSingle();
      relevantAuthorities = existing?.relevant_authorities ?? null;
    }

    // Upsert into matter_summaries — persist both the legacy fields (summary,
    // latest_incident, latest_incident_date) so existing UI / RAG keep working,
    // and the new structured sections.
    await supabase.from('matter_summaries').upsert({
      matter_id: matterId,
      // Legacy / shared.
      summary: brief.summary,
      latest_incident: brief.latest_incident,
      latest_incident_date: brief.latest_incident_date,
      // Structured.
      brief_version: brief.brief_version,
      key_dates: brief.key_dates,
      open_issues: brief.open_issues,
      posture: brief.posture,
      parties: brief.parties,
      claims_and_defenses: brief.claims_and_defenses,
      court_and_venue: brief.court_and_venue,
      key_rulings: brief.key_rulings,
      // null means juris.ph was unreachable (or a non-case) — omit the column
      // so an outage never clobbers previously stored authorities.
      ...(brief.relevant_authorities !== null
        ? { relevant_authorities: brief.relevant_authorities }
        : {}),
      // Meta.
      model_used: brief.model,
      token_count_input: brief.input_tokens,
      token_count_output: brief.output_tokens,
      generated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'matter_id' });

    // Re-embed the matter summary for semantic search (fire-and-forget).
    generateEmbeddingsForMatterSummary(matterId, firmId).catch((err) => {
      console.error('[matter-summary] Embedding generation failed:', err?.message);
    });

    return NextResponse.json({
      summary: brief.summary,
      latestIncident: brief.latest_incident,
      latestIncidentDate: brief.latest_incident_date,
      posture: brief.posture,
      parties: brief.parties,
      claimsAndDefenses: brief.claims_and_defenses,
      courtAndVenue: brief.court_and_venue,
      keyDates: brief.key_dates,
      keyRulings: brief.key_rulings,
      relevantAuthorities,
      openIssues: brief.open_issues,
      isCase: matter.is_case,
      generatedAt: new Date().toISOString(),
      stale: false,
    });
  } catch (err) {
    console.error('[matter-summary] Error generating summary:', err);
    return NextResponse.json(
      { error: 'Failed to generate summary' },
      { status: 500 },
    );
  }
}
