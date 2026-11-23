import type { Metadata } from 'next';
import { requireRouteAccess } from '@/lib/nav/guard';

import { getAllLiaisonTasks, getLiaisonOfficers } from '@/lib/queries/liaison';
import LiaisonCommandCenter from './LiaisonCommandCenter';

export const metadata: Metadata = { title: 'Command Center' };

export const revalidate = 0;

export default async function LiaisonHomePage() {
  const session = await requireRouteAccess('/liaison');

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
