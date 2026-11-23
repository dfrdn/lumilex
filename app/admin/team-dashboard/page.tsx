import type { Metadata } from 'next';
import { requireRouteAccess } from '@/lib/nav/guard';
import TeamDashboardContent from '@/components/shared/TeamDashboardContent';

export const metadata: Metadata = { title: 'Team Dashboard' };

export const revalidate = 30;

type SearchParams = { lawyer?: string };

export default async function TeamDashboardPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireRouteAccess('/admin/team-dashboard');

  const sp = await searchParams;

  return (
    <TeamDashboardContent shellMode="admin" selectedLawyerId={sp?.lawyer ?? ''} />
  );
}
