import type { Metadata } from 'next';
import { Cog } from 'lucide-react';
import { requireRouteAccess } from '@/lib/nav/guard';
import { resolveFeatureFlags } from '@/lib/firm/features';
import PageHeader from '@/components/ui/PageHeader';
import SettingsHub from '@/components/settings/SettingsHub';

export const metadata: Metadata = { title: 'Finance settings' };

export default async function FinanceSettingsPage() {
  const session = await requireRouteAccess('/finance/settings');

  return (
    <>
      <PageHeader
        icon={<Cog className="w-5 h-5" />}
        title="Finance settings"
        subtitle="How the firm bills and books, by what it is for. Each link opens the page where it is edited."
      />
      <SettingsHub hub="finance" role={session.user.role} flags={await resolveFeatureFlags(session.firmId)} />
    </>
  );
}
