import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { isManagingPartner } from '@/lib/auth/isManagingPartner';
import { DELIVERABLE_STATUS } from '@/lib/deliverable-status';

/** Sidebar badge counts: what is waiting on the caller, keyed by nav href. */
export type NavCounts = Partial<Record<string, number>>;

const ADMIN_FINALIZE_ROLES = ['admin', 'finance', 'super_user'];

// GET /api/me/nav-counts?area=dashboard|admin|finance|liaison
//
// Every count is scoped to the caller's firm and to the caller (relationship
// partner, Managing Partner) or gated by the same role as the page it badges,
// so the firm-scoped service reads never hand anyone a number they couldn't
// see by opening that page. Finance has no queue badges.
export async function GET(req: Request) {
  const session = await getSession();
  const personId = session?.user?.notionUserId;
  if (!personId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const role = session.user.role ?? 'lawyer';
  const firmId = session.firmId;
  const db = getServiceDbForFirm(firmId);

  const area = new URL(req.url).searchParams.get('area') ?? 'dashboard';
  if (area === 'admin') {
    // The deliverables waiting on the admin's finalize page.
    const finalize = ADMIN_FINALIZE_ROLES.includes(role)
      ? await db
          .from('deliverables')
          .select('notion_id', { count: 'exact', head: true })
          .eq('status', DELIVERABLE_STATUS.PRE_FINALIZED)
          .then((r) => r.count ?? 0)
      : 0;
    return NextResponse.json({ counts: { '/admin/finalize': finalize } satisfies NavCounts });
  }
  if (area !== 'dashboard') return NextResponse.json({ counts: {} });

  const isPartner = role === 'partner' || role === 'super_user';
  if (!isPartner) return NextResponse.json({ counts: {} });

  const leaves = db
    .from('leaves')
    .select('notion_id', { count: 'exact', head: true })
    .or('status.ilike.pending,status.eq.,status.is.null')
    .then((r) => r.count ?? 0);

  const feedbacks = db
    .from('feedbacks')
    .select('notion_id', { count: 'exact', head: true })
    .or('response.is.null,response.eq.')
    .is('dismissed_at', null)
    .then((r) => r.count ?? 0);

  const [lv, fb, bill] = await Promise.all([leaves, feedbacks, billingReviewCount(firmId, personId)]);
  const counts: NavCounts = {
    '/dashboard/partner/leaves': lv,
    '/dashboard/partner/feedbacks': fb,
    '/dashboard/partner/billing-review': bill,
  };
  return NextResponse.json({ counts });
}

/**
 * Bundles the caller can act on in Billing Review, across every month: the
 * Managing Partner approves submitted pending bundles; a relationship partner
 * clears approved ones for their own clients.
 */
async function billingReviewCount(firmId: string, personId: string): Promise<number> {
  const db = getServiceDbForFirm(firmId);
  const [mp, { data: myClients }] = await Promise.all([
    isManagingPartner(personId, firmId),
    db.from('clients').select('name').eq('relationship_partner_id', personId),
  ]);

  const approve = mp
    ? db
        .from('dtr_revision_reviews')
        .select('client_name', { count: 'exact', head: true })
        .eq('status', 'pending')
        .not('submitted_at', 'is', null)
        .then((r) => r.count ?? 0)
    : Promise.resolve(0);

  const names = (myClients ?? []).map((c) => c.name as string).filter(Boolean);
  const clear = names.length
    ? db
        .from('dtr_revision_reviews')
        .select('client_name', { count: 'exact', head: true })
        .eq('status', 'approved')
        .or('clearance_status.is.null,clearance_status.neq.cleared')
        .not('submitted_at', 'is', null)
        .in('client_name', names)
        .then((r) => r.count ?? 0)
    : Promise.resolve(0);

  const [a, c] = await Promise.all([approve, clear]);
  return a + c;
}
