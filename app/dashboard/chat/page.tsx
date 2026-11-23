import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

export const metadata: Metadata = { title: 'Chat' };

export default function DashboardChatRedirect() {
  redirect('/chat');
}
