import type { Metadata } from 'next';
import { requireRouteAccess } from '@/lib/nav/guard';
import AuditLogTable from '@/components/admin/AuditLogTable';

export const metadata: Metadata = { title: 'Audit Log' };

export default async function AuditLogPage() {
  await requireRouteAccess('/admin/audit-log');

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-foreground">Audit Log</h1>
        <p className="text-sm text-[var(--text-muted)] mt-0.5">Track all changes and user actions across the system</p>
      </div>
      <AuditLogTable />
    </div>
  );
}
