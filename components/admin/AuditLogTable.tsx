'use client';

import { useState } from 'react';
import useSWR from 'swr';
import DatePickerInput from '@/components/DatePickerInput';
import {
  Search,
  ChevronLeft,
  ChevronRight,
  Filter,
  RefreshCw,
} from 'lucide-react';

interface AuditEntry {
  id: number;
  entity_type: string;
  entity_id: string | null;
  entity_name: string | null;
  action: string;
  field_changed: string | null;
  old_value: string | null;
  new_value: string | null;
  performed_by: string;
  performed_by_name: string | null;
  ip_address: string | null;
  created_at: string;
}

const ACTION_BADGES: Record<string, { label: string; className: string }> = {
  create: { label: 'Create', className: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400' },
  update: { label: 'Update', className: 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400' },
  delete: { label: 'Delete', className: 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400' },
  status_change: { label: 'Status', className: 'bg-purple-50 text-purple-700 dark:bg-purple-500/10 dark:text-purple-400' },
  login: { label: 'Login', className: 'bg-gold-50 text-gold-700 dark:bg-gold-500/10 dark:text-gold-400' },
  password_change: { label: 'Password', className: 'bg-stone-100 text-stone-600 dark:bg-stone-500/10 dark:text-stone-400' },
  password_set: { label: 'Password Set', className: 'bg-stone-100 text-stone-600 dark:bg-stone-500/10 dark:text-stone-400' },
  role_change: { label: 'Role', className: 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400' },
  portal_shown: { label: 'Shown in portal', className: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400' },
  portal_hidden: { label: 'Hidden from portal', className: 'bg-stone-100 text-stone-600 dark:bg-stone-500/10 dark:text-stone-400' },
  portal_preview_viewed: { label: 'Portal preview', className: 'bg-stone-100 text-stone-600 dark:bg-stone-500/10 dark:text-stone-400' },
};

const ENTITY_TYPES = [
  'auth', 'billing_rate', 'clients', 'deliverable', 'deliverables',
  'dtr', 'files', 'hearings', 'matters', 'meetings', 'tasks', 'user',
];

const ACTIONS = [
  'create', 'update', 'delete', 'status_change',
  'login', 'password_change', 'password_set',
  'portal_shown', 'portal_hidden', 'portal_preview_viewed',
];

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-PH', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Manila',
  });
}

function truncate(str: string, max: number): string {
  return str.length > max ? str.substring(0, max) + '...' : str;
}

export default function AuditLogTable() {
  const [page, setPage] = useState(1);

  // Filters
  const [entityType, setEntityType] = useState('');
  const [action, setAction] = useState('');
  const [search, setSearch] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('pageSize', '50');
  if (entityType) params.set('entityType', entityType);
  if (action) params.set('action', action);
  if (search) params.set('search', search);
  if (fromDate) params.set('from', fromDate);
  if (toDate) params.set('to', toDate);

  const { data, isValidating, mutate } = useSWR<{ data?: AuditEntry[]; total?: number; totalPages?: number }>(
    `/api/admin/audit-log?${params}`,
    { keepPreviousData: true },
  );
  const entries = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 1;
  const loading = !data;

  // Reset page when filters change
  const filterKey = [entityType, action, search, fromDate, toDate].join('|');
  const [pageFilterKey, setPageFilterKey] = useState(filterKey);
  if (pageFilterKey !== filterKey) {
    setPageFilterKey(filterKey);
    setPage(1);
  }

  return (
    <div className="space-y-3">
      {/* Search + Filter bar */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or user..."
            className="w-full pl-9 pr-3 py-2 text-sm bg-card border border-[var(--border-color)] rounded-lg text-foreground placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-1 focus:ring-gold-400/50"
          />
        </div>
        <button
          type="button"
          onClick={() => setShowFilters(!showFilters)}
          className={`p-2 rounded-lg border transition-colors ${
            showFilters || entityType || action || fromDate || toDate
              ? 'bg-gold-50 dark:bg-gold-500/10 border-gold-300/50 dark:border-gold-500/30 text-gold-700 dark:text-gold-400'
              : 'border-[var(--border-color)] text-[var(--text-muted)] hover:text-foreground hover:bg-[var(--subtle-bg)]'
          }`}
        >
          <Filter className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => mutate()}
          className="p-2 rounded-lg border border-[var(--border-color)] text-[var(--text-muted)] hover:text-foreground hover:bg-[var(--subtle-bg)] transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${isValidating ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Filter panel */}
      {showFilters && (
        <div className="flex flex-wrap items-center gap-2 p-3 bg-card border border-[var(--border-color)] rounded-lg animate-fade-up">
          <select
            value={entityType}
            onChange={(e) => setEntityType(e.target.value)}
            className="h-[30px] text-xs bg-[var(--background)] border border-[var(--border-color)] hover:border-[var(--border-hover)] rounded-lg px-3 py-1.5 text-foreground focus:outline-none focus:border-gold-400 focus:ring-2 focus:ring-gold-400/20"
          >
            <option value="">All entities</option>
            {ENTITY_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <select
            value={action}
            onChange={(e) => setAction(e.target.value)}
            className="h-[30px] text-xs bg-[var(--background)] border border-[var(--border-color)] hover:border-[var(--border-hover)] rounded-lg px-3 py-1.5 text-foreground focus:outline-none focus:border-gold-400 focus:ring-2 focus:ring-gold-400/20"
          >
            <option value="">All actions</option>
            {ACTIONS.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
          <DatePickerInput
            value={fromDate || null}
            onChange={(v) => setFromDate(v ?? '')}
            placeholder="From"
            variant="compact"
            className="w-36"
          />
          <DatePickerInput
            value={toDate || null}
            onChange={(v) => setToDate(v ?? '')}
            placeholder="To"
            variant="compact"
            className="w-36"
          />
          {(entityType || action || fromDate || toDate) && (
            <button
              type="button"
              onClick={() => { setEntityType(''); setAction(''); setFromDate(''); setToDate(''); }}
              className="text-[10px] text-[var(--text-muted)] hover:text-foreground px-2 py-1"
            >
              Clear filters
            </button>
          )}
        </div>
      )}

      {/* Table */}
      <div className="bg-card border border-[var(--border-color)] rounded-xl shadow-[var(--shadow-card)] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border-color)]">
                <th className="text-left px-4 py-3 text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">Time</th>
                <th className="text-left px-4 py-3 text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">User</th>
                <th className="text-left px-4 py-3 text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">Action</th>
                <th className="text-left px-4 py-3 text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">Entity</th>
                <th className="hidden sm:table-cell text-left px-4 py-3 text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">Details</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 10 }).map((_, i) => (
                  <tr key={i} className="border-b border-[var(--border-color)]">
                    {Array.from({ length: 5 }).map((_, j) => (
                      <td key={j} className="px-4 py-3">
                        <div className="h-4 bg-[var(--subtle-bg)] rounded skeleton-shimmer" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : entries.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center text-[var(--text-muted)]">
                    No audit log entries found
                  </td>
                </tr>
              ) : (
                entries.map((entry) => {
                  const badge = ACTION_BADGES[entry.action] ?? { label: entry.action, className: 'bg-stone-100 text-stone-600 dark:bg-stone-500/10 dark:text-stone-400' };
                  return (
                    <tr key={entry.id} className="border-b border-[var(--border-color)] hover:bg-[var(--subtle-bg)] transition-colors">
                      <td className="px-4 py-2.5 text-xs text-[var(--text-muted)] tabular-nums whitespace-nowrap">
                        {formatTime(entry.created_at)}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-foreground whitespace-nowrap">
                        {entry.performed_by_name ?? 'System'}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${badge.className}`}>
                          {badge.label}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <div>
                          <span className="text-[10px] font-medium text-[var(--text-muted)] uppercase">{entry.entity_type}</span>
                          {entry.entity_name && (
                            <p className="text-xs text-foreground truncate max-w-[200px]">{truncate(entry.entity_name, 40)}</p>
                          )}
                        </div>
                      </td>
                      <td className="hidden sm:table-cell px-4 py-2.5 text-xs text-[var(--text-secondary)]">
                        {entry.field_changed && (
                          <span>
                            <span className="font-medium text-foreground">{entry.field_changed}</span>
                            {entry.old_value && entry.new_value ? (
                              <span>: {truncate(entry.old_value, 20)} → {truncate(entry.new_value, 20)}</span>
                            ) : entry.new_value ? (
                              <span>: {truncate(entry.new_value, 30)}</span>
                            ) : null}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-[var(--border-color)]">
            <span className="text-xs text-[var(--text-muted)] tabular-nums">
              {total.toLocaleString()} entries · Page {page} of {totalPages}
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setPage(Math.max(1, page - 1))}
                disabled={page <= 1}
                className="p-1.5 rounded-md hover:bg-[var(--subtle-bg)] text-[var(--text-muted)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setPage(Math.min(totalPages, page + 1))}
                disabled={page >= totalPages}
                className="p-1.5 rounded-md hover:bg-[var(--subtle-bg)] text-[var(--text-muted)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
