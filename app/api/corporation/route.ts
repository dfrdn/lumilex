import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { rowToCorporation } from '@/lib/corporation-row';
import { findOrCreateClientByName, type ResolvedClient } from '@/lib/clients/find-or-create';
import { deriveMatterCode } from '@/lib/matters/derive-matter-code';
import { mintId } from '@/lib/ids';
import { logAudit, getClientIP } from '@/lib/audit';
import { CORPORATION_SELECT, setMatterLink, type CorporateScope } from '@/lib/corporations/matter-links';
import { isFirmFiling } from '@/lib/corporations/obligations';

/**
 * POST /api/corporation — create a corporation record.
 *
 * Bare-minimum payload: working name + scope toggles. Optionally an engaging
 * client.
 *
 * An engaging client means the firm is already engaged by someone — that client
 * owns the matters and the billing, and the corporation gets no client row of
 * its own. Only a corporation engaging us on its own behalf needs one: it
 * attaches to the client that already owns this name, or a placeholder client
 * row is created when none does. If handles_incorporation is true, an
 * Incorporation matter is also opened under the relevant client.
 *
 * Returns the created Corporation, plus `linkedExistingClient` when an existing
 * client was reused.
 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const {
    workingName,
    engagingClientId,
    handlesIncorporation,
    handlesPostIncorporation,
    handlesHousekeeping,
    firmFiles,
    isUnderRetainer,
    retainerMatterId,
    alreadyIncorporated,
    approvedName,
    companyType,
    secRegistrationNo,
    secRegistrationDate,
    authorizedCapitalStock,
    parValue,
    principalOfficeAddress,
  } = body as {
    workingName?: string;
    engagingClientId?: string | null;
    handlesIncorporation?: boolean;
    handlesPostIncorporation?: boolean;
    handlesHousekeeping?: boolean;
    firmFiles?: unknown;
    isUnderRetainer?: boolean;
    retainerMatterId?: string | null;
    alreadyIncorporated?: boolean;
    approvedName?: string | null;
    companyType?: 'Stock' | 'Non-Stock' | 'OPC' | 'Partnership' | null;
    secRegistrationNo?: string | null;
    secRegistrationDate?: string | null;
    authorizedCapitalStock?: number | null;
    parValue?: number | null;
    principalOfficeAddress?: string | null;
  };

  const name = (workingName ?? '').trim();
  if (!name) {
    return NextResponse.json({ error: 'Working name is required' }, { status: 400 });
  }

  const isExisting = !!alreadyIncorporated;
  const supabase = await getSupabaseServerAuthClient();
  // The auto-created placeholder/corp client rows are system-generated
  // (client-corp-*), not user-managed records. The clients table write
  // policy is deliberately restricted to privileged roles, so these inserts go
  // through service-role after the team-member auth check above.
  const service = getServiceDbForFirm(session.firmId);
  const userId = session.user.notionUserId;

  // Decide client_id strategy.
  // If engagingClientId provided: no client row for the corporation, now or
  //   later. The engaging client is the client.
  // Else: attach to the client that already owns this name, creating a
  //   placeholder only when none does.
  let placeholderClientId: string | null = null;
  let reusedClient: ResolvedClient | null = null;
  if (!engagingClientId) {
    let resolved: ResolvedClient;
    try {
      resolved = await findOrCreateClientByName(supabase, service, name, {
        idPrefix: 'client-corp',
        // Pre-incorporation: the company doesn't legally exist yet, so its
        // placeholder client shouldn't join the active roster.
        status: isExisting ? 'Active' : 'Prospective',
        firmId: session.firmId,
        performedBy: userId,
        ipAddress: getClientIP(req),
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : 'unknown error';
      // A concurrent create won the name between our lookup and insert. Match
      // the intake/admin routes and return an actionable 409, not a raw 500.
      if (message.includes('clients_name_unique_ci')) {
        return NextResponse.json(
          { error: `A client named "${name}" already exists. Try again to link this corporation to it.` },
          { status: 409 },
        );
      }
      return NextResponse.json({ error: `Failed to create placeholder client: ${message}` }, { status: 500 });
    }
    placeholderClientId = resolved.notionId;
    if (resolved.reused) reusedClient = resolved;
  }

  // Determine which client owns matters opened during this create.
  const matterClientId = engagingClientId ?? placeholderClientId;

  async function fetchClientName(clientId: string | null): Promise<string> {
    if (!clientId) return '';
    const { data: client } = await supabase
      .from('clients')
      .select('name')
      .eq('notion_id', clientId)
      .maybeSingle();
    return (client?.name as string) ?? '';
  }

  async function openMatter(args: { suffix: string; type: string; label: string }): Promise<string | null> {
    if (!matterClientId) return null;
    const clientName = await fetchClientName(matterClientId);
    const matterNotionId = mintId(`matter-${args.suffix}`);
    const { error: mErr } = await supabase.from('matters').insert({
      firm_id: session!.firmId,
      notion_id: matterNotionId,
      name: `${args.label} — ${name}`,
      client_id: matterClientId,
      client_name: clientName,
      matter_code: await deriveMatterCode(supabase, session!.firmId, { clientId: matterClientId, type: args.type }),
      type: args.type,
      status: 'Ongoing',
      team_person_ids: [userId],
      created_time: new Date().toISOString(),
    });
    if (mErr) {
      console.warn(`[corporation POST] matter create failed (${args.type}):`, mErr.message);
      return null;
    }
    return matterNotionId;
  }

  // Branch matter creation by lifecycle.
  let incorporationMatterId: string | null = null;
  let postIncorporationMatterId: string | null = null;
  let housekeepingMatterId: string | null = null;

  if (isExisting) {
    // Already-incorporated: skip Incorporation matter entirely. Open
    // Post-Incorp / Housekeeping matters directly so users can start logging
    // work immediately — unless a general retainer already covers the work.
    // `effectiveBillingMatterId` resolves to the retainer first, so a matter
    // opened alongside one never receives a deliverable, a DTR or an expense;
    // it just sits in the client's matter list looking like live work.
    if (handlesPostIncorporation && !isUnderRetainer) {
      postIncorporationMatterId = await openMatter({
        suffix: 'postincorp', type: 'Post-Incorporation', label: 'Post-Incorporation',
      });
    }
    if (handlesHousekeeping && !isUnderRetainer) {
      housekeepingMatterId = await openMatter({
        suffix: 'housekeeping', type: 'Corporate Housekeeping', label: 'Corporate Housekeeping',
      });
    }
  } else if (handlesIncorporation !== false) {
    incorporationMatterId = await openMatter({
      suffix: 'incorp', type: 'Incorporation', label: 'Incorporation',
    });
  }

  // No corp client when an existing client engaged us: `matterClientId` above
  // already puts the matters under that client, and minting a second row for
  // the corporation's name would fork the engagement across two clients whose
  // DTRs, invoices and billing bundles never meet.
  const corpClientId: string | null = placeholderClientId;

  const { data: corpRow, error } = await supabase
    .from('corporations')
    .insert({
      firm_id: session.firmId,
      client_id: corpClientId,
      engaging_client_id: engagingClientId ?? null,
      handles_incorporation: isExisting ? false : (handlesIncorporation !== false),
      handles_post_incorporation: !!handlesPostIncorporation,
      handles_housekeeping: !!handlesHousekeeping,
      firm_files: Array.isArray(firmFiles) ? [...new Set(firmFiles.filter(isFirmFiling))] : [],
      proposed_names: isExisting ? [] : [name],
      approved_name: isExisting ? (approvedName ?? name) : null,
      company_type: isExisting ? (companyType ?? null) : null,
      sec_registration_no: isExisting ? (secRegistrationNo ?? null) : null,
      sec_registration_date: isExisting ? (secRegistrationDate ?? null) : null,
      authorized_capital_stock: isExisting ? (authorizedCapitalStock ?? null) : null,
      par_value: isExisting ? (parValue ?? null) : null,
      principal_office_address: isExisting ? (principalOfficeAddress ?? null) : null,
      status: isExisting ? 'Registered' : 'Pre-Incorporation',
      created_by: userId,
    })
    .select('id')
    .single();

  if (error || !corpRow) {
    return NextResponse.json({ error: error?.message ?? 'Failed to create corporation' }, { status: 500 });
  }

  // The company is a subject (trg_corporations_sync_subject made its row);
  // the matters opened above, and a retainer that covers it, link to it.
  const links: [CorporateScope, string | null][] = [
    ['incorporation', incorporationMatterId],
    ['post_incorporation', postIncorporationMatterId],
    ['housekeeping', housekeepingMatterId],
    ['retainer', isUnderRetainer ? (retainerMatterId ?? null) : null],
  ];
  try {
    for (const [scope, matterId] of links) {
      if (matterId) await setMatterLink(supabase, session.firmId, corpRow.id as string, scope, matterId);
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Linking matters failed' }, { status: 500 });
  }

  const { data: linked } = await supabase.from('corporations').select(CORPORATION_SELECT).eq('id', corpRow.id).single();
  const corporation = rowToCorporation(linked as Record<string, unknown>);

  // For already-incorporated entries, the SEC-approval auto-chain in the PATCH
  // route won't fire (it's gated on sec_registration_date transitioning from
  // null). Spawn here so the filings the firm files and the outstanding
  // business-permit task start tracking immediately.
  if (isExisting) {
    try {
      const { spawnComplianceDeliverables } = await import('@/lib/corporation-deadlines');
      await spawnComplianceDeliverables(corporation, supabase, session.firmId, userId);
      const { spawnBusinessPermitTask } = await import('@/lib/corporations/permit-task');
      await spawnBusinessPermitTask(corporation, supabase, session.firmId, userId);
    } catch (e) {
      console.error('[corporation POST] spawn deliverables failed', e);
    }
  }

  logAudit({
    firmId: session.firmId,
    entityType: 'Corporation',
    entityId: corporation.id,
    entityName: name,
    action: 'created',
    performedBy: userId,
    ipAddress: getClientIP(req),
  });

  return NextResponse.json({
    ok: true,
    corporation,
    // Set when the corporation was attached to a client that already existed
    // under this name, so the UI can say which one instead of leaving the user
    // to wonder why no new client appeared.
    linkedExistingClient: reusedClient
      ? { id: reusedClient.notionId, name: reusedClient.name, clientCode: reusedClient.clientCode }
      : null,
  });
}

/**
 * GET /api/corporation — list all corporations (lightweight).
 */
export async function GET() {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const supabase = await getSupabaseServerAuthClient();
  const { data } = await supabase
    .from('corporations')
    .select('id, approved_name, proposed_names, status, sec_registration_no, sec_registration_date, client_id, created_at')
    .order('created_at', { ascending: false });
  return NextResponse.json({ corporations: data ?? [] });
}
