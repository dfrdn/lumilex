'use client';

import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { EntityConfig, ENTITY_CONFIGS } from '@/lib/admin/entity-config';
import AdminDataTable, { type AdminRow } from '@/components/admin/AdminDataTable';
import AddRowModal from '@/components/admin/AddRowModal';
import BatchImport from '@/components/admin/BatchImport';
import BulkFilesUploadModal from '@/components/admin/BulkFilesUploadModal';
import FiledVersionUploadModal from '@/components/admin/FiledVersionUploadModal';
import { RefreshCw, AlertCircle, X, Table2, Loader2 } from 'lucide-react';
import { useAdminEntity } from '@/hooks/use-api';
import { useAdminTabs } from '@/components/admin/AdminTabsContext';
import { DELIVERABLE_STATUS } from '@/lib/deliverable-status';

const ENTITIES_WITH_DETAIL = new Set([
  'clients', 'matters', 'deliverables', 'tasks', 'meetings', 'hearings', 'filings', 'files', 'status_reports',
]);

interface Props {
  entity: string;
  entityConfig: EntityConfig;
}

// Filter value can be a string (select eq), boolean string (checkbox), or date range
export type ColumnFilters = Record<string, string>;

export default function AdminEntityPage({ entity, entityConfig }: Props) {
  // Pagination state
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  // Sort state
  const defaultSort = entity === 'clients' ? 'client_code' : entity === 'matters' ? 'name' : entity === 'filings' ? 'external_due_date' : 'created_time';
  const defaultDir: 'asc' | 'desc' = (entity === 'clients' || entity === 'matters') ? 'asc' : 'desc';
  const [sortBy, setSortBy] = useState(defaultSort);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(defaultDir);

  // Search state (debounced for server-side)
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  // Column filters (server-side)
  const [filters, setFilters] = useState<ColumnFilters>({});

  // Column visibility
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(() => {
    const defaults = new Set<string>();
    if (entity === 'deliverables') {
      defaults.add('client_name');
      defaults.add('priority');
    }
    if (entity === 'clients') {
      defaults.add('tin');
    }
    if (entity === 'hearings') {
      defaults.add('type');
    }
    return defaults;
  });

  const [addRowOpen, setAddRowOpen] = useState(false);
  const [batchImportOpen, setBatchImportOpen] = useState(false);
  const [bulkUploadOpen, setBulkUploadOpen] = useState(false);
  const [filedVersionTarget, setFiledVersionTarget] = useState<{ id: string; name: string; hasExisting?: boolean } | null>(null);

  // Persistent tab system from context (persists across navigation)
  const detailEntity = entityConfig.viewOf ?? entity;
  const { getTabsForEntity, activeTabId, loadingTabs, openTab, closeTab, setActiveTab, markTabLoaded } = useAdminTabs();
  const entityTabs = getTabsForEntity(detailEntity);

  // When navigating to this entity, deactivate tabs from other entities
  // BUT keep active if a tab for this entity was just opened (cross-entity navigation)
  useEffect(() => {
    if (activeTabId) {
      const allEntityTabs = getTabsForEntity(detailEntity);
      if (!allEntityTabs.some((t) => t.id === activeTabId)) {
        setActiveTab(null);
      }
    }
  }, [entity]); // eslint-disable-line react-hooks/exhaustive-deps

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(searchQuery);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [searchQuery]);

  // Reset page when filters change
  useEffect(() => {
    setPage(1);
  }, [filters]);

  // SWR-powered data fetching
  const { data: response, error: fetchError, isLoading, isValidating, mutate } = useAdminEntity(
    entity,
    { page, pageSize, sortBy, sortDir, search: debouncedSearch, filters },
  );

  const data = response?.data ?? [];
  const total = response?.total ?? 0;
  const totalPages = response?.totalPages ?? 1;
  const loading = isLoading || isValidating;
  const error = fetchError ? (fetchError instanceof Error ? fetchError.message : 'An unexpected error occurred') : null;

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

  // Open detail tab via persistent context
  const openDetailTab = useCallback((id: string) => {
    const row = data.find((r: any) => (r.notion_id ?? r.id) === id);
    const label = String(row?.name || row?.title || id.slice(0, 8));
    openTab({ id, entity: detailEntity, label, entityLabel: entityConfig.labelSingular });
  }, [data, detailEntity, entityConfig.labelSingular, openTab]);

  // "Upload Filed Version" row action — for any deliverable-backed entity
  const canUploadFiledVersion =
    entity === 'deliverables' || entity === 'filings' || entity === 'status_reports';

  // Manual "Create Status Report" row action (filings + hearings)
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

  // Is a detail tab from THIS entity currently active?
  const activeEntityTab = activeTabId && entityTabs.some((t) => t.id === activeTabId);

  // ── Loading skeleton ──────────────────────────────────────
  // Only before the first response. Later fetches keep the previous result
  // (keepPreviousData), and swapping the page for a skeleton then would
  // unmount the toolbar — closing the Filter panel mid-edit whenever the
  // current result happens to be empty.
  if (!response && loading) {
    return (
      <div>
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="h-7 w-48 bg-[var(--border-color)] rounded-lg animate-pulse" />
            <div className="h-4 w-32 bg-[var(--border-color)] rounded-md animate-pulse mt-2" />
          </div>
          <div className="flex gap-2">
            <div className="h-9 w-28 bg-[var(--border-color)] rounded-lg animate-pulse" />
            <div className="h-9 w-28 bg-[var(--border-color)] rounded-lg animate-pulse" />
          </div>
        </div>
        <div className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-2xl overflow-hidden">
          <div className="border-b border-[var(--border-color)] px-4 py-3 flex gap-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-4 bg-[var(--border-color)] rounded animate-pulse" style={{ width: `${80 + ((i * 37) % 80)}px` }} />
            ))}
          </div>
          {Array.from({ length: 8 }).map((_, rowIdx) => (
            <div key={rowIdx} className="border-b border-[var(--border-color)] last:border-b-0 px-4 py-3 flex gap-4">
              {Array.from({ length: 5 }).map((_, colIdx) => (
                <div key={colIdx} className="h-4 bg-[var(--border-color)] rounded animate-pulse" style={{ width: `${60 + ((rowIdx * 5 + colIdx) * 23) % 100}px`, animationDelay: `${(rowIdx * 5 + colIdx) * 50}ms` }} />
              ))}
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── Error state ───────────────────────────────────────────
  if (error) {
    return (
      <div>
        <div className="mb-6">
          <h1 className="font-serif text-2xl font-semibold tracking-tight text-foreground">{entityConfig.labelPlural}</h1>
        </div>
        <div className="bg-[var(--card-bg)] border border-red-200 dark:border-red-500/20 rounded-2xl p-8 text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-red-50 dark:bg-red-500/10 mb-4">
            <AlertCircle className="w-6 h-6 text-red-500 dark:text-red-400" />
          </div>
          <p className="text-sm text-red-600 dark:text-red-400 mb-4">{error}</p>
          <button onClick={onRefresh} className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-500/20 transition-colors duration-150">
            <RefreshCw className="w-4 h-4" />
            Retry
          </button>
        </div>
      </div>
    );
  }

  const activeFilterCount = Object.keys(filters).length;
  const hasEntityTabs = entityTabs.length > 0;

  // ── Data loaded ───────────────────────────────────────────
  return (
    <div>
      {/* Page header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
        <div>
          <h1 className="font-serif text-2xl font-semibold tracking-tight text-foreground">{entityConfig.labelPlural}</h1>
          <p className="text-sm text-[var(--text-secondary)] mt-0.5">
            {total.toLocaleString()} {total === 1 ? 'record' : 'records'}
            {activeFilterCount > 0 && (
              <span className="text-gold-600 dark:text-gold-400 ml-1">({activeFilterCount} filter{activeFilterCount > 1 ? 's' : ''} active)</span>
            )}
            {loading && <span className="ml-2 text-[var(--text-muted)]">Loading…</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={onRefresh} className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg text-[var(--text-secondary)] hover:text-foreground hover:bg-[var(--border-color)] transition-colors duration-150" title="Refresh data">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>
      </div>

      {/* Tab bar — only visible when detail tabs exist for this entity */}
      {hasEntityTabs && (
        <div className="flex items-center gap-0.5 mb-4 border-b border-[var(--border-color)] overflow-x-auto scrollbar-none">
          {/* Table tab (always first) */}
          <button
            onClick={() => setActiveTab(null)}
            className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors duration-150 shrink-0 cursor-pointer ${
              !activeEntityTab
                ? 'border-gold-500 text-gold-700 dark:text-gold-400'
                : 'border-transparent text-[var(--text-secondary)] hover:text-foreground hover:border-[var(--border-color)]'
            }`}
          >
            <Table2 className="w-3.5 h-3.5" />
            {entityConfig.labelPlural}
          </button>

          {/* Detail tabs */}
          {entityTabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`group inline-flex items-center gap-1.5 pl-3 pr-1.5 py-2 text-xs font-medium border-b-2 transition-colors duration-150 shrink-0 max-w-[200px] cursor-pointer ${
                activeTabId === tab.id
                  ? 'border-gold-500 text-gold-700 dark:text-gold-400'
                  : 'border-transparent text-[var(--text-secondary)] hover:text-foreground hover:border-[var(--border-color)]'
              }`}
            >
              {loadingTabs.has(tab.id) && <Loader2 className="w-3 h-3 animate-spin shrink-0" />}
              <span className="truncate">{tab.label}</span>
              <span
                onClick={(e) => { e.stopPropagation(); closeTab(tab.id); }}
                className="p-0.5 rounded hover:bg-stone-200 dark:hover:bg-stone-700 transition-colors ml-1 shrink-0 opacity-0 group-hover:opacity-100"
                title="Close tab"
              >
                <X className="w-3 h-3" />
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Table view */}
      <div className={activeEntityTab ? 'hidden' : ''}>
        <AdminDataTable
          data={data}
          fields={entityConfig.fields}
          entity={entity}
          onRefresh={onRefresh}
          onPatchRows={onPatchRows}
          onAdd={() => setAddRowOpen(true)}
          onBatchImport={() => setBatchImportOpen(true)}
          onBulkUpload={entity === 'files' ? () => setBulkUploadOpen(true) : undefined}
          page={page}
          pageSize={pageSize}
          total={total}
          totalPages={totalPages}
          onPageChange={setPage}
          onPageSizeChange={(size) => { setPageSize(size); setPage(1); }}
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
          onOpenDetail={ENTITIES_WITH_DETAIL.has(entity) ? openDetailTab : undefined}
          onCreateStatusReport={canCreateStatusReport ? handleCreateStatusReport : undefined}
          onUploadFiledVersion={
            canUploadFiledVersion ? (id, name, hasExisting) => setFiledVersionTarget({ id, name, hasExisting }) : undefined
          }
        />
      </div>

      {/* Detail tab content (iframes kept alive for instant tab switching) */}
      {entityTabs.map((tab) => (
        <div key={tab.id} className={activeTabId === tab.id ? '' : 'hidden'}>
          <div className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-2xl overflow-hidden relative" style={{ minHeight: '70vh' }}>
            {loadingTabs.has(tab.id) && (
              <div className="absolute inset-0 flex items-center justify-center bg-[var(--card-bg)] z-10">
                <div className="flex flex-col items-center gap-3">
                  <Loader2 className="w-6 h-6 animate-spin text-gold-500 dark:text-gold-400" />
                  <span className="text-sm text-[var(--text-muted)]">Loading detail…</span>
                </div>
              </div>
            )}
            <iframe
              src={`/admin/detail/${detailEntity}/${tab.id}`}
              className="w-full border-0"
              style={{ height: 'calc(100vh - 200px)', minHeight: '500px' }}
              onLoad={() => markTabLoaded(tab.id)}
              title={`${tab.label} detail`}
            />
          </div>
        </div>
      ))}

      {/* Add Row Modal */}
      {!entityConfig.readOnly && (() => {
        const addConfig = entityConfig.viewOf ? ENTITY_CONFIGS[entityConfig.viewOf] : entityConfig;
        return (
          <AddRowModal
            open={addRowOpen}
            onClose={() => setAddRowOpen(false)}
            entity={entityConfig.viewOf ?? entity}
            entityLabel={addConfig?.labelSingular ?? entityConfig.labelSingular}
            fields={addConfig?.fields ?? entityConfig.fields}
            onSuccess={() => { setAddRowOpen(false); mutate(); }}
          />
        );
      })()}

      {/* Upload Filed Version Modal */}
      <FiledVersionUploadModal
        open={filedVersionTarget !== null}
        onClose={() => setFiledVersionTarget(null)}
        deliverableId={filedVersionTarget?.id ?? ''}
        deliverableName={filedVersionTarget?.name ?? ''}
        status={DELIVERABLE_STATUS.FILED_OR_SENT_OUT}
        hasExisting={filedVersionTarget?.hasExisting}
        onSuccess={() => mutate()}
      />

      {/* Batch Import Modal */}
      {!entityConfig.readOnly && (
        <BatchImport
          open={batchImportOpen}
          onClose={() => setBatchImportOpen(false)}
          entity={entity}
          entityLabel={entityConfig.labelPlural}
          fields={entityConfig.fields}
          onSuccess={() => { setBatchImportOpen(false); mutate(); }}
        />
      )}

      {/* Bulk Files Upload — admin Files page only. Creates one row per file. */}
      {entity === 'files' && !entityConfig.readOnly && (
        <BulkFilesUploadModal
          open={bulkUploadOpen}
          onClose={() => setBulkUploadOpen(false)}
          onSuccess={() => mutate()}
        />
      )}
    </div>
  );
}

