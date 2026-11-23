import type { Metadata } from 'next';
import { requireRouteAccess } from '@/lib/nav/guard';

import { getAllLiaisonTasks, getLiaisonOfficers } from '@/lib/queries/liaison';
import LiaisonCommandCenter from '@/app/liaison/LiaisonCommandCenter';

export const metadata: Metadata = { title: 'Liaison Command' };

export const revalidate = 0;

// Admin-side view of the Liaison Command Center. Renders the same component
// as /liaison but inside AdminShell so admins stay in their navigation
// context.
export default async function AdminLiaisonCommandPage() {
  const session = await requireRouteAccess('/admin/liaison-command');

  const [tasks, officers] = await Promise.all([
    getAllLiaisonTasks(session.firmId),
    getLiaisonOfficers(session.firmId),
  ]);

  return (
    <LiaisonCommandCenter
      tasks={tasks}
      liaisonOfficers={officers}
      meId={session.user.notionUserId}
    />
  );
}
