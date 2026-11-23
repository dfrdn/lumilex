import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { requireRouteAccess } from '@/lib/nav/guard';
import { isFeatureAvailable } from '@/lib/firm/features';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import ClientUsersSection from '@/components/ClientUsersSection';

export const metadata: Metadata = { title: 'Client Users' };

export default async function ClientUsersPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireRouteAccess(`/dashboard/clients/${id}/users`);
  if (!(await isFeatureAvailable(session.firmId, 'portal'))) {
    redirect(`/dashboard/clients/${id}`);
  }

  const supabase = getServiceDbForFirm(session.firmId);
  const { data: client } = await supabase
    .from('clients')
    .select('full_company_name, name')
    .eq('notion_id', id)
    .single();

  if (!client) redirect('/dashboard/clients');

  const { data: users } = await supabase
    .from('client_users')
    .select('id, email, name, active, created_at, last_login_at')
    .eq('client_id', id)
    .order('created_at', { ascending: false });

  return (
    <ClientUsersSection
      clientId={id}
      clientName={client.full_company_name || client.name}
      initialUsers={users ?? []}
    />
  );
}
