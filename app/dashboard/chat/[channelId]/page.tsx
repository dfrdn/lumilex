import { redirect } from 'next/navigation';

export default async function DashboardChatChannelRedirect({
  params,
}: {
  params: Promise<{ channelId: string }>;
}) {
  const { channelId } = await params;
  redirect(`/chat/${channelId}`);
}
