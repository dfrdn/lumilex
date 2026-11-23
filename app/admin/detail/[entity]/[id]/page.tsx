import { notFound } from 'next/navigation';
import { requireRouteAccess } from '@/lib/nav/guard';

import TaskDetail from '@/components/detail/TaskDetail';
import MeetingDetail from '@/components/detail/MeetingDetail';
import HearingDetail from '@/components/detail/HearingDetail';
import DeliverableDetail from '@/components/detail/DeliverableDetail';
import ClientDetail from '@/components/detail/ClientDetail';
import MatterDetail from '@/components/detail/MatterDetail';
import FileDetail from '@/components/detail/FileDetail';
import TrademarkDetail from '@/components/detail/TrademarkDetail';
import { getTrademarkById, signTrademarkPath } from '@/lib/queries/detail';
import { getTrademarkTeam } from '@/lib/queries/subject-team';
import IframeLinkInterceptor from '@/components/admin/IframeLinkInterceptor';

const VALID_ENTITIES = new Set([
  'tasks',
  'meetings',
  'deliverables',
  'hearings',
  'filings',
  'clients',
  'matters',
  'files',
  'trademarks',
]);

/**
 * Minimal detail page rendered inside an iframe for the admin detail drawer.
 * No shell/sidebar — just the detail content with its own styling.
 */
export default async function AdminDetailEmbed({
  params,
}: {
  params: Promise<{ entity: string; id: string }>;
}) {
  const { entity, id } = await params;
  const session = await requireRouteAccess(`/admin/detail/${entity}/${id}`);
  const role = session.user.role;

  if (!VALID_ENTITIES.has(entity)) notFound();

  // Trademarks need server-side data fetch + signed storage URLs (the
  // existing TrademarkDetail expects them as props, unlike the other
  // detail components which fetch their own data via REST from the client).
  let trademarkProps: Awaited<ReturnType<typeof loadTrademarkProps>> | null = null;
  if (entity === 'trademarks') {
    trademarkProps = await loadTrademarkProps(id, session.firmId);
    if (!trademarkProps) notFound();
  }

  function renderDetail() {
    switch (entity) {
      case 'tasks':
        return <TaskDetail id={id} />;
      case 'meetings':
        return <MeetingDetail id={id} />;
      case 'deliverables':
        return <DeliverableDetail id={id} />;
      case 'hearings':
        return <HearingDetail id={id} />;
      case 'filings':
        return <DeliverableDetail id={id} />;
      case 'clients':
        return <ClientDetail id={id} />;
      case 'matters':
        return <MatterDetail id={id} />;
      case 'files':
        return <FileDetail id={id} />;
      case 'trademarks':
        return trademarkProps ? (
          <TrademarkDetail
            trademark={trademarkProps.trademark}
            markImageUrl={trademarkProps.markImageUrl}
            gpoaUrl={trademarkProps.gpoaUrl}
            team={trademarkProps.team}
          />
        ) : null;
      default:
        notFound();
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <IframeLinkInterceptor />
      <div className="max-w-screen-xl mx-auto px-4 sm:px-6 py-6">
        {renderDetail()}
      </div>
    </div>
  );
}

async function loadTrademarkProps(id: string, firmId: string) {
  const trademark = await getTrademarkById(id, firmId);
  if (!trademark) return null;
  const [markImageUrl, gpoaUrl, team] = await Promise.all([
    signTrademarkPath(trademark.markImagePath),
    signTrademarkPath(trademark.gpoaFilePath),
    getTrademarkTeam(firmId, trademark.id),
  ]);
  return { trademark, markImageUrl, gpoaUrl, team };
}
