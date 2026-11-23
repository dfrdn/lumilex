import type { Metadata } from 'next';
import { canOpen } from '@/lib/nav/access';
import Link from 'next/link';
import { getSession } from '@/lib/session';
import { isFeatureAvailable } from '@/lib/firm/features';
import { redirect } from 'next/navigation';

import { Users, Eye } from 'lucide-react';
import { getAllClients } from '@/lib/queries/listing';
import PageHeader from '@/components/ui/PageHeader';
import ClientsTable from './ClientsTable';

export const metadata: Metadata = { title: 'Clients' };

export const revalidate = 30;

export default async function ClientsPage() {
  const session = await getSession();
  if (!session?.user?.notionUserId) redirect('/login');

  const role = session.user.role ?? 'lawyer';
  const userName = session.user.name ?? '';
  const clients = await getAllClients(session.firmId);
  const showPortalPreviews =
    canOpen(role, '/dashboard/clients/portal-previews') && (await isFeatureAvailable(session.firmId, 'portal'));

  return (
    <>
      <PageHeader
        icon={<Users className="w-5 h-5" />}
        title="All Clients"
        subtitle="Browse all clients"
        action={
          showPortalPreviews ? (
            <Link
              href="/dashboard/clients/portal-previews"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--text-primary)] hover:text-gold-600 dark:hover:text-gold-400 border border-[var(--border-color)] bg-[var(--card-bg)] hover:bg-gold-50/40 dark:hover:bg-[rgba(201,168,76,0.06)] rounded-lg px-3 py-2 transition-all"
            >
              <Eye className="w-3.5 h-3.5" />
              Portal previews
            </Link>
          ) : undefined
        }
      />
      <ClientsTable data={clients} />
    </>
  );
}
