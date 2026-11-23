'use client';

import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import { ENTITY_CONFIGS } from '@/lib/admin/entity-config';
import AdminDataTable, { type AdminRow } from '@/components/admin/AdminDataTable';
import AddRowModal from '@/components/admin/AddRowModal';
import FiledVersionUploadModal from '@/components/admin/FiledVersionUploadModal';
import { useAdminEntity } from '@/hooks/use-api';
import { useAdminTabs } from '@/components/admin/AdminTabsContext';
import { FileText, Handshake, Gavel, CheckSquare, Paperclip, FolderOpen, ClipboardList } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ColumnFilters } from '@/components/admin/AdminEntityPage';
import { DELIVERABLE_STATUS } from '@/lib/deliverable-status';

const TABS: { key: string; label: string; icon: LucideIcon }[] = [
  { key: 'deliverables', label: 'Deliverables', icon: FileText },
  { key: 'filings', label: 'Filings', icon: FolderOpen },
  { key: 'status_reports', label: 'Status Reports', icon: ClipboardList },
  { key: 'meetings', label: 'Meetings', icon: Handshake },
  { key: 'hearings', label: 'Hearings', icon: Gavel },
  { key: 'tasks', label: 'Tasks', icon: CheckSquare },
  { key: 'files', label: 'Files', icon: Paperclip },
];

// Columns to hide by default per entity for a compact view
const DEFAULT_HIDDEN: Record<string, string[]> = {
  deliverables: ['client_name', 'priority', 'type'],
  filings: ['client_name'],
  status_reports: ['client_name', 'currently_with_ids'],
  meetings: ['type'],
  hearings: ['type'],
  tasks: [],
  files: [],
};

// Default filters per entity (applied on first mount of the tab)
const DEFAULT_FILTERS: Record<string, ColumnFilters> = {
  // Filings tab = external deliverables marked as Filed or Sent out
  filings: { status: DELIVERABLE_STATUS.FILED_OR_SENT_OUT },
};

