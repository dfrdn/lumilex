import type { Metadata } from 'next';
import { Cog } from 'lucide-react';
import { requireRouteAccess } from '@/lib/nav/guard';
import { resolveFeatureFlags } from '@/lib/firm/features';
import PageHeader from '@/components/ui/PageHeader';
import SettingsHub from '@/components/settings/SettingsHub';

export const metadata: Metadata = { title: 'Firm settings' };

export default async function FirmSettingsPage() {
  const session = await requireRouteAccess('/admin/settings');

  return (
    <>
      <PageHeader
        icon={<Cog className="w-5 h-5" />}
        title="Firm settings"
        subtitle="Everything that sets up the firm, by what it is for. Each link opens the page where it is edited."
      />
      <SettingsHub hub="firm" role={session.user.role} flags={await resolveFeatureFlags(session.firmId)} />
    </>
  );
}
