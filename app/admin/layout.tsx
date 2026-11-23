import { requireAreaAccess } from '@/lib/nav/guard';
import { resolveFeatureFlags } from '@/lib/firm/features';
import { getSavedSidebar } from '@/lib/queries/sidebar';
import { AdminTabsProvider } from '@/components/admin/AdminTabsContext';
import DetailPaneWrapper from '@/components/DetailPaneWrapper';
import { FeatureProvider } from '@/components/FeatureProvider';
import AdminShell from '@/components/admin/AdminShell';

export const revalidate = 30;

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await requireAreaAccess('/admin');

  return (
    <FeatureProvider features={await resolveFeatureFlags(session.firmId)}>
      <DetailPaneWrapper>
        <AdminTabsProvider>
          <AdminShell role={session.user.role} savedSidebar={await getSavedSidebar(session.firmId, session.user.email)}>
            {children}
          </AdminShell>
        </AdminTabsProvider>
      </DetailPaneWrapper>
    </FeatureProvider>
  );
}