function RecentEntityTab({ entity }: { entity: string }) {
  const entityConfig = ENTITY_CONFIGS[entity]!;

  const router = useRouter();
  const { openTab, setActiveTab } = useAdminTabs();

  const [page, setPage] = useState(1);
  const pageSize = 15;
  const [sortBy, setSortBy] = useState('created_time');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filters, setFilters] = useState<ColumnFilters>(() => DEFAULT_FILTERS[entity] ?? {});
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(
    () => new Set(DEFAULT_HIDDEN[entity] ?? []),
  );
  const [addRowOpen, setAddRowOpen] = useState(false);
  const [filedVersionTarget, setFiledVersionTarget] = useState<{ id: string; name: string; hasExisting?: boolean } | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(searchQuery);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [searchQuery]);

  useEffect(() => { setPage(1); }, [filters]);

  const { data: response, error: fetchError, isLoading, isValidating, mutate } = useAdminEntity(
    entity,
    { page, pageSize, sortBy, sortDir, search: debouncedSearch, filters },
  );

  const data = response?.data ?? [];
  const total = response?.total ?? 0;
  const totalPages = response?.totalPages ?? 1;
  const loading = isLoading || isValidating;

  const handleOpenDetail = useCallback((id: string) => {
    const detailEntity = entityConfig.viewOf ?? entity;
    const row = data.find((r: any) => (r.notion_id ?? r.id) === id);
    const label = String(row?.name || row?.title || id.slice(0, 8));
    openTab({ id, entity: detailEntity, label, entityLabel: entityConfig.labelSingular });
    setActiveTab(id);
    router.push(`/admin/${entity}`);
  }, [entity, entityConfig, data, openTab, setActiveTab, router]);

  const onRefresh = useCallback(() => { mutate(); }, [mutate]);
  const onPatchRows = useCallback(
    (update: (rows: AdminRow[]) => AdminRow[]) => {
      mutate((current) => {
        if (!current) return current;
        const data = update(current.data);
        // Rows removed (or put back) move the record count with them.
        return { ...current, data, total: current.total + data.length - current.data.length };
      }, { revalidate: false });
    },
    [mutate],
  );

  const canUploadFiledVersion =
    entity === 'deliverables' || entity === 'filings' || entity === 'status_reports';
  const canCreateStatusReport = entity === 'filings' || entity === 'hearings';
  const handleCreateStatusReport = useCallback(
    async (id: string) => {
      const source = entity === 'hearings' ? 'hearing' : 'filing';
      try {
        const res = await fetch('/api/status-report/from-parent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ source, notionId: id }),
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast.error(payload?.error || 'Failed to create status report');
          return;
        }
        if (payload.created) {
          toast.success('Status report created.');
        } else if (payload.reason === 'already_exists') {
          toast('A status report already exists for this item.');
        } else {
          toast(`No status report created: ${payload.reason ?? 'unknown'}`);
        }
        mutate();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Request failed');
      }
    },
    [entity, mutate],
  );

  const onSort = useCallback((key: string, dir: 'asc' | 'desc') => {
    setSortBy(key);
    setSortDir(dir);
    setPage(1);
  }, []);

  const onFilterChange = useCallback((key: string, value: string) => {
    setFilters((prev) => {
      const next = { ...prev };
      if (value) next[key] = value;
      else delete next[key];
      return next;
    });
  }, []);

  const onClearAllFilters = useCallback(() => { setFilters({}); }, []);

  const onToggleColumn = useCallback((colKey: string) => {
    setHiddenColumns((prev) => {
      const next = new Set(prev);
      if (next.has(colKey)) next.delete(colKey);
      else next.add(colKey);
      return next;
    });
  }, []);

  const onShowAllColumns = useCallback(() => { setHiddenColumns(new Set()); }, []);

  // Skeleton before the first response only; see AdminEntityPage.
  if (!response && loading) {
    return (
      <div className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-2xl overflow-hidden">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="border-b border-[var(--border-color)] last:border-b-0 px-4 py-3 flex gap-4">
            {Array.from({ length: 4 }).map((_, j) => (
              <div key={j} className="h-4 bg-[var(--border-color)] rounded animate-pulse" style={{ width: `${60 + ((i * 4 + j) * 23) % 100}px`, animationDelay: `${(i * 4 + j) * 50}ms` }} />
            ))}
          </div>
        ))}
      </div>
    );
  }

  if (fetchError) {
    return (
      <div className="bg-[var(--card-bg)] border border-red-200 dark:border-red-500/20 rounded-2xl p-6 text-center">
        <p className="text-sm text-red-600 dark:text-red-400">Failed to load {entityConfig.labelPlural.toLowerCase()}</p>
      </div>
    );
  }

  const addConfig = entityConfig.viewOf ? ENTITY_CONFIGS[entityConfig.viewOf] : entityConfig;

  return (
    <>
      <AdminDataTable
        data={data}
        fields={entityConfig.fields}
        entity={entity}
        onRefresh={onRefresh}
        onPatchRows={onPatchRows}
        onAdd={() => setAddRowOpen(true)}
        page={page}
        pageSize={pageSize}
        total={total}
        totalPages={totalPages}
        onPageChange={setPage}
        onPageSizeChange={() => {}}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        sortKey={sortBy}
        sortDir={sortDir}
        onSort={onSort}
        filters={filters}
        onFilterChange={onFilterChange}
        onClearAllFilters={onClearAllFilters}
        hiddenColumns={hiddenColumns}
        onToggleColumn={onToggleColumn}
        onShowAllColumns={onShowAllColumns}
        readOnly={entityConfig.readOnly}
        onOpenDetail={handleOpenDetail}
        onCreateStatusReport={canCreateStatusReport ? handleCreateStatusReport : undefined}
        onUploadFiledVersion={
          canUploadFiledVersion ? (id, name, hasExisting) => setFiledVersionTarget({ id, name, hasExisting }) : undefined
        }
      />

      {!entityConfig.readOnly && (
        <AddRowModal
          open={addRowOpen}
          onClose={() => setAddRowOpen(false)}
          entity={entityConfig.viewOf ?? entity}
          entityLabel={addConfig?.labelSingular ?? entityConfig.labelSingular}
          fields={addConfig?.fields ?? entityConfig.fields}
          onSuccess={() => {
            setAddRowOpen(false);
            mutate();
          }}
        />
      )}

      <FiledVersionUploadModal
        open={filedVersionTarget !== null}
        onClose={() => setFiledVersionTarget(null)}
        deliverableId={filedVersionTarget?.id ?? ''}
        deliverableName={filedVersionTarget?.name ?? ''}
        status={DELIVERABLE_STATUS.FILED_OR_SENT_OUT}
        hasExisting={filedVersionTarget?.hasExisting}
        onSuccess={() => mutate()}
      />
    </>
  );
}

export default function AdminRecentTables() {
  const [activeTab, setActiveTab] = useState('deliverables');
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return <div className="mt-8" />;

  return (
    <div className="mt-8">
      <h2 className="font-serif text-lg font-semibold tracking-tight text-foreground mb-4">
        Recently Added
      </h2>

      {/* Tabs */}
      <div className="flex items-center gap-1 mb-4 border-b border-[var(--border-color)]">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 transition-colors duration-150 cursor-pointer -mb-px ${
              activeTab === key
                ? 'border-gold-500 text-gold-600 dark:text-gold-400'
                : 'border-transparent text-[var(--text-secondary)] hover:text-foreground hover:border-[var(--border-color)]'
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* Active tab content */}
      <RecentEntityTab key={activeTab} entity={activeTab} />
    </div>
  );
}
