'use client';

import { useMemo } from 'react';
import { Landmark } from 'lucide-react';
import DataTable, { type ColumnDef, type FilterDef } from '@/components/DataTable';
import FileAttachmentLinks from '@/components/FileAttachmentLinks';
import type { FileListing } from '@/types/notion';
import { DOCUMENT_TYPES } from '@/lib/document-type';
import { RECEIVED_BUCKETS, receivedBucket } from '@/lib/file-facets';

const UNCLASSIFIED = 'Not yet classified';
const NO_ORIGIN = 'Unspecified';

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-PH', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'Asia/Manila',
  });
}

// "Received" for browsing purposes: the logged receipt date when the firm
// recorded one, otherwise the moment the file entered the system.
function receivedOn(f: FileListing): string | null {
  return f.dateReceived ?? f.createdTime ?? null;
}

const columns: ColumnDef<FileListing>[] = [
  {
    key: 'name',
    label: 'Name',
    getValue: (f) => f.name,
    render: (f) => (
      <span className="inline-flex items-center gap-1.5 min-w-0">
        <span className="truncate">{f.name || '(Untitled)'}</span>
        {f.isCourtRecord && (
          <span
            title="Court record"
            className="inline-flex items-center shrink-0 text-amber-600 dark:text-amber-400"
          >
            <Landmark className="w-3.5 h-3.5" aria-hidden="true" />
            <span className="sr-only">Court record</span>
          </span>
        )}
      </span>
    ),
  },
  {
    key: 'matter',
    label: 'Matter',
    getValue: (f) => f.matter,
    render: (f) => <span className="text-sm text-stone-600 dark:text-stone-300">{f.matter || '—'}</span>,
  },
  {
    key: 'documentType',
    label: 'Type',
    getValue: (f) => f.documentType ?? '',
    render: (f) =>
      f.documentType ? (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-stone-100 text-stone-600 dark:bg-white/5 dark:text-stone-300 whitespace-nowrap">
          {f.documentType}
        </span>
      ) : (
        <span className="text-stone-300 dark:text-stone-600">—</span>
      ),
  },
  {
    key: 'origin',
    label: 'Origin',
    getValue: (f) => f.origin,
    render: (f) => <span className="text-sm text-stone-600 dark:text-stone-300">{f.origin || '—'}</span>,
  },
  {
    key: 'dateReceived',
    label: 'Received',
    getValue: (f) => receivedOn(f),
    render: (f) => (
      <span className="text-sm text-stone-500 tabular-nums dark:text-stone-400">{formatDate(receivedOn(f))}</span>
    ),
  },
  {
    key: 'documentDate',
    label: 'Document date',
    getValue: (f) => f.documentDate ?? '',
    render: (f) => (
      <span className="text-sm text-stone-500 tabular-nums dark:text-stone-400">{formatDate(f.documentDate)}</span>
    ),
    defaultVisible: false,
  },
  {
    key: 'actionTaken',
    label: 'Action',
    getValue: (f) => f.actionTaken,
    render: (f) => <span className="text-sm text-stone-600 dark:text-stone-300">{f.actionTaken || '—'}</span>,
    defaultVisible: false,
  },
  {
    key: 'createdTime',
    label: 'Logged',
    getValue: (f) => f.createdTime,
    render: (f) => (
      <span className="text-sm text-stone-500 tabular-nums dark:text-stone-400">{formatDate(f.createdTime)}</span>
    ),
    defaultVisible: false,
  },
  {
    key: 'attachments',
    label: 'Files',
    sortable: false,
    getValue: (f) => f.fileUrls.length,
    render: (f) => {
      if (f.fileUrls.length === 0) return <span className="text-stone-300 dark:text-stone-600">—</span>;
      return <FileAttachmentLinks files={f.fileUrls} />;
    },
  },
];

// Court and client first; the party-role origins follow in a stable order so
// the dropdown reads the same way every time.
const ORIGIN_ORDER = [
  'Court', 'Client', 'Firm', 'Adverse Party', 'Plaintiff', 'Defendant', 'Complainant',
  'Respondent', 'Petitioner', 'Accused', 'Demanding Party', 'Email', NO_ORIGIN,
];

const filters: FilterDef<FileListing>[] = [
  {
    key: 'documentType',
    label: 'Type',
    getValue: (f) => f.documentType ?? UNCLASSIFIED,
    optionOrder: [...DOCUMENT_TYPES, UNCLASSIFIED],
  },
  {
    key: 'origin',
    label: 'Origin',
    getValue: (f) => f.origin || NO_ORIGIN,
    optionOrder: ORIGIN_ORDER,
  },
  {
    key: 'received',
    label: 'Received',
    getValue: (f) => receivedBucket(receivedOn(f)),
    optionOrder: [...RECEIVED_BUCKETS],
  },
];

interface Props {
  data: FileListing[];
  userId: string;
  userMatterIds: string[];
  role: string;
}

export default function FilesTable({ data, userId, userMatterIds, role }: Props) {
  const matterIdSet = useMemo(() => new Set(userMatterIds), [userMatterIds]);

  return (
    <DataTable
      data={data}
      columns={columns}
      getRowHref={(f) => `/dashboard/documents/${f.id}`}
      getRowId={(f) => f.id}
      entityLabel="File"
      defaultSortKey="dateReceived"
      defaultSortDir="desc"
      userId={userId}
      isMyItem={(f) => f.matterId != null && matterIdSet.has(f.matterId)}
      role={role}
      filters={filters}
      persistKey="files"
    />
  );
}
