'use client';

import DataTable, { type ColumnDef } from '@/components/DataTable';
import type { ClientListing } from '@/types/notion';

const columns: ColumnDef<ClientListing>[] = [
  {
    key: 'name',
    label: 'Name',
    getValue: (c) => c.name,
    render: (c) => c.name || '(Untitled)',
  },
  {
    key: 'code',
    label: 'Code',
    getValue: (c) => c.clientCode,
    getSortValue: (c) => c.clientCode ? Number(c.clientCode) || 0 : null,
    render: (c) => (
      <span className="text-xs text-stone-500 font-mono dark:text-stone-400">{c.clientCode || '—'}</span>
    ),
  },
];

interface Props {
  data: ClientListing[];
}

export default function ClientsTable({ data }: Props) {
  return (
    <DataTable
      data={data}
      columns={columns}
      getRowHref={(c) => `/dashboard/clients/${c.id}`}
      getRowId={(c) => c.id}
      entityLabel="Client"
      defaultSortKey="name"
    />
  );
}
