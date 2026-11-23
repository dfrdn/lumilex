import { requireAreaAccess } from '@/lib/nav/guard';
import { resolveFeatureFlags } from '@/lib/firm/features';
import { FeatureProvider } from '@/components/FeatureProvider';
import { getSavedSidebar } from '@/lib/queries/sidebar';
import LiaisonShell from '@/components/liaison/LiaisonShell';
import ChatProvider from '@/components/chat/ChatProvider';

export const revalidate = 0;

export default async function LiaisonLayout({ children }: { children: React.ReactNode }) {
  const session = await requireAreaAccess('/liaison');

  // ChatProvider supplies the unread count the header's Chat button carries.
  return (
    <FeatureProvider features={await resolveFeatureFlags(session.firmId)}>
      <ChatProvider>
        <LiaisonShell role={session.user.role} savedSidebar={await getSavedSidebar(session.firmId, session.user.email)}>
          {children}
        </LiaisonShell>
      </ChatProvider>
    </FeatureProvider>
  );
}
