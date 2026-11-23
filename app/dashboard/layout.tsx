import { requireAreaAccess } from '@/lib/nav/guard';
import { resolveFeatureFlags } from '@/lib/firm/features';
import { getSavedSidebar } from '@/lib/queries/sidebar';
import DetailPaneWrapper from '@/components/DetailPaneWrapper';
import { FeatureProvider } from '@/components/FeatureProvider';
import DashboardShell from '@/components/DashboardShell';

export const revalidate = 30;

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await requireAreaAccess('/dashboard');

  return (
    <FeatureProvider features={await resolveFeatureFlags(session.firmId)}>
      <DetailPaneWrapper>
        <DashboardShell role={session.user.role ?? 'lawyer'} savedSidebar={await getSavedSidebar(session.firmId, session.user.email)}>
          {children}
        </DashboardShell>
      </DetailPaneWrapper>
    </FeatureProvider>
  );
}
