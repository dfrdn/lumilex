import type { Metadata } from 'next';
import { requireRouteAccess } from '@/lib/nav/guard';
import SlaRulesEditor from '@/components/admin/SlaRulesEditor';

export const metadata: Metadata = { title: 'SLA Rules' };

export default async function AdminSlaRulesPage() {
  await requireRouteAccess('/admin/sla-rules');

  return (
    <div className="h-[calc(100vh-3.5rem)] flex flex-col">
      <header className="px-6 py-4 border-b border-zinc-200 dark:border-zinc-800">
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">SLA Rules</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-0.5">
          Rules that flag overdue, idle, or near-deadline deliverables. Notify partners and/or reroute ownership. Checked once a day, at 7:00 AM Manila time.
        </p>
      </header>
      <div className="flex-1 overflow-auto p-6">
        <SlaRulesEditor />
      </div>
    </div>
  );
}
