'use client';

import { useMemo, useState } from 'react';
import useSWR from 'swr';
import {
  Plus, X, Download, Save, PlayCircle, Loader2, Trash2, BookOpen,
} from 'lucide-react';
import { ALLOWLIST, ENTITY_LABELS, type Entity, type FilterOp } from '@/lib/reports/allowlist';
import { manilaToday, toManilaDay } from '@/lib/dates';
import { confirmAction } from '@/components/ui/confirm';

interface SavedReport {
  id: string;
  name: string;
  entity: Entity;
  filters: { col: string; op: FilterOp; value: unknown }[];
  columns: string[];
  group_by: string | null;
  shared_scope: 'private' | 'firm';
  owner_id: string;
  updated_at: string;
}

interface RunResponse {
  entity: Entity;
  columns: string[];
  rowCount: number;
  cappedAt: number | null;
  rows: Record<string, unknown>[];
  aggregated: { group: string; count: number }[] | null;
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());

const ENTITIES: Entity[] = ['matters', 'deliverables', 'dtr', 'invoices'];

function defaultColumns(entity: Entity): string[] {
  // Pick a few useful defaults — first 5 columns of the allowlist.
  return [...ALLOWLIST[entity].selectableColumns].slice(0, 5);
}

export default function ReportsBuilder() {
  const [entity, setEntity] = useState<Entity>('matters');
  const [columns, setColumns] = useState<string[]>(defaultColumns('matters'));
  const [filters, setFilters] = useState<{ col: string; op: FilterOp; value: string }[]>([]);
  const [groupBy, setGroupBy] = useState<string>('');
  const [result, setResult] = useState<RunResponse | null>(null);
  const [running, setRunning] = useState(false);
  const [reportName, setReportName] = useState('');
  const [sharedScope, setSharedScope] = useState<'private' | 'firm'>('private');
  const [error, setError] = useState<string | null>(null);

  const { data: savedData, mutate: mutateSaved } = useSWR<{ reports: SavedReport[] }>(
    '/api/reports/saved',
    fetcher,
  );

  const spec = ALLOWLIST[entity];
  const selectableColumns = useMemo(() => [...spec.selectableColumns], [spec]);
  const filterableColumns = useMemo(() => Object.keys(spec.filterableColumns), [spec]);
  const groupByColumns = useMemo(() => [...spec.groupByColumns], [spec]);

  const onEntityChange = (e: Entity) => {
    setEntity(e);
    setColumns(defaultColumns(e));
    setFilters([]);
    setGroupBy('');
    setResult(null);
    setError(null);
  };

  const toggleColumn = (col: string) => {
    setColumns((prev) => (prev.includes(col) ? prev.filter((c) => c !== col) : [...prev, col]));
  };

  const addFilter = () => {
    if (filterableColumns.length === 0) return;
    const firstCol = filterableColumns[0];
    const firstOp = ALLOWLIST[entity].filterableColumns[firstCol][0];
    setFilters((prev) => [...prev, { col: firstCol, op: firstOp, value: '' }]);
  };

  const updateFilter = (i: number, patch: Partial<{ col: string; op: FilterOp; value: string }>) => {
    setFilters((prev) =>
      prev.map((f, idx) =>
        idx === i
          ? { ...f, ...patch, ...(patch.col ? { op: ALLOWLIST[entity].filterableColumns[patch.col][0] } : {}) }
          : f,
      ),
    );
  };

  const removeFilter = (i: number) => {
    setFilters((prev) => prev.filter((_, idx) => idx !== i));
  };

  const runReport = async (format: 'json' | 'xlsx' = 'json') => {
    setRunning(true);
    setError(null);
    try {
      const body = {
        entity,
        columns,
        filters: filters
          .filter((f) => f.value !== '')
          .map((f) => ({
            col: f.col,
            op: f.op,
            value: f.op === 'in' ? f.value.split(',').map((v) => v.trim()) : f.value,
          })),
        group_by: groupBy || null,
        format,
      };
      if (format === 'xlsx') {
        const r = await fetch('/api/reports/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          setError(j.error ?? `Error ${r.status}`);
          return;
        }
        const blob = await r.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `report-${entity}-${manilaToday()}.xlsx`;
        a.click();
        URL.revokeObjectURL(url);
      } else {
        const r = await fetch('/api/reports/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const j = await r.json();
        if (!r.ok) {
          setError(j.error ?? `Error ${r.status}`);
          return;
        }
        setResult(j);
      }
    } finally {
      setRunning(false);
    }
  };

  const saveReport = async () => {
    if (!reportName.trim()) {
      setError('Name the report before saving.');
      return;
    }
    const body = {
      name: reportName.trim(),
      entity,
      columns,
      filters: filters
        .filter((f) => f.value !== '')
        .map((f) => ({
          col: f.col,
          op: f.op,
          value: f.op === 'in' ? f.value.split(',').map((v) => v.trim()) : f.value,
        })),
      group_by: groupBy || null,
      shared_scope: sharedScope,
    };
    const r = await fetch('/api/reports/saved', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (r.ok) {
      setReportName('');
      mutateSaved();
    } else {
      const j = await r.json();
      setError(j.error ?? 'Save failed.');
    }
  };

  const loadSaved = (rep: SavedReport) => {
    setEntity(rep.entity);
    setColumns(rep.columns);
    setFilters(
      rep.filters.map((f) => ({
        col: f.col,
        op: f.op,
        value: Array.isArray(f.value) ? (f.value as unknown[]).join(',') : String(f.value ?? ''),
      })),
    );
    setGroupBy(rep.group_by ?? '');
    setResult(null);
    setError(null);
  };

  const deleteSaved = async (id: string) => {
    if (!(await confirmAction({ title: 'Delete this saved report?', confirmLabel: 'Delete', danger: true }))) return;
    await fetch(`/api/reports/saved/${id}`, { method: 'DELETE' });
    mutateSaved();
  };

  const saved = savedData?.reports ?? [];

  return (
    <div className="flex h-full">
      {/* Saved reports sidebar */}
      <aside className="w-60 shrink-0 border-r border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/30 overflow-auto">
        <div className="px-3 py-2 border-b border-zinc-200 dark:border-zinc-800">
          <span className="text-[11px] uppercase tracking-wider font-semibold text-zinc-500 dark:text-zinc-400 flex items-center gap-1.5">
            <BookOpen className="w-3.5 h-3.5" /> Saved reports
          </span>
        </div>
        {saved.length === 0 ? (
          <div className="px-4 py-6 text-[11px] text-zinc-400 dark:text-zinc-500">
            Saved reports appear here.
          </div>
        ) : (
          <ul className="py-1">
            {saved.map((r) => (
              <li key={r.id}>
                <div className="flex items-center gap-1 px-2 py-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 group">
                  <button
                    type="button"
                    onClick={() => loadSaved(r)}
                    className="flex-1 text-left cursor-pointer"
                  >
                    <div className="text-xs font-medium text-zinc-700 dark:text-zinc-300 truncate">{r.name}</div>
                    <div className="text-[10px] text-zinc-400 dark:text-zinc-500">
                      {ENTITY_LABELS[r.entity]} · {r.shared_scope === 'firm' ? 'shared' : 'private'}
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteSaved(r.id)}
                    className="opacity-0 group-hover:opacity-100 p-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded cursor-pointer"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </aside>

      {/* Builder pane */}
      <main className="flex-1 overflow-auto p-6 space-y-5">
        {/* Entity picker */}
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-2">Entity</h3>
          <div className="flex flex-wrap gap-2">
            {ENTITIES.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => onEntityChange(e)}
                className={`px-3 py-1.5 rounded-md text-sm font-medium border cursor-pointer ${
                  entity === e
                    ? 'bg-gold-100 border-gold-300 text-gold-800 dark:bg-gold-900/30 dark:border-gold-700 dark:text-gold-300'
                    : 'bg-white dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300'
                }`}
              >
                {ENTITY_LABELS[e]}
              </button>
            ))}
          </div>
        </section>

        {/* Columns */}
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-2">
            Columns ({columns.length})
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {selectableColumns.map((c) => {
              const on = columns.includes(c);
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => toggleColumn(c)}
                  className={`px-2 py-1 text-xs rounded border cursor-pointer ${
                    on
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-900/20 dark:border-emerald-800 dark:text-emerald-300'
                      : 'bg-white dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400'
                  }`}
                >
                  {spec.labels[c] ?? c}
                </button>
              );
            })}
          </div>
        </section>

        {/* Filters */}
        <section>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Filters</h3>
            <button
              type="button"
              onClick={addFilter}
              disabled={filterableColumns.length === 0}
              className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 cursor-pointer"
            >
              <Plus className="w-3 h-3" /> Add filter
            </button>
          </div>
          {filters.length === 0 ? (
            <div className="text-[11px] text-zinc-400 dark:text-zinc-500">No filters — returns all rows you have access to.</div>
          ) : (
            <ul className="space-y-2">
              {filters.map((f, i) => {
                const ops = ALLOWLIST[entity].filterableColumns[f.col] ?? [];
                return (
                  <li key={i} className="flex items-center gap-2">
                    <select
                      value={f.col}
                      onChange={(e) => updateFilter(i, { col: e.target.value })}
                      className="text-xs px-2 py-1 rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800"
                    >
                      {filterableColumns.map((c) => (
                        <option key={c} value={c}>
                          {spec.labels[c] ?? c}
                        </option>
                      ))}
                    </select>
                    <select
                      value={f.op}
                      onChange={(e) => updateFilter(i, { op: e.target.value as FilterOp })}
                      className="text-xs px-2 py-1 rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800"
                    >
                      {ops.map((op) => (
                        <option key={op} value={op}>
                          {op}
                        </option>
                      ))}
                    </select>
                    <input
                      type="text"
                      value={f.value}
                      onChange={(e) => updateFilter(i, { value: e.target.value })}
                      placeholder={f.op === 'in' ? 'comma,separated' : 'value'}
                      className="flex-1 text-xs px-2 py-1 rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800"
                    />
                    <button
                      type="button"
                      onClick={() => removeFilter(i)}
                      className="p-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded cursor-pointer"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Group-by */}
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-2">
            Group by (optional)
          </h3>
          <select
            value={groupBy}
            onChange={(e) => setGroupBy(e.target.value)}
            className="text-sm px-2 py-1 rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800"
          >
            <option value="">— none —</option>
            {groupByColumns.map((c) => (
              <option key={c} value={c}>
                {spec.labels[c] ?? c}
              </option>
            ))}
          </select>
        </section>

        {/* Action buttons */}
        <section className="flex items-center gap-2 pt-2 border-t border-zinc-100 dark:border-zinc-800">
          <button
            type="button"
            onClick={() => runReport('json')}
            disabled={running || columns.length === 0}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md bg-gold-500 text-white hover:bg-gold-600 cursor-pointer disabled:opacity-50"
          >
            {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlayCircle className="w-4 h-4" />}
            Run
          </button>
          <button
            type="button"
            onClick={() => runReport('xlsx')}
            disabled={running || columns.length === 0}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 cursor-pointer disabled:opacity-50"
          >
            <Download className="w-4 h-4" /> Export XLSX
          </button>

          <div className="ml-auto flex items-center gap-1.5">
            <input
              type="text"
              value={reportName}
              onChange={(e) => setReportName(e.target.value)}
              placeholder="Save as…"
              className="text-xs px-2 py-1 rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 w-40"
            />
            <select
              value={sharedScope}
              onChange={(e) => setSharedScope(e.target.value as 'private' | 'firm')}
              className="text-xs px-2 py-1 rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800"
            >
              <option value="private">Private</option>
              <option value="firm">Firm-shared</option>
            </select>
            <button
              type="button"
              onClick={saveReport}
              disabled={!reportName.trim()}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 cursor-pointer disabled:opacity-50"
            >
              <Save className="w-3 h-3" /> Save
            </button>
          </div>
        </section>

        {error && (
          <div className="text-xs text-red-600 dark:text-red-400 px-3 py-2 rounded-md bg-red-50 dark:bg-red-900/20">
            {error}
          </div>
        )}

        {/* Result */}
        {result && (
          <section className="border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-hidden">
            <div className="px-3 py-2 bg-zinc-50 dark:bg-zinc-800/50 flex items-center justify-between text-xs">
              <span className="font-semibold text-zinc-700 dark:text-zinc-300">
                {result.rowCount} row{result.rowCount === 1 ? '' : 's'}
                {result.cappedAt && <span className="text-amber-600 dark:text-amber-400 ml-1.5">(capped at {result.cappedAt})</span>}
              </span>
            </div>

            {result.aggregated && (
              <div className="border-b border-zinc-200 dark:border-zinc-800">
                <div className="px-3 py-1.5 text-[11px] uppercase tracking-wider font-semibold text-zinc-500 dark:text-zinc-400 bg-zinc-50/50 dark:bg-zinc-900/30">
                  Grouped totals
                </div>
                <table className="w-full text-xs">
                  <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                    {result.aggregated.slice(0, 20).map((a, i) => (
                      <tr key={i}>
                        <td className="px-3 py-1 text-zinc-700 dark:text-zinc-300">{a.group || <em className="text-zinc-400">∅</em>}</td>
                        <td className="px-3 py-1 text-right tabular-nums text-zinc-600 dark:text-zinc-400">{a.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="overflow-auto max-h-[40vh]">
              <table className="w-full text-xs">
                <thead className="bg-zinc-50 dark:bg-zinc-800/50 sticky top-0">
                  <tr>
                    {result.columns.map((c) => (
                      <th key={c} className="text-left px-3 py-1.5 font-semibold text-zinc-600 dark:text-zinc-400 uppercase tracking-wider text-[10px]">
                        {ALLOWLIST[result.entity].labels[c] ?? c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {result.rows.slice(0, 100).map((row, i) => (
                    <tr key={i}>
                      {result.columns.map((c) => (
                        <td key={c} className="px-3 py-1 text-zinc-700 dark:text-zinc-300 max-w-[200px] truncate" title={String(row[c] ?? '')}>
                          {formatCell(row[c])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {result.rows.length > 100 && (
                <div className="px-3 py-2 text-[11px] text-zinc-500 dark:text-zinc-400 bg-zinc-50 dark:bg-zinc-800/50">
                  Showing first 100 of {result.rowCount} rows. Export XLSX for the full set.
                </div>
              )}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

function formatCell(v: unknown): string {
  if (v == null) return '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) {
    // ISO timestamp — render as its Manila date
    return toManilaDay(v);
  }
  return String(v);
}
