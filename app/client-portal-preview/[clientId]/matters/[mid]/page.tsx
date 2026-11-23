import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getSession } from '@/lib/session';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import PortalMatterDetailView from '@/app/portal/matters/[id]/PortalMatterDetailView';
import { loadPortalMatterDetail } from '@/lib/portal/data';
import { requirePreviewAccess } from '../../access';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ clientId: string; mid: string }>;
}): Promise<Metadata> {
  const { clientId, mid } = await params;
  const session = await getSession();
  if (!session) return { title: 'Portal preview · Matter' };
  // Scope by client_id so a cross-client matter id can't leak its name into the
  // tab title (the page body 404s for it; the title must agree).
  const { data } = await getServiceDbForFirm(session.firmId)
    .from('matters')
    .select('name')
    .eq('notion_id', mid)
    .eq('client_id', clientId)
    .maybeSingle();
  const name = (data?.name as string | undefined)?.trim() || 'Matter';
  return { title: `Portal preview · ${name}` };
}

export const dynamic = 'force-dynamic';

export default async function PreviewMatterPage({
  params,
}: {
  params: Promise<{ clientId: string; mid: string }>;
}) {
  const session = await requirePreviewAccess();
  const { clientId, mid } = await params;

  const data = await loadPortalMatterDetail(session.firmId, clientId, mid);
  if (!data) notFound();

  return (
    <PortalMatterDetailView
      data={data}
      basePath={`/client-portal-preview/${clientId}`}
      signerName=""
      preview
    />
  );
}
