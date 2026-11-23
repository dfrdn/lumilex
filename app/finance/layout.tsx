import { requireAreaAccess } from '@/lib/nav/guard';
import { resolveFeatureFlags } from '@/lib/firm/features';
import { getSavedSidebar } from '@/lib/queries/sidebar';
import DetailPaneWrapper from '@/components/DetailPaneWrapper';
import { FeatureProvider } from '@/components/FeatureProvider';
import FinanceShell from '@/components/finance/FinanceShell';

export const revalidate = 30;

export default async function FinanceLayout({ children }: { children: React.ReactNode }) {
  const session = await requireAreaAccess('/finance');

  return (
    <FeatureProvider features={await resolveFeatureFlags(session.firmId)}>
      <DetailPaneWrapper>
        <FinanceShell role={session.user.role} savedSidebar={await getSavedSidebar(session.firmId, session.user.email)}>
          {children}
        </FinanceShell>
      </DetailPaneWrapper>
    </FeatureProvider>
  );
}
