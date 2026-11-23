import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { validateBody } from '@/lib/validation';
import { checkConflicts } from '@/lib/conflicts/check';
import { sanitizeCommentHtml } from '@/lib/sanitize-comment';
import { cascadeClientRename } from '@/lib/clients/cascade-rename';
import { clientRenameWarning, CLIENT_RENAME_CONFIRM } from '@/lib/clients/rename-guard';
import { allocateClientCode } from '@/lib/clients/allocate-client-code';
import { findClientByName, nameTakenMessage } from '@/lib/clients/find-or-create';
import { logAudit, getClientIP } from '@/lib/audit';

/** Roles that own the prospects pipeline — the same set the pages gate on. */
const PIPELINE_ROLES = new Set(['partner', 'admin', 'super_user']);

async function assertAuth() {
  const session = await getSession();
  if (!session?.user) return null;
  return session;
}

type AuthedClient = Awaited<ReturnType<typeof getSupabaseServerAuthClient>>;

/**
 * person_id → display name for the assigned partner and the person who added
 * the prospect. Both columns store a bare `team.person_id`, so the board would
 * otherwise render raw uuids.
 */
async function resolvePersonNames(
  supabase: AuthedClient,
  ids: (string | null | undefined)[],
): Promise<Record<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => !!id))];
  if (unique.length === 0) return {};
  const { data } = await supabase.from('team').select('person_id, name').in('person_id', unique);
  return Object.fromEntries((data ?? []).map((row) => [row.person_id, row.name ?? '']));
}

/**
 * GET /api/intakes
 * List intakes with optional filters.
 * Query params: stage, clientId, assignedLawyerId, page, pageSize
 */
export async function GET(req: NextRequest) {
  const session = await assertAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const params = req.nextUrl.searchParams;
  const singleId = params.get('id');

  const supabase = await getSupabaseServerAuthClient();

  // Single intake by id
  if (singleId) {
    const { data, error } = await supabase
      .from('client_intakes')
      .select('*, clients!inner(name, status, full_company_name, contact_email, phone_number, tin)')
      .eq('id', singleId)
      .single();

    if (error || !data) {
      return NextResponse.json({ error: error?.message ?? 'Not found' }, { status: 404 });
    }

    const client = data.clients as unknown as {
      name: string; status: string; full_company_name: string;
      contact_email: string; phone_number: string; tin: string;
    };

    // Fetch stage history
    const { data: history } = await supabase
      .from('intake_stage_history')
      .select('*')
      .eq('intake_id', singleId)
      .order('created_at', { ascending: true });

    const names = await resolvePersonNames(supabase, [data.assigned_lawyer_id, data.created_by]);

    return NextResponse.json({
      intake: {
        ...data,
        clients: undefined,
        client_name: client.name,
        client_status: client.status,
        client_full_name: client.full_company_name,
        client_email: client.contact_email,
        client_phone: client.phone_number,
        client_tin: client.tin,
        assigned_lawyer_name: data.assigned_lawyer_id ? names[data.assigned_lawyer_id] : undefined,
        created_by_name: data.created_by ? names[data.created_by] : undefined,
      },
      history: history ?? [],
    });
  }

  const stage = params.get('stage');
  const clientId = params.get('clientId');
  const assignedLawyerId = params.get('assignedLawyerId');
  const page = Math.max(1, parseInt(params.get('page') || '1'));
  const pageSize = Math.min(200, Math.max(1, parseInt(params.get('pageSize') || '100')));
  const offset = (page - 1) * pageSize;

  let query = supabase
    .from('client_intakes')
    .select('*, clients!inner(name, status, full_company_name, contact_email, phone_number, tin)', { count: 'exact' });

  if (stage) query = query.eq('stage', stage);
  if (clientId) query = query.eq('client_id', clientId);
  if (assignedLawyerId) query = query.eq('assigned_lawyer_id', assignedLawyerId);

  query = query.order('created_at', { ascending: false }).range(offset, offset + pageSize - 1);

  const { data, error, count } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const names = await resolvePersonNames(
    supabase,
    (data ?? []).flatMap((row) => [row.assigned_lawyer_id, row.created_by]),
  );

  // Flatten client info
  const intakes = (data ?? []).map((row) => {
    const client = row.clients as unknown as {
      name: string; status: string; full_company_name: string;
      contact_email: string; phone_number: string; tin: string;
    };
    return {
      ...row,
      clients: undefined,
      client_name: client.name,
      client_status: client.status,
      client_full_name: client.full_company_name,
      client_email: client.contact_email,
      client_phone: client.phone_number,
      client_tin: client.tin,
      assigned_lawyer_name: row.assigned_lawyer_id ? names[row.assigned_lawyer_id] : undefined,
      created_by_name: row.created_by ? names[row.created_by] : undefined,
    };
  });

  return NextResponse.json({ intakes, total: count ?? 0 });
}

