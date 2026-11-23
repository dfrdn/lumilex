import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { validateBody } from '@/lib/validation';
import { logAudit, getClientIP } from '@/lib/audit';
import {
  proposalDraftSchema, proposalSaveSchema, engagementProposalContentSchema,
} from '@/lib/engagement-proposal/schema';
import { checkQuote } from '@/lib/engagement-proposal/quote';
import { draftProposalVersion, RecipientNotFound } from '@/lib/engagement-proposal/draft';
import { loadProfessionalBody } from '@/lib/fee-schedule/load';
import { loadProposalCatalogue } from '@/lib/engagement-proposal/catalogue';
import { loadPaymentDetails } from '@/lib/firm-profile/load';
import type { EngagementProposalRow, ProposalRecipient } from '@/lib/engagement-proposal/types';

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

/** RLS is the gate — an unreadable proposal comes back as null, not as a row. */
async function readProposal(id: string) {
  const supabase = await getSupabaseServerAuthClient();
  const { data } = await supabase
    .from('engagement_proposals')
    .select('*')
    .eq('id', id)
    .maybeSingle<EngagementProposalRow>();
  return { supabase, row: data };
}

function recipientOf(row: EngagementProposalRow): ProposalRecipient {
  return row.intake_id != null
    ? { kind: 'prospect', intakeId: row.intake_id }
    : { kind: 'client', clientId: row.client_id };
}

/** GET — one proposal, its thread siblings, and the catalogue the builder needs. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard();
  if (g.error) return g.error;
  const firmId = g.session!.firmId;

  const { supabase, row } = await readProposal((await params).id);
  if (!row) return NextResponse.json({ error: 'Proposal not found' }, { status: 404 });

  const { data: thread } = await supabase
    .from('engagement_proposals')
    .select('*')
    .eq('thread_id', row.thread_id)
    .order('version', { ascending: false })
    .returns<EngagementProposalRow[]>();

  const professional = await loadProfessionalBody(firmId);
  const withIssues = (r: EngagementProposalRow) => ({
    ...r,
    issues: checkQuote(r.content.quote, professional?.body ?? null),
  });

  const catalogue = await loadProposalCatalogue(firmId);
  // What the payment section falls back to for a draft saved before it existed.
  const payment = await loadPaymentDetails(firmId);

  // What the intake recorded, so the builder seeds the same scope selection the
  // drafting route would. A client-recipient proposal has no intake to read.
  let proposedServices: string[] = [];
  if (row.intake_id != null) {
    const { data: intake } = await supabase
      .from('client_intakes')
      .select('proposed_services')
      .eq('id', row.intake_id)
      .maybeSingle<{ proposed_services: string[] | null }>();
    proposedServices = intake?.proposed_services ?? [];
  }

  return NextResponse.json({
    proposal: withIssues(row),
    versions: (thread ?? []).map(withIssues),
    proposedServices,
    payment,
    ...catalogue,
  });
}

/** PATCH — save a drafter's edits to this version, or change its status. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard();
  if (g.error) return g.error;
  const session = g.session!;

  const id = (await params).id;
  const validation = await validateBody(req, proposalSaveSchema);
  if (!validation.success) return validation.response;
  const { status, content } = validation.data;

  const supabase = await getSupabaseServerAuthClient();
  const { data: row, error } = await supabase
    .from('engagement_proposals')
    .update({
      content,
      ...(status ? { status } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select('*')
    .maybeSingle<EngagementProposalRow>();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!row) return NextResponse.json({ error: 'Proposal not found' }, { status: 404 });

  logAudit({
    firmId: session.firmId,
    entityType: 'EngagementProposal',
    entityId: row.id,
    action: status ? `status:${status}` : 'updated',
    performedBy: session.user.notionUserId,
    ipAddress: getClientIP(req),
  });

  const professional = await loadProfessionalBody(session.firmId);
  return NextResponse.json({
    proposal: { ...row, issues: checkQuote(row.content.quote, professional?.body ?? null) },
  });
}

/**
 * POST — draft a further version of this proposal. The new version joins the
 * same thread and addresses the same recipient; the version it supersedes stays
 * on the record rather than being overwritten.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard();
  if (g.error) return g.error;
  const session = g.session!;

  const { supabase, row: current } = await readProposal((await params).id);
  if (!current) return NextResponse.json({ error: 'Proposal not found' }, { status: 404 });

  const validation = await validateBody(req, proposalDraftSchema);
  if (!validation.success) return validation.response;

  let drafted;
  try {
    drafted = await draftProposalVersion({
      supabase,
      firmId: session.firmId,
      recipient: recipientOf(current),
      input: validation.data,
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

  const checked = engagementProposalContentSchema.safeParse(drafted.content);
  if (!checked.success) {
    return NextResponse.json(
      { error: 'The drafted proposal came back malformed. Try drafting again.' },
      { status: 502 },
    );
  }

  // Reading the highest version then inserting is a check-then-write: two
  // partners drafting on the same thread at once would both compute the same
  // number. The unique (thread_id, version) index turns that into a 23505
  // rather than a duplicate, so retry on the collision instead of 500ing.
  let row: EngagementProposalRow | null = null;
  let lastError: string | null = null;
  for (let attempt = 0; attempt < 3 && !row; attempt++) {
    const { data: latest } = await supabase
      .from('engagement_proposals')
      .select('version')
      .eq('thread_id', current.thread_id)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle<{ version: number }>();

    const { data, error } = await supabase
      .from('engagement_proposals')
      .insert({
        firm_id: session.firmId,
        thread_id: current.thread_id,
        intake_id: drafted.intakeId,
        client_id: drafted.clientId,
        version: (latest?.version ?? 0) + 1,
        status: 'draft',
        content: checked.data,
        created_by: session.user.notionUserId,
      })
      .select('*')
      .single<EngagementProposalRow>();

    if (data) row = data;
    else if (error?.code !== '23505') {
      return NextResponse.json({ error: error?.message ?? 'Insert failed' }, { status: 500 });
    } else {
      lastError = error.message;
    }
  }

  if (!row) {
    return NextResponse.json(
      { error: `Could not allocate a proposal version: ${lastError}` },
      { status: 409 },
    );
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
