import { NextResponse } from 'next/server';
import { getPortalSession, type PortalSession } from '@/lib/session';

export type PortalGuardResult =
  | { ok: true; session: PortalSession }
  | { ok: false; response: NextResponse };

/**
 * The gate for /api/portal/* handlers. Returns the portal session or a
 * pre-built 401 response. A client's JWT reads no firm table directly, so
 * handlers read with `getServiceDbForFirm(session.firmId)` and scope every
 * query to `session.user.clientId` themselves.
 *
 *   const guard = await requirePortalSession();
 *   if (!guard.ok) return guard.response;
 *   const { session } = guard;
 */
export async function requirePortalSession(): Promise<PortalGuardResult> {
  const session = await getPortalSession();
  if (!session?.user?.clientUserId) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    };
  }
  return { ok: true, session };
}
