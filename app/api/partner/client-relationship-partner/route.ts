import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { validateBody, clientRelationshipPartnerSchema } from '@/lib/validation';
import { PARTNER_ROLES } from '@/lib/queries/people';
import { logAudit, getClientIP } from '@/lib/audit';

const ALLOWED_ROLES = ['partner', 'super_user'];

export async function PATCH(req: Request) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!ALLOWED_ROLES.includes(session.user.role ?? '')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const validation = await validateBody(req, clientRelationshipPartnerSchema);
  if (!validation.success) return validation.response;
  const { clientId, relationshipPartnerId } = validation.data;

  // This column is an authorization key, not just a label: `canClearBundle`
  // reads it to decide who may sign off on the client's bill. The picker only
  // offers active partners, so enforce the same rule here rather than trusting
  // the submitted id.
  if (relationshipPartnerId !== null) {
    const { data: member } = await getServiceDbForFirm(session.firmId)
      .from('team')
      .select('role, active')
      .eq('person_id', relationshipPartnerId)
      .maybeSingle();
    if (!member?.active || !(PARTNER_ROLES as readonly string[]).includes(member.role ?? '')) {
      return NextResponse.json(
        { error: 'The relationship partner must be an active partner.' },
        { status: 400 },
      );
    }
  }

  const supabase = await getSupabaseServerAuthClient();
  const { error } = await supabase
    .from('clients')
    .update({ relationship_partner_id: relationshipPartnerId })
    .eq('notion_id', clientId);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  logAudit({
    firmId: session.firmId,
    entityType: 'Client',
    entityId: clientId,
    action: 'updated',
    fieldChanged: 'relationship_partner',
    newValue: relationshipPartnerId ?? '(none)',
    performedBy: session.user.notionUserId,
    ipAddress: getClientIP(req),
  });

  return NextResponse.json({ success: true });
}
