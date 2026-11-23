import { getSession } from '@/lib/session';
import { redirect } from 'next/navigation';
import { homeFor } from '@/lib/nav/access';
import ChatLayoutShell from '@/components/chat/ChatLayoutShell';

export default async function ChatLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session?.user?.notionUserId) redirect('/login');

  return (
    <ChatLayoutShell backHref={homeFor(session.user.role)}>
      {children}
    </ChatLayoutShell>
  );
}
