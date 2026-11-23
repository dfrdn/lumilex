import { getSession } from '@/lib/session';
import { redirect, notFound } from 'next/navigation';
import TrademarkDetail from '@/components/detail/TrademarkDetail';
import { getTrademarkById, signTrademarkPath } from '@/lib/queries/detail';
import { entityTitle } from '@/lib/page-metadata';
import { getTrademarkTeam } from '@/lib/queries/subject-team';

export const revalidate = 0;

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return { title: await entityTitle({ table: 'trademarks', idColumn: 'id', id, nameColumn: 'mark', fallback: 'Trademark' }) };
}

export default async function TrademarkDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getSession();
  if (!session?.user?.notionUserId) redirect('/login');

  const { id } = await params;
  const trademark = await getTrademarkById(id, session.firmId);
  if (!trademark) notFound();

  const [markImageUrl, gpoaUrl, team] = await Promise.all([
    signTrademarkPath(trademark.markImagePath),
    signTrademarkPath(trademark.gpoaFilePath),
    getTrademarkTeam(session.firmId, trademark.id),
  ]);

  return (
    <TrademarkDetail
      trademark={trademark}
      markImageUrl={markImageUrl}
      gpoaUrl={gpoaUrl}
      team={team}
    />
  );
}
