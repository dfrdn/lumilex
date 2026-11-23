import { getSession } from '@/lib/session';
import { redirect, notFound } from 'next/navigation';

import {
  getCorporationById,
  getCorporationPersons,
  getCorporationFiles,
  getCorporationMeetings,
  getCorporationResolutions,
  getResolutionTemplates,
  getDeliverablesForCorporation,
  getCorporationMatterNames,
  getCorporationClientNames,
  getCorporationActivity,
  getCorporationStatusContext,
  getCorporationTeam,
} from '@/lib/queries/corporations';
import CorporationDetail from '@/components/detail/CorporationDetail';
import { entityTitle } from '@/lib/page-metadata';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // subjects.name is the approved name, or the first proposed one before SEC registration.
  return { title: await entityTitle({ table: 'subjects', idColumn: 'id', id, nameColumn: 'name', fallback: 'Corporation' }) };
}

export default async function CorporationDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const session = await getSession();
  if (!session?.user?.notionUserId) redirect('/login');

  const role = session.user.role ?? 'lawyer';

  const { id } = await params;
  const { tab } = await searchParams;
  const corporation = await getCorporationById(session.firmId, id);
  if (!corporation) notFound();

  const [people, files, meetings, resolutions, templates, deliverables, matterNames, clientNames, activity, statusContext, team] = await Promise.all([
    getCorporationPersons(session.firmId, corporation.id),
    getCorporationFiles(session.firmId, corporation.id),
    getCorporationMeetings(session.firmId, corporation.id),
    getCorporationResolutions(session.firmId, corporation.id),
    getResolutionTemplates(session.firmId, true),
    getDeliverablesForCorporation(session.firmId, corporation),
    getCorporationMatterNames(session.firmId, corporation),
    getCorporationClientNames(session.firmId, corporation),
    getCorporationActivity(session.firmId, corporation.id),
    getCorporationStatusContext(session.firmId, corporation),
    getCorporationTeam(session.firmId, corporation),
  ]);

  return (
    <CorporationDetail
      corporation={corporation}
      people={people}
      files={files}
      meetings={meetings}
      resolutions={resolutions}
      templates={templates}
      deliverables={deliverables}
      matterNames={matterNames}
      clientNames={clientNames}
      activity={activity}
      role={role}
      initialTab={tab}
      calendar={statusContext.calendar}
      openRequestMatterIds={statusContext.openRequestMatterIds}
      team={team}
    />
  );
}
