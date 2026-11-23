import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getPortalSession } from '@/lib/session';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { validateBody } from '@/lib/validation';
import { createNotificationsBatch } from '@/lib/notifications';
import { logAudit, getClientIP } from '@/lib/audit';

const signSchema = z.object({
  typedName: z.string().trim().min(4).max(160),
  consent: z.literal(true),
});

/**
 * POST /api/portal/matters/[id]/sign-engagement  { typedName, consent }
 *
 * Typed-name electronic acceptance of the matter's engagement letter.
 * Records the signature (typed name + signer email + timestamp + IP +
 * user agent) against the exact document path that was presented, and
 * notifies the matter team. Idempotent per (matter, document): a second
 * attempt returns 409.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getPortalSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: matterId } = await params;

  const validation = await validateBody(req, signSchema);
  if (!validation.success) return validation.response;
  const { typedName } = validation.data;

  // Ownership: the matter must belong to the session's client.
  const service = getServiceDbForFirm(session.firmId);
  const { data: matter } = await service
    .from('matters')
    .select('notion_id, name, team_person_ids')
    .eq('notion_id', matterId)
    .eq('client_id', session.user.clientId)
    .maybeSingle();
  if (!matter) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { data: config } = await service
    .from('matter_billing_configs')
    .select('engagement_file_path, engagement_file_name')
    .eq('matter_id', matterId)
    .maybeSingle();

  if (!config?.engagement_file_path) {
    return NextResponse.json({ error: 'No engagement letter awaiting signature' }, { status: 404 });
  }

  const { data: signature, error } = await service
    .from('engagement_signatures')
    .insert({
      matter_id: matterId,
      client_user_id: session.user.clientUserId,
      document_path: config.engagement_file_path,
      document_name: config.engagement_file_name ?? '',
      typed_name: typedName,
      signer_email: session.user.email,
      ip: getClientIP(req),
      user_agent: req.headers.get('user-agent')?.slice(0, 300) ?? null,
    })
    .select()
    .single();

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'This engagement letter has already been signed.' }, { status: 409 });
    }
    console.error('[sign-engagement] Insert failed:', error.message);
    return NextResponse.json({ error: 'Could not record the signature. Please try again.' }, { status: 500 });
  }

  logAudit({
    firmId: session.firmId,
    entityType: 'EngagementSignature',
    entityId: String(signature.id),
    action: 'signed',
    performedBy: `client:${session.user.clientUserId}`,
    ipAddress: getClientIP(req),
  });

  // Notify the matter team + partners.
  notifyTeam(session.firmId, matter, typedName).catch((err) =>
    console.error('[sign-engagement] Notification failed:', err?.message ?? err),
  );

  return NextResponse.json({ data: signature });
}

async function notifyTeam(
  firmId: string,
  matter: { notion_id: string; name: string; team_person_ids: string[] | null },
  typedName: string,
): Promise<void> {
  const service = getServiceDbForFirm(firmId);
  const recipientIds = new Set<string>(matter.team_person_ids ?? []);

  const { data: partners } = await service
    .from('team')
    .select('person_id')
    .in('role', ['partner', 'admin', 'super_user'])
    .eq('active', true);
  for (const p of partners ?? []) if (p.person_id) recipientIds.add(p.person_id);

  if (recipientIds.size === 0) return;

  await createNotificationsBatch(
    [...recipientIds].map((personId) => ({
      person_id: personId,
      type: 'engagement_signed' as const,
      title: `Engagement letter signed: ${matter.name}`,
      body: `${typedName} accepted the engagement letter through the client portal.`,
      href: `/dashboard/matters/${matter.notion_id}`,
      entity_id: matter.notion_id,
    })),
    firmId,
  );
}