const newProspectSchema = z.object({
  name: z.string().trim().min(1, 'Client name is required').max(200),
  fullCompanyName: z.string().trim().max(250).default(''),
  email: z
    .string()
    .trim()
    .email('Enter a valid email address, or leave it blank')
    .max(200)
    .or(z.literal(''))
    .default(''),
  phone: z.string().trim().max(60).default(''),
  tin: z.string().trim().max(60).default(''),
  pointPersons: z.string().trim().max(250).default(''),
  // Mirrors the client_intakes_source_check constraint — an unlisted value is a
  // 400 here rather than a 23514 surfacing as a 500.
  source: z.enum(['referral', 'website', 'walk-in', 'event', 'other']).default('referral'),
  referralSource: z.string().trim().max(250).default(''),
  assignedLawyerId: z.string().trim().max(100).optional(),
});

/**
 * POST /api/intakes
 * Mint a prospect: the client row plus its Lead intake, with a conflict check
 * stored on the card. Body: see newProspectSchema.
 *
 * Both inserts run under the caller's JWT, so RLS is the gate on each
 * (`clients_team_write`, `client_intakes_assigned_or_admin_write`). The role
 * check below is what keeps the pair atomic: a caller who can write `clients`
 * but not `client_intakes` — finance — would otherwise land a client row with
 * no prospect attached to it.
 */
export async function POST(req: Request) {
  const session = await assertAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!PIPELINE_ROLES.has(session.user.role ?? '')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const validation = await validateBody(req, newProspectSchema);
  if (!validation.success) return validation.response;
  const body = validation.data;

  const supabase = await getSupabaseServerAuthClient();

  // Reject a name collision before minting a code. allocate_client_code() is
  // monotonic — it never reissues — so a code allocated for an insert that then
  // fails is a permanent gap in the sequence. The 23505 handler below still has
  // to stand: this read only narrows the window, it doesn't close it.
  const existing = await findClientByName(supabase, body.name);
  if (existing) {
    return NextResponse.json({ error: nameTakenMessage(body.name) }, { status: 409 });
  }

  const clientId = randomUUID();
  const clientCode = await allocateClientCode(supabase, session.firmId);

  const { error: clientError } = await supabase.from('clients').insert({
    firm_id: session.firmId,
    notion_id: clientId,
    name: body.name,
    client_code: clientCode,
    full_company_name: body.fullCompanyName,
    contact_email: body.email,
    phone_number: body.phone,
    tin: body.tin,
    point_persons: body.pointPersons,
    // A client with no matters yet. recalc_client_status only fires from
    // `matters`, so nothing backfills this — and the column defaults to ''.
    status: 'Prospective',
    created_time: new Date().toISOString(),
  });

  if (clientError) {
    if (clientError.code === '23505' && clientError.message.includes('clients_name_unique_ci')) {
      return NextResponse.json({ error: nameTakenMessage(body.name) }, { status: 409 });
    }
    // A client_code collision can't come from the allocator — it floors itself
    // at max(client_code) — so it means a row landed by some path that bypassed
    // it. Name it rather than letting it read as a generic insert failure.
    if (clientError.code === '23505' && clientError.message.includes('clients_client_code_unique')) {
      console.error(
        `[intakes] client_code ${clientCode} is already taken — a client was ` +
        'inserted without going through allocate_client_code().',
      );
      return NextResponse.json(
        { error: `Client code ${clientCode} is already in use. Retry; if it persists, a client was created outside the code allocator.` },
        { status: 409 },
      );
    }
    console.error('[intakes] Client insert failed:', clientError.message);
    return NextResponse.json({ error: 'Failed to create client record' }, { status: 500 });
  }

  logAudit({
    firmId: session.firmId,
    entityType: 'clients',
    entityId: clientId,
    entityName: body.name,
    action: 'create',
    performedBy: session.user.notionUserId,
    ipAddress: getClientIP(req),
  });

  // Exclude the client we just created from `clients`-table matches so the
  // intake doesn't flag itself as a duplicate of its own row.
  const names = [body.name];
  if (body.fullCompanyName) names.push(body.fullCompanyName);
  const conflictResult = await checkConflicts({
    names,
    tin: body.tin || undefined,
    excludeClientName: body.name,
  }, session.firmId);

  const { data, error } = await supabase
    .from('client_intakes')
    .insert({
      firm_id: session.firmId,
      client_id: clientId,
      stage: 'Lead',
      source: body.source,
      referral_source: body.referralSource,
      assigned_lawyer_id: body.assignedLawyerId || null,
      conflict_check_result: conflictResult,
      created_by: session.user.notionUserId ?? null,
    })
    .select()
    .single();

  if (error) {
    console.error('[intakes] Intake insert failed:', error.message);
    return NextResponse.json(
      { error: 'Client created but the prospect card failed — check the prospects board' },
      { status: 500 },
    );
  }

  return NextResponse.json({ intake: data, conflicts: conflictResult });
}

/**
 * PATCH /api/intakes
 * Update intake fields. Handles stage transitions with history logging.
 * Body: { id, updates: { stage?, consultation_notes?, ... } }
 */
