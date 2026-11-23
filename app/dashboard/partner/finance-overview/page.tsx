import type { Metadata } from 'next';
import { requireRouteAccess } from '@/lib/nav/guard';
import { Wallet } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { BILLED_STATUSES } from '@/lib/finance/profitability';
import { manilaToday } from '@/lib/finance/format';
import FinanceOverview from '@/components/partner/FinanceOverview';

export const metadata: Metadata = { title: 'Finance Overview' };

export const revalidate = 30;

export default async function PartnerFinanceOverviewPage() {
  const session = await requireRouteAccess('/dashboard/partner/finance-overview');

  const supabase = getServiceDbForFirm(session.firmId);
  const { data } = await supabase
    .from('invoices')
    .select('client_name')
    .in('status', BILLED_STATUSES as unknown as string[]);
  const clients = [...new Set((data ?? []).map((r) => r.client_name as string).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
  const currentMonth = manilaToday().slice(0, 7);

  return (
    <>
      <PageHeader
        icon={<Wallet className="w-5 h-5" />}
        title="Finance Overview"
        subtitle="Collection rate vs operating expenses — filter by period and client"
      />
      <FinanceOverview clients={clients} currentMonth={currentMonth} />
    </>
  );
}
