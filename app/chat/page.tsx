import type { Metadata } from 'next';
import { getSession } from '@/lib/session';
import { redirect } from 'next/navigation';
import ChatFullPage from '@/components/chat/ChatFullPage';

export const metadata: Metadata = { title: 'Chat' };

export default async function ChatRoute() {
  const session = await getSession();
  if (!session?.user?.notionUserId) redirect('/login');

  return <ChatFullPage currentUserId={session.user.notionUserId} chatBasePath="/chat" containerHeight="calc(100vh - 6.5rem)" />;
}
