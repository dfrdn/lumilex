import type { Metadata } from 'next';
import { isFeatureAvailable } from '@/lib/firm/features';
import { redirect } from 'next/navigation';
import IntegrationsManager from '@/components/admin/IntegrationsManager';
import { requireRouteAccess } from '@/lib/nav/guard';

export const metadata: Metadata = { title: 'Integrations' };

export const revalidate = 30;

export default async function AdminIntegrationsPage() {
  const session = await requireRouteAccess('/admin/integrations');

  if (!(await isFeatureAvailable(session.firmId, 'sharepoint'))) redirect('/admin');

  return (
    <>
      <div className="mb-8">
        <h1 className="font-serif text-2xl sm:text-3xl font-semibold tracking-tight text-foreground">
          Integrations
        </h1>
        <p className="text-sm text-[var(--text-secondary)] mt-1">
          Mirror matter documents into the firm’s SharePoint library
        </p>
      </div>

      <IntegrationsManager />
    </>
  );
}
