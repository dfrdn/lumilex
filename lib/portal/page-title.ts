import 'server-only';
import { getPortalSession } from '@/lib/session';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { portalScope } from './companies';

/**
 * Browser-tab title for a portal matter page. `entityTitle` reads with the
 * caller's JWT, which reads nothing in the portal, so this reads with the
 * firm-scoped service client and names only the signed-in client's own
 * matter — anything else gets the fallback.
 */
export async function portalMatterTitle(id: string): Promise<string> {
  const session = await getPortalSession();
  if (!session) return 'Matter';
  const { data } = await getServiceDbForFirm(session.firmId)
    .from('matters')
    .select('name')
    .eq('notion_id', id)
    .eq('client_id', session.user.clientId)
    .maybeSingle();
  return (data?.name as string | null)?.trim() || 'Matter';
}

/**
 * Browser-tab title for a portal company or mark page: its name only when the
 * signed-in client may see it (`portalScope`), the fallback otherwise.
 */
export async function portalSubjectTitle(id: string, fallback: string): Promise<string> {
  const session = await getPortalSession();
  if (!session) return fallback;
  const db = getServiceDbForFirm(session.firmId);
  const { companyIds, markIds } = await portalScope(db, session.user.clientId);
  if (!companyIds.includes(id) && !markIds.includes(id)) return fallback;
  const { data } = await db.from('subject_status').select('name').eq('subject_id', id).maybeSingle();
  return (data?.name as string | null)?.trim() || fallback;
}
