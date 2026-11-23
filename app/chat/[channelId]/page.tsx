import { getSession } from '@/lib/session';
import { redirect } from 'next/navigation';
import ChatFullPage from '@/components/chat/ChatFullPage';
import { entityTitle } from '@/lib/page-metadata';

export async function generateMetadata({ params }: { params: Promise<{ channelId: string }> }) {
  const { channelId } = await params;
  return { title: await entityTitle({ table: 'chat_channels', idColumn: 'id', id: channelId, nameColumn: 'name', fallback: 'Chat' }) };
}

export default async function ChatChannelRoute({
  params,
}: {
  params: Promise<{ channelId: string }>;
}) {
  const session = await getSession();
  if (!session?.user?.notionUserId) redirect('/login');

  const { channelId } = await params;

  return <ChatFullPage currentUserId={session.user.notionUserId} initialChannelId={channelId} chatBasePath="/chat" containerHeight="calc(100vh - 6.5rem)" />;
}
