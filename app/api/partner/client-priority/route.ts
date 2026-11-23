import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { validateBody, clientPrioritySchema } from '@/lib/validation';
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

  const validation = await validateBody(req, clientPrioritySchema);
  if (!validation.success) return validation.response;
  const { clientId, priority } = validation.data;

  const supabase = await getSupabaseServerAuthClient();
  const { error } = await supabase
    .from('clients')
    .update({ priority })
    .eq('notion_id', clientId);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  logAudit({
    firmId: session.firmId,
    entityType: 'Client',
    entityId: clientId,
    action: 'updated',
    fieldChanged: 'priority',
    newValue: String(priority),
    performedBy: session.user.notionUserId,
    ipAddress: getClientIP(req),
  });

  return NextResponse.json({ success: true });
}
