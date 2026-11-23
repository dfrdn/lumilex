import type { Metadata } from 'next';
import { requireRouteAccess } from '@/lib/nav/guard';
import TeamDashboardContent from '@/components/shared/TeamDashboardContent';

export const metadata: Metadata = { title: 'Team Dashboard' };

export const revalidate = 30;

type SearchParams = { lawyer?: string };

export default async function FinanceTeamDashboardPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireRouteAccess('/finance/team-dashboard');

  const sp = await searchParams;

  return (
    <TeamDashboardContent shellMode="finance" selectedLawyerId={sp?.lawyer ?? ''} />
  );
}
