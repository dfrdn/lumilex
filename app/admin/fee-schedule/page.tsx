import type { Metadata } from 'next';
import { requireRouteAccess } from '@/lib/nav/guard';
import FeeScheduleEditor from '@/components/admin/FeeScheduleEditor';

export const metadata: Metadata = { title: 'Fee Schedules' };

const EDIT_ROLES = ['admin', 'super_user', 'finance'];

export default async function AdminFeeSchedulePage() {
  const session = await requireRouteAccess('/admin/fee-schedule');
  const role = session.user.role ?? 'lawyer';

  return (
    <div className="h-[calc(100vh-3.5rem)] flex flex-col">
      <header className="px-6 py-4 border-b border-zinc-200 dark:border-zinc-800">
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Fee Schedules</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-0.5">
          The firm&rsquo;s published rate cards. Engagement proposals quote the professional schedule and attach
          the relevant schedules as Annex &ldquo;A&rdquo;, so a change here reaches the next proposal sent.
        </p>
      </header>
      <div className="flex-1 overflow-hidden">
        <FeeScheduleEditor canEdit={EDIT_ROLES.includes(role)} />
      </div>
    </div>
  );
}
