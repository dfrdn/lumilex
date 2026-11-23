import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { validateBody } from '@/lib/validation';
import { logAudit, getClientIP } from '@/lib/audit';
import { proposalCreateSchema, engagementProposalContentSchema } from '@/lib/engagement-proposal/schema';
import { checkQuote } from '@/lib/engagement-proposal/quote';
import { draftProposalVersion, RecipientNotFound } from '@/lib/engagement-proposal/draft';
import { loadProfessionalBody } from '@/lib/fee-schedule/load';
import type { EngagementProposalRow } from '@/lib/engagement-proposal/types';

// A full draft is one Sonnet call over a long house-style prompt.
export const maxDuration = 120;

const PIPELINE_ROLES = new Set(['partner', 'admin', 'super_user']);

async function guard() {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  if (!PIPELINE_ROLES.has(session.user.role ?? '')) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }
  return { session };
}

/**
 * GET — proposals, newest first. `?intakeId=` narrows to one prospect's, which
 * is what the panel on a prospect's page shows.
 */
export async function GET(req: NextRequest) {
  const g = await guard();
  if (g.error) return g.error;

  const supabase = await getSupabaseServerAuthClient();
  let query = supabase.from('engagement_proposals').select('*');

  const intakeParam = req.nextUrl.searchParams.get('intakeId');
  if (intakeParam !== null) {
    const intakeId = Number(intakeParam);
    if (!Number.isInteger(intakeId)) {
      return NextResponse.json({ error: 'Invalid prospect id' }, { status: 400 });
    }
    query = query.eq('intake_id', intakeId);
  }

  const { data, error } = await query
    .order('updated_at', { ascending: false })
    .returns<EngagementProposalRow[]>();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const professional = await loadProfessionalBody(g.session!.firmId);
  return NextResponse.json({
    proposals: (data ?? []).map((row) => ({
      ...row,
      issues: checkQuote(row.content.quote, professional?.body ?? null),
    })),
  });
}

/**
 * POST — draft the first version of a new proposal. The recipient may be a
 * prospect in the intake pipeline or a client the firm already acts for; a
 * second proposal to the same recipient opens its own thread rather than
 * continuing the first one's version numbering.
 */
export async function POST(req: NextRequest) {
  const g = await guard();
  if (g.error) return g.error;
  const session = g.session!;

  const validation = await validateBody(req, proposalCreateSchema);
  if (!validation.success) return validation.response;
  const { recipient, ...input } = validation.data;

  const supabase = await getSupabaseServerAuthClient();

  let drafted;
  try {
    drafted = await draftProposalVersion({
      supabase,
      firmId: session.firmId,
      recipient,
      input,
      fallbackSigner: {
        personId: session.user.notionUserId,
        name: session.user.name ?? '',
      },
    });
  } catch (e) {
    if (e instanceof RecipientNotFound) {
      return NextResponse.json({ error: e.message }, { status: 404 });
    }
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }

  // Trust boundary: the drafted document is model output that will be stored,
  // rendered into a client-facing PDF, and later re-saved through PATCH — which
  // validates. Validate here too, or POST can persist a document PATCH rejects.
  const checked = engagementProposalContentSchema.safeParse(drafted.content);
  if (!checked.success) {
    return NextResponse.json(
      { error: 'The drafted proposal came back malformed. Try drafting again.' },
      { status: 502 },
    );
  }

  const { data: row, error } = await supabase
    .from('engagement_proposals')
    .insert({
      firm_id: session.firmId,
      intake_id: drafted.intakeId,
      client_id: drafted.clientId,
      version: 1,
      status: 'draft',
      content: checked.data,
      created_by: session.user.notionUserId,
    })
    .select('*')
    .single<EngagementProposalRow>();

  if (error || !row) {
    return NextResponse.json({ error: error?.message ?? 'Insert failed' }, { status: 500 });
  }

  logAudit({
    firmId: session.firmId,
    entityType: 'EngagementProposal',
    entityId: row.id,
    action: 'created',
    performedBy: session.user.notionUserId,
    ipAddress: getClientIP(req),
  });

  const professional = await loadProfessionalBody(session.firmId);
  return NextResponse.json({
    proposal: { ...row, issues: checkQuote(checked.data.quote, professional?.body ?? null) },
  });
}
