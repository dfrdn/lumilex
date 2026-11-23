import type { Metadata } from 'next';
import { requireRouteAccess } from '@/lib/nav/guard';
import LiaisonSchedule from '@/components/liaison/LiaisonSchedule';

export const metadata: Metadata = { title: 'Liaison Schedule' };

export const revalidate = 0;

export default async function LiaisonShellSchedulePage() {
  const session = await requireRouteAccess('/liaison/schedule');
  return <LiaisonSchedule firmId={session.firmId} />;
}
