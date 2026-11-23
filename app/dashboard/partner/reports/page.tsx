import type { Metadata } from 'next';
import { requireRouteAccess } from '@/lib/nav/guard';
import { BarChart3 } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import ReportsBuilder from '@/components/admin/ReportsBuilder';

export const metadata: Metadata = { title: 'Reports' };

export default async function DashboardPartnerReportsRoute() {
  await requireRouteAccess('/dashboard/partner/reports');

  return (
    <>
      <PageHeader
        icon={<BarChart3 className="w-5 h-5" />}
        title="Reports"
        subtitle="Build custom reports across matters, deliverables, DTR, and invoices"
      />
      <div className="h-[calc(100vh-12rem)] border border-[var(--border-color)] rounded-xl overflow-hidden">
        <ReportsBuilder />
      </div>
    </>
  );
}
