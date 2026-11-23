import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { requireRouteAccess } from '@/lib/nav/guard';
import { isFeatureAvailable } from '@/lib/firm/features';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import PortalUsersTable, { type PortalUserRow } from '@/components/admin/PortalUsersTable';

export const metadata: Metadata = { title: 'Portal Users' };

export const dynamic = 'force-dynamic';

export default async function AdminPortalUsersPage() {
  const session = await requireRouteAccess('/admin/portal-users');

  const role = session.user.role ?? 'lawyer';
  if (!(await isFeatureAvailable(session.firmId, 'portal'))) redirect('/admin');

  const supabase = getServiceDbForFirm(session.firmId);
  const { data: users } = await supabase
    .from('client_users')
    .select(`
      id,
      email,
      name,
      active,
      created_at,
      last_login_at,
      client_id,
      clients ( full_company_name, name )
    `)
    .order('created_at', { ascending: false });

  type RawRow = {
    id: string;
    email: string;
    name: string | null;
    active: boolean;
    created_at: string;
    last_login_at: string | null;
    client_id: string;
    clients: { full_company_name: string | null; name: string | null } | null;
  };

  const rows: PortalUserRow[] = ((users ?? []) as unknown as RawRow[]).map((u) => ({
    id: u.id,
    email: u.email,
    name: u.name,
    active: u.active,
    created_at: u.created_at,
    last_login_at: u.last_login_at,
    client_id: u.client_id,
    client_name: u.clients?.full_company_name || u.clients?.name || u.client_id,
  }));

  return (
    <>
      <div className="mb-8">
        <h1 className="font-serif text-2xl sm:text-3xl font-semibold tracking-tight text-foreground">
          Portal Users
        </h1>
        <p className="text-sm text-[var(--text-secondary)] mt-1">
          Everyone with access to the client portal, across all clients. Per-client management lives on each client&apos;s detail page.
        </p>
      </div>

      <PortalUsersTable initialRows={rows} />
    </>
  );
}
