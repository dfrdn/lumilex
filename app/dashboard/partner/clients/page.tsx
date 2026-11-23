import type { Metadata } from 'next';
import { requireRouteAccess } from '@/lib/nav/guard';
import { Users2 } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import { getClientManagementRows } from '@/lib/queries/client-management';
import { getPartnerPickerData } from '@/lib/queries/people';
import ClientManagementTable from './ClientManagementTable';

export const metadata: Metadata = { title: 'Client Management' };

export const revalidate = 30;

export default async function PartnerClientsPage() {
  const session = await requireRouteAccess('/dashboard/partner/clients');

  const [rows, partnerData] = await Promise.all([
    getClientManagementRows(session.firmId),
    getPartnerPickerData(session.firmId),
  ]);

  return (
    <>
      <PageHeader
        icon={<Users2 className="w-5 h-5" />}
        title="Client Management"
        subtitle="Profitability, matters, and priority — ranked by cash collected in the last 12 months"
      />
      <ClientManagementTable data={rows} partnerOptions={partnerData.options} partnerNameById={partnerData.nameById} />
    </>
  );
}
