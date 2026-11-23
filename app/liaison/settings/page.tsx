import type { Metadata } from 'next';
import { requireRouteAccess } from '@/lib/nav/guard';

import PersonalSettings from '@/components/settings/PersonalSettings';

export const metadata: Metadata = { title: 'Settings' };

export const revalidate = 30;

export default async function LiaisonSettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string | string[] }> }) {
  const session = await requireRouteAccess('/liaison/settings');
  const { tab } = await searchParams;
  return <PersonalSettings session={session} basePath="/liaison/settings" tab={tab} />;
}
