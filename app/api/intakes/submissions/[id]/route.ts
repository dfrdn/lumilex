import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { validateBody } from '@/lib/validation';
import { checkConflicts } from '@/lib/conflicts/check';
import { allocateClientCode } from '@/lib/clients/allocate-client-code';
import { findClientByName, nameTakenMessage } from '@/lib/clients/find-or-create';
import { logAudit, getClientIP } from '@/lib/audit';

const actionSchema = z.object({
  action: z.enum(['convert', 'dismiss', 'in_review']),
});

function canReview(role: string | undefined): boolean {
  // Same roles as the prospects pipeline.
  return ['partner', 'admin', 'super_user'].includes(role ?? '');
}

/**
 * PATCH /api/intakes/submissions/[id]  { action }
 *
 * dismiss / in_review — status updates on the quarantined submission.
 * convert — creates the real client row + a Lead intake in the existing
 * pipeline (conflict check runs here, staff-triggered) and marks the
 * submission converted.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canReview(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id } = await params;
  const submissionId = Number(id);
  if (!Number.isInteger(submissionId) || submissionId <= 0) {
    return NextResponse.json({ error: 'Invalid submission id' }, { status: 400 });
  }

  const validation = await validateBody(req, actionSchema);
  if (!validation.success) return validation.response;
  const { action } = validation.data;

  const supabase = await getSupabaseServerAuthClient();

  const { data: submission } = await supabase
    .from('intake_submissions')
    .select('*')
    .eq('id', submissionId)
    .maybeSingle();

  if (!submission) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (submission.status === 'converted' || submission.status === 'dismissed') {
    return NextResponse.json({ error: `Submission already ${submission.status}` }, { status: 409 });
  }

  const reviewedBy = session.user.notionUserId ?? session.user.email ?? 'unknown';
  const reviewedAt = new Date().toISOString();

  if (action === 'dismiss' || action === 'in_review') {
    const { data: updated, error } = await supabase
      .from('intake_submissions')
      .update({
        status: action === 'dismiss' ? 'dismissed' : 'in_review',
        reviewed_by: reviewedBy,
        reviewed_at: reviewedAt,
      })
      .eq('id', submissionId)
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    logAudit({
      firmId: session.firmId,
      entityType: 'IntakeSubmission',
      entityId: String(submissionId),
      action: action === 'dismiss' ? 'dismissed' : 'marked_in_review',
      performedBy: reviewedBy,
      ipAddress: getClientIP(req),
    });

    return NextResponse.json({ data: updated });
  }

  // ── convert ───────────────────────────────────────────────────────
  const clientId = randomUUID();
  const clientName = (submission.company || submission.full_name).trim();

  // Reject a name collision before minting a code. allocate_client_code() is
  // monotonic — it never reissues — so a code allocated for an insert that then
  // fails is a permanent gap in the sequence, and hitting an existing client is
  // an expected outcome here, not an edge case. The 23505 handler below still
  // has to stand: this read only narrows the window, it doesn't close it.
  const existing = await findClientByName(supabase, clientName);
  if (existing) {
    return NextResponse.json({ error: nameTakenMessage(clientName) }, { status: 409 });
  }

  // clients.client_code is NOT NULL DEFAULT 0, so omitting it doesn't leave a
  // blank — it mints a client coded 0, whose matter codes read `0-{type}-{seq}`,
  // the same shape deriveMatterCode() emits when it can't resolve a client. And
  // since 20260730 added clients_client_code_unique, only one row can hold 0:
  // the second conversion would 23505 and never get a code at all.
  const clientCode = await allocateClientCode(supabase, session.firmId);

  const { error: clientError } = await supabase.from('clients').insert({
    firm_id: session.firmId,
    notion_id: clientId,
    name: clientName,
    client_code: clientCode,
    full_company_name: submission.company || '',
    contact_email: submission.email,
    phone_number: submission.phone || '',
  });

  if (clientError) {
    // A client already answers to this name. Converting anyway would fork a
    // second row that shares the name, and every table that denormalizes
    // client_name would stop being able to tell the two apart. Whether this
    // submission is that client or a genuinely different company is a judgment
    // call, so hand it back rather than guessing.
    if (clientError.code === '23505' && clientError.message.includes('clients_name_unique_ci')) {
      return NextResponse.json({ error: nameTakenMessage(clientName) }, { status: 409 });
    }
    // A client_code collision can't come from the allocator — it floors itself
    // at max(client_code) — so it means a row landed by some path that bypassed
    // it. Name it rather than letting it read as a generic insert failure, which
    // is how this one hid before: the cause was only ever in the Vercel log.
    if (clientError.code === '23505' && clientError.message.includes('clients_client_code_unique')) {
      console.error(
        `[intake-submissions] client_code ${clientCode} is already taken — a client was ` +
        'inserted without going through allocate_client_code().',
      );
      return NextResponse.json(
        { error: `Client code ${clientCode} is already in use. Retry; if it persists, a client was created outside the code allocator.` },
        { status: 409 },
      );
    }
    console.error('[intake-submissions] Client insert failed:', clientError.message);
    return NextResponse.json({ error: 'Failed to create client record' }, { status: 500 });
  }

  // The conversion is audited below, but that entry is keyed to the
  // submission; without one of its own the client has no create record. The
  // New Prospect route logs the same pair.
  logAudit({
    firmId: session.firmId,
    entityType: 'clients',
    entityId: clientId,
    entityName: clientName,
    action: 'create',
    performedBy: reviewedBy,
    ipAddress: getClientIP(req),
  });

  // Staff-triggered conflict check at conversion (same behavior as the
  // existing New Prospect flow). The public form never runs this.
  const names = [submission.full_name];
  if (submission.company) names.push(submission.company);
  const details = (submission.details ?? {}) as { markNames?: string[]; proposedNames?: string[] };
  for (const extra of [...(details.markNames ?? []), ...(details.proposedNames ?? [])]) {
    if (extra) names.push(extra);
  }
  const conflictResult = await checkConflicts({ names, excludeClientName: clientName }, session.firmId);

  const { data: intake, error: intakeError } = await supabase
    .from('client_intakes')
    .insert({
      firm_id: session.firmId,
      client_id: clientId,
      stage: 'Lead',
      source: 'website',
      referral_source: `Public intake INQ-${submissionId} (${submission.kind})`,
      conflict_check_result: conflictResult,
      // The staff member who converted the submission is the prospect's author.
      // Strictly a person_id (unlike reviewed_by, which tolerates a fallback)
      // so the board can resolve it to a name.
      created_by: session.user.notionUserId ?? null,
    })
    .select()
    .single();

  if (intakeError) {
    console.error('[intake-submissions] Intake insert failed:', intakeError.message);
    return NextResponse.json({ error: 'Client created but intake failed — check the prospects board' }, { status: 500 });
  }

  const { data: updated, error: updateError } = await supabase
    .from('intake_submissions')
    .update({
      status: 'converted',
      converted_client_id: clientId,
      reviewed_by: reviewedBy,
      reviewed_at: reviewedAt,
    })
    .eq('id', submissionId)
    .select()
    .single();

  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

  logAudit({
    firmId: session.firmId,
    entityType: 'IntakeSubmission',
    entityId: String(submissionId),
    action: 'converted',
    performedBy: reviewedBy,
    ipAddress: getClientIP(req),
  });

  return NextResponse.json({ data: updated, intakeId: intake.id, clientId, conflicts: conflictResult });
}
