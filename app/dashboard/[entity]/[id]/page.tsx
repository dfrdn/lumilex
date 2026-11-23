import { notFound } from 'next/navigation';
import { getSession } from '@/lib/session';
import { redirect } from 'next/navigation';

import AnnouncementDetail from '@/components/detail/AnnouncementDetail';
import TaskDetail from '@/components/detail/TaskDetail';
import MeetingDetail from '@/components/detail/MeetingDetail';
import HearingDetail from '@/components/detail/HearingDetail';
import DeliverableDetail from '@/components/detail/DeliverableDetail';
import ClientDetail from '@/components/detail/ClientDetail';
import MatterDetail from '@/components/detail/MatterDetail';
import FileDetail from '@/components/detail/FileDetail';
import { detailRouteTitle } from '@/lib/page-metadata';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ entity: string; id: string }>;
}) {
  const { entity, id } = await params;
  return { title: await detailRouteTitle(entity, id) };
}

const VALID_ENTITIES = new Set([
  'announcements',
  'tasks',
  'meetings',
  'deliverables',
  'hearings',
  'clients',
  'matters',
  'files',
]);

export default async function EntityDetailPage({
  params,
}: {
  params: Promise<{ entity: string; id: string }>;
}) {
  const session = await getSession();
  if (!session?.user?.notionUserId) redirect('/login');

  const { entity, id } = await params;

  if (!VALID_ENTITIES.has(entity)) notFound();

  const userName = session.user.name ?? '';
  const role = session.user.role ?? 'lawyer';
  const firmId = session.firmId;

  function renderDetail() {
    switch (entity) {
      case 'announcements':
        return <AnnouncementDetail id={id} firmId={firmId} />;
      case 'tasks':
        return <TaskDetail id={id} />;
      case 'meetings':
        return <MeetingDetail id={id} />;
      case 'deliverables':
        return <DeliverableDetail id={id} />;
      case 'hearings':
        return <HearingDetail id={id} />;
      case 'clients':
        return <ClientDetail id={id} />;
      case 'matters':
        return <MatterDetail id={id} />;
      case 'files':
        return <FileDetail id={id} />;
      default:
        notFound();
    }
  }

  return renderDetail();
}
