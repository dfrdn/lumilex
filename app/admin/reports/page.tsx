import type { Metadata } from 'next';
import { requireRouteAccess } from '@/lib/nav/guard';
import ReportsBuilder from '@/components/admin/ReportsBuilder';

export const metadata: Metadata = { title: 'Reports' };

export default async function AdminReportsPage() {
  await requireRouteAccess('/admin/reports');

  return (
    <div className="h-[calc(100vh-3.5rem)] flex flex-col">
      <header className="px-6 py-4 border-b border-zinc-200 dark:border-zinc-800">
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Reports</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-0.5">
          Build custom reports across matters, deliverables, DTR, and invoices. Save reports for reuse or export to XLSX.
        </p>
      </header>
      <div className="flex-1 overflow-auto">
        <ReportsBuilder />
      </div>
    </div>
  );
}
