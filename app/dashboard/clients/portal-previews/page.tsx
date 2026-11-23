import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Eye } from 'lucide-react';
import { requireRouteAccess } from '@/lib/nav/guard';
import { isFeatureAvailable } from '@/lib/firm/features';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { getAllClients } from '@/lib/queries/listing';
import PageHeader from '@/components/ui/PageHeader';
import PortalPreviewDirectory, { type PreviewClientRow } from '@/components/PortalPreviewDirectory';

export const metadata: Metadata = { title: 'Portal Previews' };

export const dynamic = 'force-dynamic';

export default async function PortalPreviewsPage() {
  const session = await requireRouteAccess('/dashboard/clients/portal-previews');

  if (!(await isFeatureAvailable(session.firmId, 'portal'))) redirect('/dashboard/clients');

  const [clients, { data: portalUsers }] = await Promise.all([
    getAllClients(session.firmId),
    getServiceDbForFirm(session.firmId).from('client_users').select('client_id').eq('active', true),
  ]);

  const countByClient = new Map<string, number>();
  for (const u of portalUsers ?? []) {
    countByClient.set(u.client_id, (countByClient.get(u.client_id) ?? 0) + 1);
  }

  const rows: PreviewClientRow[] = clients.map((c) => ({
    id: c.id,
    name: c.name || c.fullCompanyName || '(Untitled)',
    fullCompanyName: c.fullCompanyName && c.fullCompanyName !== c.name ? c.fullCompanyName : '',
    clientCode: c.clientCode ? String(c.clientCode) : '',
    portalUserCount: countByClient.get(c.id) ?? 0,
    status: c.status || '',
  }));

  return (
    <>
      <PageHeader
        icon={<Eye className="w-5 h-5" />}
        title="Client Portal Previews"
        subtitle="Open any client's portal exactly as they see it — read-only. Opens in a new tab."
      />
      <PortalPreviewDirectory rows={rows} />
    </>
  );
}
