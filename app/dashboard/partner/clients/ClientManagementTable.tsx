'use client';

import { useState, useEffect, useMemo } from 'react';
import DataTable, { type ColumnDef, type FilterDef } from '@/components/DataTable';
import type { ClientManagementRow } from '@/lib/queries/client-management';
import type { DropdownOption } from '@/components/admin/CellDropdown';
import { fmt, signed, MarginBadge } from '@/lib/finance/format';
import { LIFECYCLE_BADGE, LIFECYCLE_ORDER } from '@/lib/clients/lifecycle';
import ClientPriorityToggle from './ClientPriorityToggle';
import ClientRelationshipPartnerPicker from './ClientRelationshipPartnerPicker';
import RelationshipPartnerAllocation, { UNASSIGNED_KEY } from './RelationshipPartnerAllocation';

const DORMANT_AFTER_DAYS = 365;

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

function relativeActivity(iso: string | null): string {
  const d = daysSince(iso);
  if (d == null) return '—';
  if (d < 30) return 'This month';
  if (d < 365) return `${Math.floor(d / 30)}mo ago`;
  return `${Math.floor(d / 365)}y ago`;
}

const NotBilled = () => <span className="text-xs text-stone-300 dark:text-stone-600">Not billed</span>;

function buildColumns(
  onPriorityChange: (id: string, next: boolean) => void,
  onRelationshipPartnerChange: (id: string, next: string | null) => void,
  partnerOptions: DropdownOption[],
  partnerNameById: Record<string, string>,
): ColumnDef<ClientManagementRow>[] {
  return [
    {
      key: 'name',
      label: 'Client',
      getValue: (c) => c.name,
      render: (c) => (
        <span>
          {c.name || '(Untitled)'}
          {c.clientCode && <span className="ml-1.5 text-xs text-stone-400 font-mono">{c.clientCode}</span>}
        </span>
      ),
    },
    {
      key: 'priority',
      label: 'Priority',
      getValue: (c) => c.priority,
      render: (c) => (
        <ClientPriorityToggle
          clientId={c.id}
          priority={c.priority}
          onChange={(next) => onPriorityChange(c.id, next)}
        />
      ),
    },
    {
      key: 'relationshipPartner',
      label: 'Relationship partner',
      getValue: (c) => c.relationshipPartnerName ?? '',
      getSortValue: (c) => c.relationshipPartnerName ?? null,
      render: (c) => (
        <ClientRelationshipPartnerPicker
          clientId={c.id}
          value={c.relationshipPartnerId}
          options={partnerOptions}
          nameById={partnerNameById}
          onChange={(next) => onRelationshipPartnerChange(c.id, next)}
        />
      ),
    },
    {
      key: 'collected',
      label: 'Collected (12mo)',
      headerTooltip: 'Cash actually received from this client in the trailing 12 months.',
      getValue: (c) => c.collected12mo,
      render: (c) => <span className="text-sm font-semibold tabular-nums text-stone-700 dark:text-stone-200">{fmt(c.collected12mo)}</span>,
    },
    {
      key: 'profit',
      label: 'Profit',
      getValue: (c) => c.profit,
      render: (c) =>
        c.hasProfitData ? (
          <span className={`text-sm font-semibold tabular-nums ${c.profit >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
            {signed(c.profit)}
          </span>
        ) : (
          <NotBilled />
        ),
    },
    {
      key: 'margin',
      label: 'Margin',
      getValue: (c) => c.margin,
      render: (c) => (c.hasProfitData ? <MarginBadge margin={c.margin} /> : <NotBilled />),
    },
    {
      key: 'matters',
      label: 'Matters',
      headerTooltip: 'Active / total matters for this client.',
      getValue: (c) => c.activeMatterCount,
      render: (c) => (
        <span className="text-xs text-stone-600 dark:text-stone-300 tabular-nums">
          <span className="font-semibold">{c.activeMatterCount}</span>
          <span className="text-stone-400"> / {c.matterCount}</span>
        </span>
      ),
    },
    {
      key: 'activity',
      label: 'Last activity',
      getValue: (c) => c.lastActivityAt,
      getSortValue: (c) => (c.lastActivityAt ? new Date(c.lastActivityAt).getTime() : null),
      render: (c) => {
        const d = daysSince(c.lastActivityAt);
        const dim = d == null || d > DORMANT_AFTER_DAYS;
        return <span className={`text-xs ${dim ? 'text-stone-400 dark:text-stone-600' : 'text-stone-600 dark:text-stone-300'}`}>{relativeActivity(c.lastActivityAt)}</span>;
      },
    },
    {
      key: 'lifecycle',
      label: 'Status',
      getValue: (c) => c.lifecycle,
      render: (c) => (
        <span className={`inline-flex items-center px-2 py-0.5 text-[11px] font-medium rounded-full ring-1 ring-inset ${LIFECYCLE_BADGE[c.lifecycle]}`}>
          {c.lifecycle}
        </span>
      ),
    },
  ];
}

const filters: FilterDef<ClientManagementRow>[] = [
  {
    key: 'lifecycle',
    label: 'Status',
    getValue: (c) => c.lifecycle,
    optionOrder: LIFECYCLE_ORDER,
  },
  {
    key: 'priority',
    label: 'Priority',
    getValue: (c) => (c.priority ? 'Priority' : 'Standard'),
    optionOrder: ['Priority', 'Standard'],
  },
  {
    key: 'activity',
    label: 'Activity',
    getValue: (c) => {
      const d = daysSince(c.lastActivityAt);
      return d == null || d > DORMANT_AFTER_DAYS ? 'Dormant' : 'Active';
    },
    optionOrder: ['Active', 'Dormant'],
  },
];

interface Props {
  data: ClientManagementRow[];
  partnerOptions: DropdownOption[];
  partnerNameById: Record<string, string>;
}

export default function ClientManagementTable({ data, partnerOptions, partnerNameById }: Props) {
  const [rows, setRows] = useState(data);
  useEffect(() => setRows(data), [data]);

  // Allocation-overview selection: a person_id, UNASSIGNED_KEY, or null (no filter).
  const [partnerFilter, setPartnerFilter] = useState<string | null>(null);

  function handlePriorityChange(id: string, next: boolean) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, priority: next } : r)));
  }

  function handleRelationshipPartnerChange(id: string, next: string | null) {
    const name = next ? partnerNameById[next] ?? null : null;
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, relationshipPartnerId: next, relationshipPartnerName: name } : r)));
  }

  const visibleRows = useMemo(() => {
    if (partnerFilter === null) return rows;
    if (partnerFilter === UNASSIGNED_KEY) return rows.filter((r) => !r.relationshipPartnerId);
    return rows.filter((r) => r.relationshipPartnerId === partnerFilter);
  }, [rows, partnerFilter]);

  return (
    <>
      <RelationshipPartnerAllocation
        rows={rows}
        partnerOptions={partnerOptions}
        selected={partnerFilter}
        onSelect={setPartnerFilter}
      />
      <DataTable
        data={visibleRows}
        columns={buildColumns(handlePriorityChange, handleRelationshipPartnerChange, partnerOptions, partnerNameById)}
        getRowHref={(c) => `/dashboard/partner/clients/${c.id}`}
        getRowId={(c) => c.id}
        entityLabel="Client"
        defaultSortKey="collected"
        defaultSortDir="desc"
        filters={filters}
        defaultFilters={{ lifecycle: 'Active' }}
        pinToTop={(c) => c.priority}
      />
    </>
  );
}