export async function PATCH(req: Request) {
  const session = await assertAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id, updates, confirmRename } = await req.json();
  if (!id || !updates) {
    return NextResponse.json({ error: 'id and updates are required' }, { status: 400 });
  }

  const supabase = await getSupabaseServerAuthClient();

  // If stage is changing, log the transition
  if (updates.stage) {
    const { data: current } = await supabase
      .from('client_intakes')
      .select('stage, client_id')
      .eq('id', id)
      .single();

    if (current && current.stage !== updates.stage) {
      // Log stage history. Client status is no longer set here — it's derived
      // from the client's matters by a DB trigger (Prospective until a matter
      // exists, then Active/Inactive). The intake stage lives in client_intakes.
      await supabase.from('intake_stage_history').insert({
        firm_id: session.firmId,
        intake_id: id,
        old_stage: current.stage,
        new_stage: updates.stage,
        changed_by: session.user.notionUserId || session.user.name || 'unknown',
        notes: updates.stage_change_notes || null,
      });
    }
  }

  // Split out client_* shortcuts that target the linked clients row, so the
  // detail view can edit client name/email/phone/etc. without a second API.
  const CLIENT_FIELD_MAP: Record<string, string> = {
    client_name: 'name',
    client_full_name: 'full_company_name',
    client_email: 'contact_email',
    client_phone: 'phone_number',
    client_tin: 'tin',
  };
  // created_by is attribution, set once at creation — never patchable.
  const { stage_change_notes, created_by, ...rest } = updates;
  const clientUpdates: Record<string, unknown> = {};
  const intakeUpdates: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(rest)) {
    if (key in CLIENT_FIELD_MAP) {
      clientUpdates[CLIENT_FIELD_MAP[key]] = typeof val === 'string' ? val.trim() : val;
    } else {
      intakeUpdates[key] = val;
    }
  }

  // consultation_notes is rich text from the TipTap editor. The editor's schema
  // constrains the happy path, but this endpoint takes a raw string — run the
  // same allow-list pass the comment endpoints use.
  if (typeof intakeUpdates.consultation_notes === 'string') {
    intakeUpdates.consultation_notes = sanitizeCommentHtml(intakeUpdates.consultation_notes);
  }

  if (Object.keys(clientUpdates).length > 0) {
    const { data: intakeRow } = await supabase
      .from('client_intakes')
      .select('client_id')
      .eq('id', id)
      .single();
    if (intakeRow?.client_id) {
      // A rename has to reach every table that denormalizes client_name, so read
      // the current name before overwriting it.
      let previousClientName: string | null = null;
      if ('name' in clientUpdates) {
        const { data: priorClient } = await supabase
          .from('clients')
          .select('name')
          .eq('notion_id', intakeRow.client_id)
          .maybeSingle();
        previousClientName = priorClient?.name ?? null;

        if (!confirmRename && typeof clientUpdates.name === 'string') {
          const warning = await clientRenameWarning(getServiceDbForFirm(session.firmId), {
            clientId: String(intakeRow.client_id),
            from: previousClientName,
            to: clientUpdates.name,
          });
          if (warning) return NextResponse.json({ error: warning, code: CLIENT_RENAME_CONFIRM }, { status: 409 });
        }
      }

      const { error: clientErr } = await supabase
        .from('clients')
        .update(clientUpdates)
        .eq('notion_id', intakeRow.client_id);
      if (clientErr) {
        return NextResponse.json({ error: clientErr.message }, { status: 500 });
      }

      // Cascade the rename to matters, DTRs, invoices, the finance Review
      // bundles, the deposit ledger, etc. On the service-role client so RLS
      // can't silently drop a finance-table update. Fire-and-forget, same as
      // the admin rename path.
      const newClientName = clientUpdates.name;
      if (previousClientName && typeof newClientName === 'string' && newClientName !== previousClientName) {
        cascadeClientRename(getServiceDbForFirm(session.firmId), {
          clientId: String(intakeRow.client_id),
          oldName: previousClientName,
          newName: newClientName,
        }).catch((err) => console.error('[intakes] Client name cascade failed:', err.message));
        logAudit({
          firmId: session.firmId,
          entityType: 'clients',
          entityId: String(intakeRow.client_id),
          entityName: newClientName,
          action: 'update',
          fieldChanged: 'name',
          oldValue: previousClientName,
          newValue: newClientName,
          performedBy: session.user.notionUserId,
          ipAddress: getClientIP(req),
        });
      }
    }
  }

  intakeUpdates.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from('client_intakes')
    .update(intakeUpdates)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ intake: data });
}

/**
 * DELETE /api/intakes
 * Delete an intake record. Body: { id }
 */
export async function DELETE(req: Request) {
  const session = await assertAuth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!PIPELINE_ROLES.has(session.user?.role ?? '')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id } = await req.json();
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

  const supabase = await getSupabaseServerAuthClient();
  const { error } = await supabase.from('client_intakes').delete().eq('id', id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
