import type { Metadata } from 'next';
import { requireRouteAccess } from '@/lib/nav/guard';

import { FileCheck } from 'lucide-react';
import { getAllDeliverables } from '@/lib/queries/listing';
import PageHeader from '@/components/ui/PageHeader';
import DeliverablesTable from '../../deliverables/DeliverablesTable';
import { DELIVERABLE_STATUS } from '@/lib/deliverable-status';

export const metadata: Metadata = { title: 'Pre-Finalizing' };

export const revalidate = 30;

export default async function PartnerPreFinalizingPage() {
  const session = await requireRouteAccess('/dashboard/partner/pre-finalizing');

  const role = session.user.role ?? 'lawyer';

  const userId = session.user.notionUserId;
  const userName = session.user.name ?? '';
  const all = await getAllDeliverables(session.firmId);
  const deliverables = all.filter(
    (d) => d.status === DELIVERABLE_STATUS.FINALIZING || d.status === DELIVERABLE_STATUS.PRE_FINALIZED,
  );

  return (
    <>
      <PageHeader
        icon={<FileCheck className="w-5 h-5" />}
        title="Pre-Finalizing Review"
        subtitle="Deliverables awaiting partner review before finalization"
      />
      <DeliverablesTable data={deliverables} userId={userId} role={role} />
    </>
  );
}
