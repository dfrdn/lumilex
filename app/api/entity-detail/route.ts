import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import {
  getTaskById, getDeliverableById, getHearingById,
  getFilingById, getMeetingById, getFileById,
  getDeliverableVersions, getDeliverableActions, getDeliverableComments,
} from '@/lib/queries/detail';

/** Resolve person IDs to { id, name, initials, position, avatarUrl } */
async function resolvePersonIds(firmId: string, ids: string[]) {
  if (ids.length === 0) return [];
  const supabase = getServiceDbForFirm(firmId);
  const { data } = await supabase
    .from('team')
    .select('person_id, name, initials, position, avatar_url')
    .in('person_id', ids);
  return (data ?? []).map((r: any) => ({
    id: r.person_id,
    name: r.name ?? '',
    initials: r.initials ?? '??',
    position: r.position ?? '',
    avatarUrl: r.avatar_url ?? null,
  }));
}

/** Collect all person IDs from an entity's data */
function collectPersonIds(entity: string, data: any): string[] {
  const ids: string[] = [];
  switch (entity) {
    case 'tasks':
      if (data.assigneeIds) ids.push(...data.assigneeIds);
      break;
    case 'deliverables':
      if (data.drafter) ids.push(...data.drafter);
      if (data.reviewerIds) ids.push(...data.reviewerIds);
      if (data.currentlyWith) ids.push(...data.currentlyWith);
      break;
    case 'hearings':
    case 'filings':
    case 'meetings':
      if (data.attendeeIds) ids.push(...data.attendeeIds);
      break;
    case 'files':
      if (data.personsReadIds) ids.push(...data.personsReadIds);
      break;
  }
  return [...new Set(ids.filter(Boolean))];
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const entity = searchParams.get('entity');
  const id = searchParams.get('id');

  if (!entity || !id) {
    return NextResponse.json({ error: 'Missing entity or id' }, { status: 400 });
  }

  let data: any = null;
  let versions: any[] | undefined;
  let actions: any[] | undefined;
  let comments: any[] | undefined;

  switch (entity) {
    case 'tasks': data = await getTaskById(id, session.firmId); break;
    case 'deliverables': {
      // Fetch deliverable + activity in parallel — the pane shows version history
      // and latest submission, so we bundle them here to avoid a second round-trip.
      const [d, v, a, c] = await Promise.all([
        getDeliverableById(id, session.firmId),
        getDeliverableVersions(id, session.firmId),
        getDeliverableActions(id, session.firmId),
        getDeliverableComments(id, session.firmId),
      ]);
      data = d;
      versions = v;
      actions = a;
      comments = c;
      break;
    }
    case 'hearings': data = await getHearingById(id, session.firmId); break;
    case 'filings': data = await getFilingById(id, session.firmId); break;
    case 'meetings': data = await getMeetingById(id, session.firmId); break;
    case 'files': data = await getFileById(id, session.firmId); break;
    default:
      return NextResponse.json({ error: 'Unknown entity type' }, { status: 400 });
  }

  if (!data) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Collect person IDs from the entity AND from deliverable activity so every
  // avatar in the pane can resolve initials without a second request.
  const personIds = collectPersonIds(entity, data);
  if (versions) versions.forEach((v) => v.uploadedBy && personIds.push(v.uploadedBy));
  if (actions) actions.forEach((a) => a.performedBy && personIds.push(a.performedBy));
  if (comments) comments.forEach((c) => c.personId && personIds.push(c.personId));
  const uniqueIds = [...new Set(personIds.filter(Boolean))];
  const people = await resolvePersonIds(session.firmId, uniqueIds);

  return NextResponse.json({ data, people, versions, actions, comments });
}
