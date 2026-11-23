import type { Metadata } from 'next';
import { requireRouteAccess } from '@/lib/nav/guard';

import { FileText } from 'lucide-react';
import {
  getAllDeliverables,
  getAllFilings,
  getAllStatusReports,
  getInternalDeliverablesForUser,
} from '@/lib/queries/listing';
import { resolvePersonIds } from '@/lib/queries/people';
import { deliverablesHref, parseDeliverableView, type DeliverableView } from '@/lib/deliverables/views';
import Button from '@/components/ui/Button';
import EmptyState from '@/components/ui/EmptyState';
import PageHeader from '@/components/ui/PageHeader';
import ViewTabs from './ViewTabs';
import DeliverablesTable from './DeliverablesTable';
import FilingsTable from './FilingsTable';
import StatusReportsTable from './StatusReportsTable';
import InternalDeliverables from './InternalDeliverables';
import ByStatusView from './ByStatusView';

export const metadata: Metadata = { title: 'My Deliverables' };

export const revalidate = 30;

const SUBTITLES: Record<DeliverableView, string> = {
  mine: 'The active deliverables you draft, review or hold, status reports included',
  all: 'Every active deliverable in the firm, status reports aside',
  filings: 'External deliverables with a due date, on matters with a case title, number or court',
  'status-reports': 'Status reports across all matters',
  internal: 'Internal deliverables sent to or from you',
  'by-status': 'Deliverables grouped by where they stand',
};

/** Initials and pictures for the people a list shows. */
async function peopleFor(firmId: string, ids: string[]) {
  const people = await resolvePersonIds(firmId, ids);
  const initialsById: Record<string, string> = {};
  const avatarsById: Record<string, string | null> = {};
  for (const [id, info] of people.entries()) {
    initialsById[id] = info.initials;
    avatarsById[id] = info.avatarUrl;
  }
  return { initialsById, avatarsById };
}

/*
 * One Deliverables list with saved filters (?view=, lib/deliverables/views):
 * Mine (the default) is every active deliverable the person is on, status
 * reports included; All is every active one but status reports; Filings, Status
 * reports, Internal and By status are what their own pages used to show.
 */
export default async function DeliverablesPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; card?: string; status?: string }>;
}) {
  const session = await requireRouteAccess('/dashboard/deliverables');
  const firmId = session.firmId;

  const userId = session.user.notionUserId;
  const role = session.user.role ?? 'lawyer';
  const params = await searchParams;
  const view = parseDeliverableView(params.view);

  let body: React.ReactNode;
  switch (view) {
    case 'all':
    case 'mine': {
      const all = await getAllDeliverables(firmId, { excludeStatusReports: view === 'all' });
      const rows = view === 'mine'
        ? all.filter((d) => d.currentlyWith.includes(userId) || d.drafter.includes(userId) || d.reviewerIds.includes(userId))
        : all;
      body = view === 'mine' && rows.length === 0 ? (
        <EmptyState
          message="You have no active deliverables."
          action={
            <Button href={deliverablesHref('all')} variant="outline">
              See all deliverables
            </Button>
          }
        />
      ) : (
        <DeliverablesTable
          key={view}
          initialCard={params.card ?? null}
          data={rows}
          userId={userId}
          role={role}
          scopedToMe={view === 'mine'}
        />
      );
      break;
    }
    case 'filings':
      body = <FilingsTable data={await getAllFilings(firmId)} userId={userId} role={role} />;
      break;
    case 'status-reports': {
      const reports = await getAllStatusReports(firmId);
      const people = await peopleFor(firmId, reports.flatMap((r) => [...r.drafter, ...r.reviewerIds, ...r.currentlyWith]));
      body = <StatusReportsTable data={reports} userId={userId} role={role} {...people} />;
      break;
    }
    case 'internal': {
      const items = await getInternalDeliverablesForUser(firmId, userId);
      const people = await peopleFor(firmId, items.flatMap((d) => [...d.drafter, ...d.reviewerIds]));
      body = <InternalDeliverables data={items} userId={userId} {...people} />;
      break;
    }
    case 'by-status':
      body = <ByStatusView firmId={firmId} status={params.status?.trim() || null} />;
      break;
  }

  return (
    <>
      <PageHeader icon={<FileText className="w-5 h-5" />} title="My Deliverables" subtitle={SUBTITLES[view]} />
      <ViewTabs view={view} />
      {body}
    </>
  );
}
