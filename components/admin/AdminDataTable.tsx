'use client';

import { useState, useRef, useEffect, useCallback, useMemo, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import { mapLimit } from '@/lib/map-limit';
import DatePickerInput from '@/components/DatePickerInput';

import {
  Plus,
  Upload,
  Search,
  Pencil,
  Trash2,
  Check,
  X,
  Loader2,
  ChevronUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Columns3,
  Filter,
  Eye,
  EyeOff,
  Paperclip,
  Archive,
  SquareArrowOutUpRight,
  ClipboardList,
  FileCheck,
} from 'lucide-react';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { CLIENT_RENAME_CONFIRM } from '@/lib/clients/rename-guard';
import CellDropdown, { CellDropdownTrigger } from '@/components/admin/CellDropdown';
import type { DropdownOption } from '@/components/admin/CellDropdown';
import CellDatePicker, { CellDateTrigger } from '@/components/admin/CellDatePicker';
import FileUploadModal from '@/components/admin/FileUploadModal';
import FilePreviewModal from '@/components/FilePreviewModal';
import StatusReportParentEditor from '@/components/StatusReportParentEditor';
import type { FileAttachment } from '@/types/notion';
import type { EntityFieldConfig } from '@/lib/admin/entity-config';
import type { ColumnFilters } from '@/components/admin/AdminEntityPage';
import { DELIVERABLE_STATUS } from '@/lib/deliverable-status';
import { MANILA_TZ } from '@/lib/dates';
import { FORMER_MEMBER } from '@/lib/former-member';

// ── Types ─────────────────────────────────────────────────────────

type EditingCell = {
  rowId: string;
  fieldKey: string;
} | null;

type CellSaveState = 'idle' | 'saving' | 'saved';

interface Props {
  data: GridRow[];
  fields: EntityFieldConfig[];
  entity: string;
  onRefresh: () => void;
  /**
   * Applies a change to the loaded rows ahead of the server, so edits show at
   * once. Without it, the table waits for each save and then calls onRefresh.
   */
  onPatchRows?: (update: (rows: AdminRow[]) => AdminRow[]) => void;
  onAdd: () => void;
  onBatchImport?: () => void;
  onBulkUpload?: () => void;
  // Pagination
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  // Server-side search
  searchQuery: string;
  onSearchChange: (q: string) => void;
  // Server-side sort
  sortKey: string;
  sortDir: 'asc' | 'desc';
  onSort: (key: string, dir: 'asc' | 'desc') => void;
  // Filters
  filters: ColumnFilters;
  onFilterChange: (key: string, value: string) => void;
  onClearAllFilters: () => void;
  // Column visibility
  hiddenColumns: Set<string>;
  onToggleColumn: (colKey: string) => void;
  onShowAllColumns: () => void;
  // Read-only mode (for virtual views like filings)
  readOnly?: boolean;
  // Open detail drawer for a row
  onOpenDetail?: (id: string) => void;
  // Optional: "Create Status Report" row action (filings/hearings only)
  onCreateStatusReport?: (id: string) => Promise<void> | void;
  // Optional: "Upload Filed Version" row action (deliverables/filings/status_reports
  // when the row is in 'Filed or Sent out' status)
  onUploadFiledVersion?: (id: string, name: string, hasExisting?: boolean) => void;
}

// ── Helpers ───────────────────────────────────────────────────────

function getCellValue(row: GridRow, field: EntityFieldConfig): CellValue {
  return row[field.supabaseColumn] ?? null;
}

export type AdminRow = Record<string, unknown>;

type CellValue = any;
type GridRow = Record<string, CellValue>;

function rowIdOf(row: AdminRow): string {
  return (row.notion_id ?? row.id) as string;
}

/** Batch actions send one request per row; this many at a time. */
const BATCH_CONCURRENCY = 4;

/** The archive this table writes and tests for, on any entity with a status column. */
const ARCHIVED = 'Archived';

/** Send one admin request per id, BATCH_CONCURRENCY at a time; resolves to how many failed. */
async function sendEach(ids: string[], request: (id: string) => Promise<Response>): Promise<number> {
  const ok = await mapLimit(ids, BATCH_CONCURRENCY, (id) => request(id).then((r) => r.ok, () => false));
  return ok.filter((x) => !x).length;
}

// ── Status / select pill colors ──────────────────────────────────
const PILL_COLORS: Record<string, string> = {
  // Client status
  'Prospective':      'bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-500/15 dark:text-blue-300 dark:ring-blue-500/30',
  'Active':           'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/30',
  'Inactive':         'bg-stone-100 text-stone-500 ring-stone-200 dark:bg-stone-500/15 dark:text-stone-400 dark:ring-stone-500/30',
  'Terminated':       'bg-red-50 text-red-600 ring-red-200 dark:bg-red-500/15 dark:text-red-300 dark:ring-red-500/30',
  // Matter status
  'Ongoing':          'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/30',
  'Archived':         'bg-stone-100 text-stone-400 ring-stone-200 dark:bg-stone-500/10 dark:text-stone-500 dark:ring-stone-500/20',
  // Deliverable status
  [DELIVERABLE_STATUS.NOT_STARTED]:      'bg-stone-100 text-stone-500 ring-stone-200 dark:bg-stone-500/15 dark:text-stone-400 dark:ring-stone-500/30',
  [DELIVERABLE_STATUS.DRAFTING]:         'bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-500/15 dark:text-sky-300 dark:ring-sky-500/30',
  [DELIVERABLE_STATUS.UNDER_REVIEW]:     'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/30',
  [DELIVERABLE_STATUS.REVISING]:         'bg-orange-50 text-orange-600 ring-orange-200 dark:bg-orange-500/15 dark:text-orange-300 dark:ring-orange-500/30',
  [DELIVERABLE_STATUS.FINALIZING]:       'bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-500/15 dark:text-violet-300 dark:ring-violet-500/30',
  [DELIVERABLE_STATUS.PRE_FINALIZED]:    'bg-purple-50 text-purple-600 ring-purple-200 dark:bg-purple-500/15 dark:text-purple-300 dark:ring-purple-500/30',
  [DELIVERABLE_STATUS.OUTBOX]:           'bg-indigo-50 text-indigo-600 ring-indigo-200 dark:bg-indigo-500/15 dark:text-indigo-300 dark:ring-indigo-500/30',
  [DELIVERABLE_STATUS.AWAITING_CLIENT]:  'bg-yellow-50 text-yellow-700 ring-yellow-200 dark:bg-yellow-500/15 dark:text-yellow-300 dark:ring-yellow-500/30',
  [DELIVERABLE_STATUS.FILED_OR_SENT_OUT]:'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/30',
  // Task status
  'In progress':      'bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-500/15 dark:text-sky-300 dark:ring-sky-500/30',
  'Done':             'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/30',
  // Priority
  'High':             'bg-red-50 text-red-600 ring-red-200 dark:bg-red-500/15 dark:text-red-300 dark:ring-red-500/30',
  'Medium':           'bg-amber-50 text-amber-600 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/30',
  'Low':              'bg-sky-50 text-sky-600 ring-sky-200 dark:bg-sky-500/15 dark:text-sky-300 dark:ring-sky-500/30',
  // Hearing status
  'Scheduled':        'bg-blue-50 text-blue-600 ring-blue-200 dark:bg-blue-500/15 dark:text-blue-300 dark:ring-blue-500/30',
  'Attended':         'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/30',
  'Cancelled':        'bg-red-50 text-red-500 ring-red-200 dark:bg-red-500/15 dark:text-red-300 dark:ring-red-500/30',
  'Postponed':        'bg-amber-50 text-amber-600 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/30',
  // Filing status
  'For Review':       'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/30',
  'Filed':            'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/30',
  // Meeting types
  'Internal Discussion': 'bg-stone-100 text-stone-600 ring-stone-200 dark:bg-stone-500/15 dark:text-stone-300 dark:ring-stone-500/30',
  'Client Meeting':   'bg-blue-50 text-blue-600 ring-blue-200 dark:bg-blue-500/15 dark:text-blue-300 dark:ring-blue-500/30',
  'Court Hearing':    'bg-red-50 text-red-600 ring-red-200 dark:bg-red-500/15 dark:text-red-300 dark:ring-red-500/30',
  'Conference':       'bg-violet-50 text-violet-600 ring-violet-200 dark:bg-violet-500/15 dark:text-violet-300 dark:ring-violet-500/30',
  // Hearing types
  'Initial Hearing':  'bg-blue-50 text-blue-600 ring-blue-200 dark:bg-blue-500/15 dark:text-blue-300 dark:ring-blue-500/30',
  'Pre-Trial':        'bg-amber-50 text-amber-600 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/30',
  'Trial':            'bg-red-50 text-red-600 ring-red-200 dark:bg-red-500/15 dark:text-red-300 dark:ring-red-500/30',
  'Promulgation':     'bg-violet-50 text-violet-600 ring-violet-200 dark:bg-violet-500/15 dark:text-violet-300 dark:ring-violet-500/30',
  'Motion Hearing':   'bg-indigo-50 text-indigo-600 ring-indigo-200 dark:bg-indigo-500/15 dark:text-indigo-300 dark:ring-indigo-500/30',
};

const DEFAULT_PILL = 'bg-stone-100 text-stone-600 ring-stone-200 dark:bg-stone-500/15 dark:text-stone-300 dark:ring-stone-500/30';

function SelectPill({ value }: { value: string }) {
  const colors = PILL_COLORS[value] ?? DEFAULT_PILL;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ring-1 ring-inset whitespace-nowrap ${colors}`}>
      {value}
    </span>
  );
}

function formatDisplayValue(value: CellValue, field: EntityFieldConfig): string {
  if (value == null || value === '') return '\u2014';
  if (field.type === 'date' || field.type === 'datetime') {
    try {
      const d = new Date(value);
      const dateStr = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: MANILA_TZ });
      if (field.type === 'datetime' && String(value).length > 10) {
        const timeStr = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: MANILA_TZ });
        return `${dateStr} ${timeStr}`;
      }
      return dateStr;
    } catch {
      return String(value);
    }
  }
  if (field.type === 'checkbox') return value ? 'Yes' : 'No';
  if (field.type === 'number') {
    const num = Number(value);
    if (!isNaN(num)) return num.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }
  return String(value);
}

const PAGE_SIZE_OPTIONS = [25, 50, 100, 200];

// ── Dropdown hook (click outside to close) ────────────────────────

function useDropdown() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      // CellDatePicker renders into a document.body portal, so a click on a
      // calendar day isn't a DOM descendant of this dropdown. Closing here
      // would unmount the picker on mousedown, before its click handler runs
      // — the date filters would never apply.
      if (target.closest('[data-cell-datepicker-portal]')) return;
      if (ref.current && !ref.current.contains(target)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick, true);
    return () => document.removeEventListener('mousedown', handleClick, true);
  }, [open]);

  return { open, setOpen, ref };
}

// ── Reviewer Order Dropdown ──────────────────────────────────────

function ReviewerOrderDropdown({
  options,
  value,
  peopleMap,
  onSelect,
  onClose,
  anchorRef,
}: {
  options: DropdownOption[];
  value: string[];
  peopleMap: Record<string, { name: string; initials: string }>;
  onSelect: (ids: string[]) => void;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
}) {
  const [orderedIds, setOrderedIds] = useState<string[]>(value);
  const [search, setSearch] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [position, setPosition] = useState({ top: -9999, left: -9999, width: 300 });

  useEffect(() => {
    if (!anchorRef.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    const w = Math.max(280, Math.min(rect.width + 60, 360));
    const viewH = window.innerHeight;
    const spaceBelow = viewH - rect.bottom;
    setPosition({
      top: spaceBelow > 400 ? rect.bottom + 4 : rect.top - 400 - 4,
      left: Math.max(8, Math.min(rect.left, window.innerWidth - w - 8)),
      width: w,
    });
  }, [anchorRef]);

  useEffect(() => {
    requestAnimationFrame(() => searchRef.current?.focus());
  }, []);

  useEffect(() => {
    function handleMouseDown(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        onSelect(orderedIds);
        onClose();
      }
    }
    document.addEventListener('mousedown', handleMouseDown, true);
    return () => document.removeEventListener('mousedown', handleMouseDown, true);
  }, [onClose, onSelect, orderedIds]);

  const getLabel = (i: number, total: number) => {
    if (total <= 1) return 'Reviewer';
    if (i === 0) return 'Initial';
    if (i === total - 1) return 'Final';
    return ['2nd', '3rd', '4th'][i - 1] ?? `${i + 1}th`;
  };

  const togglePerson = (id: string) => {
    setOrderedIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 5) return prev;
      return [...prev, id];
    });
  };

  const moveReviewer = (fromIdx: number, toIdx: number) => {
    setOrderedIds((prev) => {
      const next = [...prev];
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      return next;
    });
  };

  const searchLower = search.toLowerCase();
  const filtered = search
    ? options.filter((o) => o.label.toLowerCase().includes(searchLower) || (o.initials?.toLowerCase().includes(searchLower) ?? false))
    : options;

  return createPortal(
    <div
      ref={dropdownRef}
      className="fixed z-[9999]"
      style={{ top: position.top, left: position.left, width: position.width }}
      onKeyDown={(e) => { if (e.key === 'Escape') { onSelect(orderedIds); onClose(); } }}
    >
      <div
        className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-xl overflow-hidden animate-in fade-in slide-in-from-top-1 duration-150"
        style={{ boxShadow: '0 8px 30px -4px rgba(120,100,70,0.15), 0 4px 10px -4px rgba(120,100,70,0.08)' }}
      >
        {/* Current order */}
        {orderedIds.length > 0 && (
          <div className="px-3 py-2 border-b border-[var(--border-color)] bg-stone-50/50 dark:bg-stone-900/20">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500 mb-1.5">Review Order</p>
            <div className="space-y-1">
              {orderedIds.map((id, i) => {
                const person = peopleMap[id];
                return (
                  <div key={id} className="flex items-center gap-1.5 text-xs">
                    <div className="flex flex-col gap-0">
                      <button
                        type="button"
                        disabled={i === 0}
                        onClick={() => moveReviewer(i, i - 1)}
                        className={`text-[8px] leading-none px-0.5 ${i === 0 ? 'text-stone-200 dark:text-stone-700' : 'text-stone-400 hover:text-stone-600 cursor-pointer dark:text-stone-500 dark:hover:text-stone-300'}`}
                      >▲</button>
                      <button
                        type="button"
                        disabled={i === orderedIds.length - 1}
                        onClick={() => moveReviewer(i, i + 1)}
                        className={`text-[8px] leading-none px-0.5 ${i === orderedIds.length - 1 ? 'text-stone-200 dark:text-stone-700' : 'text-stone-400 hover:text-stone-600 cursor-pointer dark:text-stone-500 dark:hover:text-stone-300'}`}
                      >▼</button>
                    </div>
                    <span className="text-[10px] font-medium text-stone-400 dark:text-stone-500 w-10 shrink-0">
                      {getLabel(i, orderedIds.length)}
                    </span>
                    <span className="w-5 h-5 rounded-full bg-navy-100 text-navy-700 dark:bg-navy-500/15 dark:text-navy-300 text-[9px] font-bold flex items-center justify-center shrink-0">
                      {person?.initials ?? '–'}
                    </span>
                    <span className="flex-1 truncate text-stone-600 dark:text-stone-400">{person?.name ?? id}</span>
                    <button
                      type="button"
                      onClick={() => togglePerson(id)}
                      className="text-stone-300 hover:text-red-500 cursor-pointer dark:text-stone-600 dark:hover:text-red-400"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                );
              })}
            </div>
            {orderedIds.length >= 2 && (
              <p className="text-[9px] text-stone-400 dark:text-stone-500 mt-1.5 pt-1 border-t border-[var(--border-color)]">
                {orderedIds.map((id, i) => `${getLabel(i, orderedIds.length)} (${peopleMap[id]?.initials ?? FORMER_MEMBER})`).join(' → ')}
              </p>
            )}
          </div>
        )}

        {/* Search */}
        <div className="relative border-b border-[var(--border-color)]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-muted)] pointer-events-none" />
          <input
            ref={searchRef}
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={orderedIds.length >= 5 ? 'Max 5 reviewers' : 'Search people...'}
            disabled={orderedIds.length >= 5 && !search}
            className="w-full pl-9 pr-3 py-2.5 text-sm bg-transparent text-foreground placeholder:text-[var(--text-muted)] focus:outline-none disabled:opacity-50"
          />
        </div>

        {/* Options */}
        <div className="max-h-[180px] overflow-y-auto overscroll-contain py-1">
          {filtered.map((option) => {
            const isSelected = orderedIds.includes(option.id);
            const isDisabled = !isSelected && orderedIds.length >= 5;
            return (
              <button
                key={option.id}
                type="button"
                disabled={isDisabled}
                onClick={() => togglePerson(option.id)}
                className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-left text-sm transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                  isSelected ? 'bg-gold-50 dark:bg-gold-500/8' : 'hover:bg-[var(--subtle-bg)]'
                }`}
              >
                <span className={`shrink-0 flex items-center justify-center w-4 h-4 rounded-[4px] transition-all duration-100 ${
                  isSelected ? 'bg-gold-500 text-white shadow-sm' : 'border border-[var(--border-hover)] bg-transparent'
                }`}>
                  {isSelected && <Check className="w-2.5 h-2.5" strokeWidth={3} />}
                </span>
                {option.initials && (
                  <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-bold shrink-0 ${
                    isSelected ? 'bg-navy-700 text-white dark:bg-navy-500 dark:text-navy-50' : 'bg-navy-100 text-navy-600 dark:bg-navy-500/15 dark:text-navy-300'
                  }`}>
                    {option.initials}
                  </span>
                )}
                <span className="flex-1 min-w-0 truncate">
                  <span className={isSelected ? 'font-medium' : ''}>{option.label}</span>
                </span>
                {isSelected && (
                  <span className="text-[10px] text-stone-400 font-medium shrink-0 dark:text-stone-500">
                    {getLabel(orderedIds.indexOf(option.id), orderedIds.length)}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Footer */}
        <div className="border-t border-[var(--border-color)] px-3 py-2 flex items-center justify-between">
          <span className="text-xs text-[var(--text-muted)]">{orderedIds.length} reviewer{orderedIds.length !== 1 ? 's' : ''}</span>
          <button
            type="button"
            onClick={() => { onSelect(orderedIds); onClose(); }}
            className="text-xs font-medium text-gold-600 dark:text-gold-400 hover:text-gold-700 cursor-pointer px-2 py-0.5 rounded hover:bg-gold-50 dark:hover:bg-gold-500/10 transition-colors dark:hover:text-gold-300"
          >
            Done
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── Review Dates Dropdown ────────────────────────────────────────

function ReviewDatesDropdown({
  reviewerIds,
  dates,
  peopleMap,
  onSave,
  onClose,
  anchorRef,
}: {
  reviewerIds: string[];
  dates: (string | null)[];
  peopleMap: Record<string, { name: string; initials: string }>;
  onSave: (dates: (string | null)[]) => void;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
}) {
  const [localDates, setLocalDates] = useState<(string | null)[]>(() => {
    // Ensure array length matches reviewerIds
    const d = [...dates];
    while (d.length < reviewerIds.length) d.push(null);
    return d;
  });
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: -9999, left: -9999, width: 300 });

  useEffect(() => {
    // Use rAF to ensure the anchor ref is committed before reading position
    const frame = requestAnimationFrame(() => {
      if (!anchorRef.current) return;
      const rect = anchorRef.current.getBoundingClientRect();
      const w = 300;
      const viewH = window.innerHeight;
      const spaceBelow = viewH - rect.bottom;
      const dropdownH = 60 + reviewerIds.length * 44;
      setPosition({
        top: spaceBelow > dropdownH ? rect.bottom + 4 : rect.top - dropdownH - 4,
        left: Math.max(8, Math.min(rect.left, window.innerWidth - w - 8)),
        width: w,
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [anchorRef, reviewerIds.length]);

  useEffect(() => {
    function handleMouseDown(e: MouseEvent) {
      const target = e.target as HTMLElement | null;
      if (!dropdownRef.current || !target) return;
      if (dropdownRef.current.contains(target)) return;
      // Clicks inside a descendant date-picker portal (rendered to
      // document.body by CellDatePicker) must NOT be treated as "outside"
      // — otherwise the dropdown closes and saves stale state before the
      // picker's onChange has a chance to update localDates.
      if (target.closest('[data-cell-datepicker-portal]')) return;
      onSave(localDates);
      onClose();
    }
    // Defer listener so the opening click doesn't immediately close the dropdown
    const frame = requestAnimationFrame(() => {
      document.addEventListener('mousedown', handleMouseDown, true);
    });
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('mousedown', handleMouseDown, true);
    };
  }, [onClose, onSave, localDates]);

  const getLabel = (i: number, total: number) => {
    if (total <= 1) return 'Review';
    if (i === 0) return 'Initial';
    if (i === total - 1) return 'Final';
    return ['2nd', '3rd', '4th'][i - 1] ?? `${i + 1}th`;
  };

  if (reviewerIds.length === 0) {
    return createPortal(
      <div ref={dropdownRef} className="fixed z-[9999]" style={{ top: position.top, left: position.left, width: position.width }}>
        <div className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-xl p-4 text-center text-xs text-stone-400 dark:text-stone-500"
          style={{ boxShadow: '0 8px 30px -4px rgba(120,100,70,0.15)' }}>
          No reviewers assigned — add reviewers first
        </div>
      </div>,
      document.body,
    );
  }

  return createPortal(
    <div
      ref={dropdownRef}
      className="fixed z-[9999]"
      style={{ top: position.top, left: position.left, width: position.width }}
      onKeyDown={(e) => { if (e.key === 'Escape') { onSave(localDates); onClose(); } }}
    >
      <div
        className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-xl overflow-hidden animate-in fade-in slide-in-from-top-1 duration-150"
        style={{ boxShadow: '0 8px 30px -4px rgba(120,100,70,0.15), 0 4px 10px -4px rgba(120,100,70,0.08)' }}
      >
        <div className="px-3 py-2 border-b border-[var(--border-color)]">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500">Review Dates</p>
        </div>
        <div className="px-3 py-2 space-y-2">
          {reviewerIds.map((rid, i) => {
            const person = peopleMap[rid];
            const label = getLabel(i, reviewerIds.length);
            return (
              <div key={rid} className="flex items-center gap-2">
                <div className="flex items-center gap-1.5 w-24 shrink-0">
                  <span className="text-[10px] font-medium text-stone-400 dark:text-stone-500">{label}</span>
                  <span className="w-5 h-5 rounded-full bg-navy-100 text-navy-700 dark:bg-navy-500/15 dark:text-navy-300 text-[9px] font-bold flex items-center justify-center shrink-0">
                    {person?.initials ?? '–'}
                  </span>
                </div>
                <div className="flex-1">
                  <DatePickerInput
                    variant="cell"
                    value={localDates[i] ?? ''}
                    onChange={(v) => {
                      setLocalDates((prev) => {
                        const next = [...prev];
                        next[i] = v ?? null;
                        return next;
                      });
                    }}
                    placeholder="Select date"
                  />
                </div>
              </div>
            );
          })}
        </div>
        <div className="border-t border-[var(--border-color)] px-3 py-2 flex justify-end">
          <button
            type="button"
            onClick={() => { onSave(localDates); onClose(); }}
            className="text-xs font-medium text-gold-600 dark:text-gold-400 hover:text-gold-700 cursor-pointer px-2 py-0.5 rounded hover:bg-gold-50 dark:hover:bg-gold-500/10 transition-colors dark:hover:text-gold-300"
          >
            Done
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── Component ─────────────────────────────────────────────────────

export default function AdminDataTable({
  data,
  fields,
  entity,
  onRefresh,
  onPatchRows,
  onAdd,
  onBatchImport,
  onBulkUpload,
  page,
  pageSize,
  total,
  totalPages,
  onPageChange,
  onPageSizeChange,
  searchQuery,
  onSearchChange,
  sortKey,
  sortDir,
  onSort,
  filters,
  onFilterChange,
  onClearAllFilters,
  hiddenColumns,
  onToggleColumn,
  onShowAllColumns,
  readOnly = false,
  onOpenDetail,
  onCreateStatusReport,
  onUploadFiledVersion,
}: Props) {
  const [srLoadingId, setSrLoadingId] = useState<string | null>(null);
  const [srConfirmTarget, setSrConfirmTarget] = useState<{ id: string; name: string; hasSr: boolean } | null>(null);
  const [editingCell, setEditingCell] = useState<EditingCell>(null);
  const [editValue, setEditValue] = useState<CellValue>('');
  const [cellSaveStates, setCellSaveStates] = useState<Record<string, CellSaveState>>({});
  const [archiveTarget, setArchiveTarget] = useState<string | null>(null);
  const [renameConfirm, setRenameConfirm] = useState<{ notionId: string; column: string; value: unknown; message: string } | null>(null);
  const [archiveLoading, setArchiveLoading] = useState(false);
  // The newest save per cell: only it may roll the cell back.
  const latestSave = useRef(new Map<string, number>());

  // Batch selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchLoading, setBatchLoading] = useState(false);
  const [batchArchiveConfirm, setBatchArchiveConfirm] = useState<{ toArchive: string[]; toDelete: string[] } | null>(null);

  // Trademarks: changing status from the admin grid bypasses the
  // lifecycle action validation that the dashboard enforces. Confirm first.
  const [tmStatusConfirm, setTmStatusConfirm] = useState<{
    nid: string; from: string; to: string;
  } | null>(null);
  const [tmStatusSaving, setTmStatusSaving] = useState(false);
  const batchStatusDropdown = useDropdown();
  const selectAllRef = useRef<HTMLInputElement>(null);

  // Clear selection when data/page changes
  useEffect(() => { setSelectedIds(new Set()); }, [data, page]);

  const allPageIds = data.map((row) => row.notion_id ?? row.id);
  const allSelected = allPageIds.length > 0 && allPageIds.every((id: string) => selectedIds.has(id));
  const someSelected = allPageIds.some((id: string) => selectedIds.has(id)) && !allSelected;

  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someSelected;
  }, [someSelected]);

  const statusField = useMemo(
    () => fields.find((f) => f.key === 'status' && f.type === 'select' && f.editable),
    [fields],
  );

  function toggleSelectAll() {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(allPageIds));
    }
  }

  function toggleSelectRow(rowId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      return next;
    });
  }

  function handleBatchArchive() {
    // For deliverables, separate archived (to delete) from non-archived (to archive)
    const toDelete: string[] = [];
    const toArchive: string[] = [];
    if (entity === 'deliverables') {
      for (const id of selectedIds) {
        if (isRowArchived(id)) toDelete.push(id);
        else toArchive.push(id);
      }
    } else {
      toDelete.push(...selectedIds);
    }
    setBatchArchiveConfirm({ toArchive, toDelete });
  }

  async function executeBatchArchive() {
    if (!batchArchiveConfirm) return;
    const { toArchive, toDelete } = batchArchiveConfirm;
    const archiving = new Set(toArchive);
    const deleting = new Set(toDelete);
    if (onPatchRows) {
      onPatchRows((rows) =>
        rows
          .filter((r) => !deleting.has(rowIdOf(r)))
          .map((r) => (archiving.has(rowIdOf(r)) ? { ...r, status: ARCHIVED } : r)),
      );
      setSelectedIds(new Set());
      setBatchArchiveConfirm(null);
    } else {
      setBatchLoading(true);
    }
    try {
      const failed =
        (await sendEach(toArchive, (notionId) =>
          fetch(`/api/admin/${entity}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ notionId, field: 'status', value: ARCHIVED }),
          }),
        )) +
        (await sendEach(toDelete, (notionId) =>
          fetch(`/api/admin/${entity}`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ notionId }),
          }),
        ));
      const total = toArchive.length + toDelete.length;
      if (failed > 0) toast.error(`${failed} of ${total} rows could not be changed`);
      setSelectedIds(new Set());
    } catch (err) {
      console.error('Batch archive/delete failed:', err);
      toast.error('Batch archive/delete failed');
    } finally {
      onRefresh();
      setBatchLoading(false);
      setBatchArchiveConfirm(null);
    }
  }

  async function handleBatchStatusChange(newStatus: string) {
    if (!statusField) return;
    const column = statusField.supabaseColumn;
    const ids = new Set(selectedIds);
    batchStatusDropdown.setOpen(false);
    if (onPatchRows) {
      onPatchRows((rows) => rows.map((r) => (ids.has(rowIdOf(r)) ? { ...r, [column]: newStatus } : r)));
      setSelectedIds(new Set());
    } else {
      setBatchLoading(true);
    }
    try {
      const failed = await sendEach([...ids], (notionId) =>
        fetch(`/api/admin/${entity}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ notionId, field: column, value: newStatus }),
        }),
      );
      if (failed > 0) toast.error(`${failed} of ${ids.size} rows could not be updated`);
      setSelectedIds(new Set());
    } catch (err) {
      console.error('Batch status change failed:', err);
      toast.error('Batch status change failed');
    } finally {
      onRefresh();
      setBatchLoading(false);
    }
  }

  // File upload modal
  const [fileUpload, setFileUpload] = useState<{ notionId: string; files: { name: string; url: string; path?: string }[] } | null>(null);
  const [filePreview, setFilePreview] = useState<FileAttachment[] | null>(null);

  // Inline quick-add row
  const [inlineAddOpen, setInlineAddOpen] = useState(false);
  const [inlineValues, setInlineValues] = useState<Record<string, string>>({});
  const [inlineSaving, setInlineSaving] = useState(false);
  const inlineFirstRef = useRef<HTMLInputElement>(null);

  // Measure thead height so the plus button aligns with the first data row
  const theadRef = useRef<HTMLTableSectionElement>(null);
  const [theadHeight, setTheadHeight] = useState<number | null>(null);
  useEffect(() => {
    if (!theadRef.current) return;
    const ro = new ResizeObserver(([entry]) => setTheadHeight(entry.contentRect.height));
    ro.observe(theadRef.current);
    return () => ro.disconnect();
  }, []);

  // Synchronized top scrollbar
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const topTrackRef = useRef<HTMLDivElement>(null);
  const topThumbRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartScrollLeft = useRef(0);

  // Update custom top scrollbar thumb size + position
  const updateTopThumb = useCallback(() => {
    const table = tableScrollRef.current;
    const track = topTrackRef.current;
    const thumb = topThumbRef.current;
    if (!table || !track || !thumb) return;
    const { scrollWidth, clientWidth, scrollLeft } = table;
    if (scrollWidth <= clientWidth) {
      track.style.display = 'none';
      return;
    }
    track.style.display = '';
    const ratio = clientWidth / scrollWidth;
    const trackWidth = track.clientWidth;
    const thumbWidth = Math.max(ratio * trackWidth, 40);
    const maxThumbLeft = trackWidth - thumbWidth;
    const scrollRatio = scrollLeft / (scrollWidth - clientWidth);
    thumb.style.width = `${thumbWidth}px`;
    thumb.style.left = `${scrollRatio * maxThumbLeft}px`;
  }, []);

  useEffect(() => {
    const el = tableScrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => updateTopThumb());
    ro.observe(el);
    return () => ro.disconnect();
  }, [data, updateTopThumb]);

  const handleTableScroll = useCallback(() => {
    if (!dragging.current) updateTopThumb();
  }, [updateTopThumb]);

  // Drag the custom thumb to scroll the table
  useEffect(() => {
    const thumb = topThumbRef.current;
    const track = topTrackRef.current;
    const table = tableScrollRef.current;
    if (!thumb || !track || !table) return;

    const onMouseDown = (e: MouseEvent) => {
      e.preventDefault();
      dragging.current = true;
      dragStartX.current = e.clientX;
      dragStartScrollLeft.current = table.scrollLeft;
      document.body.style.userSelect = 'none';
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const { scrollWidth, clientWidth } = table;
      const trackWidth = track.clientWidth;
      const ratio = clientWidth / scrollWidth;
      const thumbWidth = Math.max(ratio * trackWidth, 40);
      const maxThumbLeft = trackWidth - thumbWidth;
      const maxScroll = scrollWidth - clientWidth;
      const dx = e.clientX - dragStartX.current;
      const scrollDelta = (dx / maxThumbLeft) * maxScroll;
      table.scrollLeft = dragStartScrollLeft.current + scrollDelta;
      updateTopThumb();
    };

    const onMouseUp = () => {
      dragging.current = false;
      document.body.style.userSelect = '';
    };

    // Click on track to jump
    const onTrackClick = (e: MouseEvent) => {
      if (e.target === thumb) return;
      const trackRect = track.getBoundingClientRect();
      const clickX = e.clientX - trackRect.left;
      const { scrollWidth, clientWidth } = table;
      const ratio = clickX / trackRect.width;
      table.scrollLeft = ratio * (scrollWidth - clientWidth);
      updateTopThumb();
    };

    thumb.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    track.addEventListener('click', onTrackClick);

    return () => {
      thumb.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      track.removeEventListener('click', onTrackClick);
    };
  }, [updateTopThumb]);

  // People lookup (person_id → { name, initials })
  const [peopleMap, setPeopleMap] = useState<Record<string, { name: string; initials: string }>>({});
  const [peopleList, setPeopleList] = useState<{ person_id: string; name: string; initials: string; active?: boolean; avatar_url?: string | null }[]>([]);
  const [peopleFetched, setPeopleFetched] = useState(false);

  // Relation options for inline add and multi-picker editing.
  // Each entry has id/name/optional code (for display) plus `scopeValues`,
  // a map of column-name → row value for every column any relation field
  // on the parent form might scope by. Multiple fields can target the same
  // entity with different scopeByField values (e.g. `related_matter_ids`
  // scopes matters by client_id while `parent_matter_name` scopes by the
  // parent row's related_matter_ids array), so we have to remember ALL
  // potential scope columns, not just the first field's.
  const [relationOptions, setRelationOptions] = useState<
    Record<string, { id: string; name: string; code?: string; scopeValues: Record<string, string | null> }[]>
  >({});

  const searchRef = useRef<HTMLInputElement>(null);
  const editInputRef = useRef<HTMLInputElement | HTMLSelectElement>(null);
  const editAnchorRef = useRef<HTMLElement | null>(null);

  // Active inline-add dropdown state
  const [inlineDropdownField, setInlineDropdownField] = useState<string | null>(null);
  const inlineDropdownAnchorRef = useRef<HTMLElement | null>(null);

  const columnsDropdown = useDropdown();
  const filterDropdown = useDropdown();

  // Visible fields
  const visibleFields = useMemo(
    () => fields.filter((f) => !hiddenColumns.has(f.supabaseColumn)),
    [fields, hiddenColumns],
  );

  // Filterable fields (select, checkbox, date, people)
  const filterableFields = useMemo(
    () => fields.filter((f) => f.type === 'select' || f.type === 'checkbox' || f.type === 'date' || f.type === 'datetime' || f.type === 'people'),
    [fields],
  );

  const activeFilterCount = Object.keys(filters).length;

  // Focus the edit input when editing starts
  useEffect(() => {
    if (editingCell && editInputRef.current) {
      editInputRef.current.focus();
      if (editInputRef.current instanceof HTMLInputElement && editInputRef.current.type === 'text') {
        editInputRef.current.select();
      }
    }
  }, [editingCell]);

  // Fetch people for initials display and inline editing
  useEffect(() => {
    if (peopleFetched) return;
    const hasPeopleFields = fields.some((f) => f.type === 'people');
    if (!hasPeopleFields) return;
    fetch('/api/people')
      .then((r) => r.json())
      .then((d) => {
        const list = d.people ?? [];
        setPeopleList(list);
        const map: Record<string, { name: string; initials: string }> = {};
        for (const p of list) map[p.person_id] = { name: p.name, initials: p.initials };
        setPeopleMap(map);
      })
      .catch(() => {})
      .finally(() => setPeopleFetched(true));
  }, [fields, peopleFetched]);

  // Fetch relation options for inline add and relation_multi editing.
  // We collect the union of every scopeByField used by any field pointing
  // at the same entity so a single fetch produces options usable by all
  // of them regardless of which field triggers the fetch first.
  useEffect(() => {
    const relationFields = fields.filter(
      (f) => (f.type === 'relation' || f.type === 'relation_multi') && f.relationEntity,
    );
    const scopeFieldsByEntity = new Map<string, Set<string>>();
    for (const f of relationFields) {
      if (!f.scopeByField) continue;
      const set = scopeFieldsByEntity.get(f.relationEntity!) ?? new Set<string>();
      set.add(f.scopeByField);
      scopeFieldsByEntity.set(f.relationEntity!, set);
    }
    const seen = new Set<string>();
    for (const field of relationFields) {
      const relEntity = field.relationEntity!;
      if (relationOptions[relEntity] || seen.has(relEntity)) continue;
      seen.add(relEntity);
      const scopeCols = Array.from(scopeFieldsByEntity.get(relEntity) ?? []);
      fetch(`/api/admin/${relEntity}?pageSize=500&sortBy=name&sortDir=asc`)
        .then((r) => r.json())
        .then((d) => {
          const items = (d.data ?? [])
            .filter((r: GridRow) => r.name)
            .map((r: GridRow) => {
              const scopeValues: Record<string, string | null> = {};
              for (const col of scopeCols) scopeValues[col] = r[col] ?? null;
              return {
                id: r.notion_id as string,
                name: r.name as string,
                code: r.matter_code || r.client_code || undefined,
                scopeValues,
              };
            });
          setRelationOptions((prev) => ({ ...prev, [relEntity]: items }));
        })
        .catch(() => {});
    }
  }, [fields, relationOptions]);

  // ── Dropdown option builders ─────────────────────────────────

  const peopleDropdownOptions: DropdownOption[] = useMemo(
    () => peopleList.filter((p) => p.active !== false).map((p) => ({
      id: p.person_id,
      label: p.name,
      initials: p.initials,
      avatarUrl: p.avatar_url ?? null,
    })),
    [peopleList],
  );

  function relationDropdownOptions(
    relEntity: string,
    scopeField?: string,
    scopeValue?: string | null | undefined,
    excludeId?: string | null | undefined,
    scopeRowArray?: string[] | null | undefined,
  ): DropdownOption[] {
    const allowedIds = Array.isArray(scopeRowArray) ? new Set(scopeRowArray) : null;
    return (relationOptions[relEntity] ?? [])
      .filter((item) => {
        if (excludeId && item.id === excludeId) return false;
        if (allowedIds && !allowedIds.has(item.id)) return false;
        if (!scopeField) return true;
        return (item.scopeValues[scopeField] ?? null) === (scopeValue ?? null);
      })
      .map((item) => ({
        id: item.name,
        label: item.name,
        sublabel: item.code ? `(${item.code})` : undefined,
      }));
  }

  // ID-keyed options for relation_multi (dropdown stores/returns notion_ids),
  // filtered to only the options that match the current row's scope value
  // when the field is scoped. Passing excludeId drops a specific row (so a
  // matter never lists itself as its own "related matter").
  function relationMultiOptions(
    relEntity: string,
    scopeField: string | undefined,
    scopeValue: string | null | undefined,
    excludeId: string | null | undefined,
  ): DropdownOption[] {
    const items = relationOptions[relEntity] ?? [];
    return items
      .filter((item) => {
        if (excludeId && item.id === excludeId) return false;
        if (!scopeField) return true;
        return (item.scopeValues[scopeField] ?? null) === (scopeValue ?? null);
      })
      .map((item) => ({
        id: item.id,
        label: item.name,
        sublabel: item.code ? `(${item.code})` : undefined,
      }));
  }

  // Lookup map from notion_id → display name for a relation entity, used
  // to render chips/pills for relation_multi cells.
  function relationIdNameMap(relEntity: string): Record<string, string> {
    const map: Record<string, string> = {};
    for (const item of relationOptions[relEntity] ?? []) map[item.id] = item.name;
    return map;
  }

  // ── Sort toggle ───────────────────────────────────────────────

  function toggleSort(colKey: string) {
    if (sortKey === colKey) {
      onSort(colKey, sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      onSort(colKey, 'asc');
    }
  }

  // ── Cell save state helpers ───────────────────────────────────

  const cellStateKey = useCallback(
    (rowId: string, fieldKey: string) => `${rowId}:${fieldKey}`,
    [],
  );

  function setCellState(rowId: string, fieldKey: string, state: CellSaveState) {
    const key = cellStateKey(rowId, fieldKey);
    setCellSaveStates((prev) => ({ ...prev, [key]: state }));
    if (state === 'saved') {
      setTimeout(() => {
        setCellSaveStates((prev) => ({ ...prev, [key]: 'idle' }));
      }, 1500);
    }
  }

  // ── Inline edit: start ────────────────────────────────────────

  function startEditing(row: GridRow, field: EntityFieldConfig, anchorEl?: HTMLElement) {
    if (!field.editable || field.type === 'checkbox') return;
    const notionId = row.notion_id ?? row.id;
    setEditingCell({ rowId: notionId, fieldKey: field.supabaseColumn });
    setEditValue(getCellValue(row, field) ?? '');
    if (anchorEl) editAnchorRef.current = anchorEl;
  }

  function cancelEditing() {
    setEditingCell(null);
    editAnchorRef.current = null;
    setEditValue('');
  }

  async function saveEdit(row: GridRow, field: EntityFieldConfig) {
    const notionId = row.notion_id ?? row.id;
    const originalValue = getCellValue(row, field);

    if (editValue === originalValue || (editValue === '' && originalValue == null)) {
      cancelEditing();
      return;
    }

    cancelEditing();
    await saveCell(notionId, field.supabaseColumn, editValue === '' ? null : editValue);
  }

  function patchCell(notionId: string, column: string, value: unknown) {
    onPatchRows?.((rows) => rows.map((r) => (rowIdOf(r) === notionId ? { ...r, [column]: value } : r)));
  }

  async function saveCell(notionId: string, column: string, value: unknown, confirmRename = false) {
    const previous = data.find((r) => rowIdOf(r) === notionId)?.[column] ?? null;
    const cellKey = `${notionId}:${column}`;
    const seq = (latestSave.current.get(cellKey) ?? 0) + 1;
    latestSave.current.set(cellKey, seq);
    // A newer save to the same cell owns it; this one only reports its failure.
    const rollBack = () => {
      if (latestSave.current.get(cellKey) === seq) patchCell(notionId, column, previous);
    };
    if (onPatchRows) patchCell(notionId, column, value);
    else setCellState(notionId, column, 'saving');

    try {
      const res = await fetch(`/api/admin/${entity}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notionId, field: column, value, ...(confirmRename && { confirmRename: true }) }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        if (err.code === CLIENT_RENAME_CONFIRM) {
          rollBack();
          setCellState(notionId, column, 'idle');
          setRenameConfirm({ notionId, column, value, message: err.error });
          return;
        }
        throw new Error(err.error ?? 'Save failed');
      }

      setCellState(notionId, column, onPatchRows ? 'idle' : 'saved');
      onRefresh();
    } catch (err) {
      console.error('Failed to save cell:', err);
      rollBack();
      // An earlier save to this cell may still be optimistic; the refetch settles it.
      if (onPatchRows) onRefresh();
      // Surface the server's message (e.g. the duplicate-client-name 409) so the
      // cell doesn't just silently revert with no explanation.
      toast.error(err instanceof Error ? err.message : 'Save failed');
      setCellState(notionId, column, 'idle');
    }
  }

  function toggleCheckbox(row: GridRow, field: EntityFieldConfig) {
    return saveCell(rowIdOf(row), field.supabaseColumn, !getCellValue(row, field));
  }

  function isRowArchived(rowId: string): boolean {
    const row = data.find((r) => (r.notion_id ?? r.id) === rowId);
    return row?.status === ARCHIVED;
  }

  async function handleArchive() {
    if (!archiveTarget) return;
    const target = archiveTarget;
    const softArchive = entity === 'deliverables' && !isRowArchived(target);
    const index = data.findIndex((r) => rowIdOf(r) === target);
    const original = data[index];
    if (onPatchRows) {
      onPatchRows((rows) =>
        softArchive
          ? rows.map((r) => (rowIdOf(r) === target ? { ...r, status: ARCHIVED } : r))
          : rows.filter((r) => rowIdOf(r) !== target),
      );
      setArchiveTarget(null);
    } else {
      setArchiveLoading(true);
    }

    try {
      // For deliverables that aren't already archived, soft-archive; otherwise hard delete
      if (softArchive) {
        const res = await fetch(`/api/admin/${entity}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ notionId: target, field: 'status', value: ARCHIVED }),
        });
        if (!res.ok) throw new Error('Archive failed');
      } else {
        const res = await fetch(`/api/admin/${entity}`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ notionId: target }),
        });
        if (!res.ok) throw new Error('Delete failed');
      }
      onRefresh();
    } catch (err) {
      console.error('Failed to archive/delete:', err);
      // Undo only this row, keeping any edits made to others meanwhile.
      if (original) {
        onPatchRows?.((rows) =>
          softArchive
            ? rows.map((r) => (rowIdOf(r) === target ? { ...r, status: original.status } : r))
            : rows.some((r) => rowIdOf(r) === target)
              ? rows
              : [...rows.slice(0, index), original, ...rows.slice(index)],
        );
      }
      toast.error(err instanceof Error ? err.message : 'Archive failed');
    } finally {
      setArchiveLoading(false);
      setArchiveTarget(null);
    }
  }

  // ── Inline quick-add ──────────────────────────────────────────

  function openInlineAdd() {
    const initial: Record<string, string> = {};
    for (const f of fields) {
      if (f.defaultValue) initial[f.key] = f.defaultValue;
    }
    setInlineValues(initial);
    setInlineAddOpen(true);
    setTimeout(() => inlineFirstRef.current?.focus(), 50);
  }

  function cancelInlineAdd() {
    setInlineAddOpen(false);
    setInlineValues({});
    setInlineDropdownField(null);
  }

  async function saveInlineAdd() {
    // Check required fields
    const missing = fields.find((f) => f.required && !inlineValues[f.key]);
    if (missing) return;

    setInlineSaving(true);
    try {
      const submitRow: Record<string, unknown> = { ...inlineValues };
      // Convert comma-separated multi-people fields to arrays
      for (const f of fields) {
        if (f.type === 'people' && f.peopleMultiple && submitRow[f.key]) {
          const val = String(submitRow[f.key]);
          submitRow[f.key] = val.split(',').filter(Boolean);
        }
      }
      // Auto-set currently_with to drafters for deliverables
      if (entity === 'deliverables' && submitRow.drafter_ids && !submitRow.currently_with_ids) {
        submitRow.currently_with_ids = submitRow.drafter_ids;
      }
      const res = await fetch(`/api/admin/${entity}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ row: submitRow }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to create');
      }
      cancelInlineAdd();
      onRefresh();
    } catch (err) {
      console.error('Inline add failed:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to create');
    } finally {
      setInlineSaving(false);
    }
  }

  function handleInlineKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      saveInlineAdd();
    } else if (e.key === 'Escape') {
      cancelInlineAdd();
    }
  }

  function handleEditKeyDown(e: React.KeyboardEvent, row: GridRow, field: EntityFieldConfig) {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveEdit(row, field);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelEditing();
    }
  }

  // ── Render editable cell ──────────────────────────────────────

  function renderCell(row: any, field: EntityFieldConfig) {
    const notionId = row.notion_id ?? row.id;
    const stateKey = cellStateKey(notionId, field.supabaseColumn);
    const saveState = cellSaveStates[stateKey] ?? 'idle';
    const value = getCellValue(row, field);
    const isEditing =
      editingCell?.rowId === notionId &&
      editingCell?.fieldKey === field.supabaseColumn;

    if (saveState === 'saving') {
      return (
        <span className="inline-flex items-center gap-1.5 text-sm text-stone-400 dark:text-stone-500">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        </span>
      );
    }
    if (saveState === 'saved') {
      return (
        <span className="inline-flex items-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-400">
          <Check className="w-3.5 h-3.5" />
        </span>
      );
    }

    if (entity === 'status_reports' && field.key === 'related_parent_name') {
      const parentKind: 'hearing' | 'filing' | 'file' | null = row.related_hearing_id
        ? 'hearing'
        : row.source_deliverable_id
          ? 'filing'
          : row.source_file_id
            ? 'file'
            : null;
      const parentId: string | null =
        row.related_hearing_id ?? row.source_deliverable_id ?? row.source_file_id ?? null;
      const rawLabel = typeof row.related_parent_name === 'string' ? row.related_parent_name : null;
      const parentName = rawLabel ? rawLabel.replace(/^(Hearing|Filing|File)\s*·\s*/, '') : null;
      return (
        <StatusReportParentEditor
          statusReportId={row.notion_id ?? row.id}
          matterId={row.matter_id ?? null}
          parentKind={parentKind}
          parentId={parentId}
          parentName={parentName}
          onSaved={onRefresh}
        />
      );
    }

    if (field.type === 'checkbox') {
      return (
        <input
          type="checkbox"
          checked={!!value}
          onChange={() => field.editable && toggleCheckbox(row, field)}
          disabled={!field.editable}
          className="rounded border-stone-300 text-gold-600 focus:ring-gold-300 cursor-pointer disabled:opacity-50 disabled:cursor-default dark:border-stone-600 dark:text-gold-400 dark:focus:ring-gold-500/40"
        />
      );
    }

    if (isEditing) {
      const commonClasses =
        'w-full bg-white text-stone-700 text-sm border-0 outline-none ring-2 ring-gold-400 rounded-md px-2 py-1 dark:bg-stone-800 dark:text-stone-100';

      // Review dates inline editing — portal with per-reviewer date pickers
      if (field.key === 'review_dates') {
        const nid = row.notion_id ?? row.id;
        const rvIds: string[] = Array.isArray(row.reviewer_ids) ? row.reviewer_ids : [];
        const rvDates: (string | null)[] = Array.isArray(value) ? value : [];
        const rvGetLabel = (i: number, total: number) => {
          if (total === 1) return '';
          if (i === 0) return 'Initial';
          if (i === total - 1) return 'Final';
          return ['2nd', '3rd', '4th'][i - 1] ?? `${i + 1}th`;
        };
        const rvFmt = (d: string) => {
          const dt = new Date(d + 'T00:00:00');
          return isNaN(dt.getTime()) ? d : dt.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
        };
        return (
          <div className="ring-2 ring-gold-400 rounded-md px-1 -mx-1 min-h-[28px]">
            <div className="flex flex-col gap-0.5">
              {(rvIds.length > 0 ? rvIds : rvDates).map((_, i) => {
                const label = rvGetLabel(i, rvIds.length || rvDates.length);
                const d = rvDates[i];
                return (
                  <span key={i} className="text-xs text-stone-600 dark:text-stone-400">
                    {label && <span className="text-[10px] text-stone-400 dark:text-stone-500 font-medium mr-1">{label}:</span>}
                    {d ? rvFmt(d) : '—'}
                  </span>
                );
              })}
            </div>
            <ReviewDatesDropdown
              reviewerIds={rvIds}
              dates={rvDates}
              peopleMap={peopleMap}
              onSave={(newDates) => {
                cancelEditing();
                void saveCell(nid, field.supabaseColumn, newDates);
              }}
              onClose={cancelEditing}
              anchorRef={editAnchorRef}
            />
          </div>
        );
      }

      // People field editing — searchable dropdown portal
      if (field.type === 'people') {
        const isSingle = !field.peopleMultiple;
        const nid = row.notion_id ?? row.id;

        function savePeopleEdit(newValue: string | string[] | null) {
          cancelEditing();
          // Multi-select people columns are stored as NOT NULL text[] — always
          // send an array (possibly empty) to avoid a 23502 on the server.
          // Single-person columns are nullable text, so null is fine.
          const patchValue = isSingle
            ? (newValue || null)
            : Array.isArray(newValue)
              ? newValue
              : [];
          void saveCell(nid, field.supabaseColumn, patchValue);
        }

        if (isSingle) {
          return (
            <>
              <span className="text-sm text-stone-400 dark:text-stone-500">{peopleMap[value as string]?.initials ?? '—'}</span>
              <CellDropdown
                mode="single"
                options={peopleDropdownOptions}
                value={(value as string) || null}
                onSelect={(id) => savePeopleEdit(id)}
                onClose={cancelEditing}
                anchorRef={editAnchorRef}
                placeholder="Search people..."
              />
            </>
          );
        }
        const currentIds: string[] = Array.isArray(value) ? value : (value ? String(value).split(',') : []);

        // Reviewer field: use ordered dropdown that preserves array order
        if (field.key === 'reviewer_ids') {
          return (
            <>
              <span className="text-sm text-stone-400 dark:text-stone-500">{currentIds.length} selected</span>
              <ReviewerOrderDropdown
                options={peopleDropdownOptions}
                value={currentIds}
                peopleMap={peopleMap}
                onSelect={(ids) => savePeopleEdit(ids)}
                onClose={cancelEditing}
                anchorRef={editAnchorRef}
              />
            </>
          );
        }

        return (
          <>
            <span className="text-sm text-stone-400 dark:text-stone-500">{currentIds.length} selected</span>
            <CellDropdown
              mode="multi"
              options={peopleDropdownOptions}
              value={currentIds}
              onSelect={(ids) => savePeopleEdit(ids)}
              onClose={cancelEditing}
              anchorRef={editAnchorRef}
              placeholder="Search people..."
            />
          </>
        );
      }

      // Relation-multi field editing — multi-select dropdown scoped to same parent
      if (field.type === 'relation_multi' && field.relationEntity) {
        const nid = row.notion_id ?? row.id;
        const currentIds: string[] = Array.isArray(value)
          ? (value as string[])
          : value
            ? String(value).split(',').filter(Boolean)
            : [];
        const scopeValue = field.scopeByField
          ? (row[field.scopeByField] as string | null | undefined)
          : undefined;
        const options = relationMultiOptions(
          field.relationEntity,
          field.scopeByField,
          scopeValue,
          nid,
        );
        return (
          <>
            <span className="text-sm text-stone-400 dark:text-stone-500">{currentIds.length} selected</span>
            <CellDropdown
              mode="multi"
              options={options}
              value={currentIds}
              onSelect={(ids) => {
                cancelEditing();
                // Always send an array (never null) — some tables have a
                // NOT NULL constraint on array columns and use [] as empty.
                void saveCell(nid, field.supabaseColumn, ids);
              }}
              onClose={cancelEditing}
              anchorRef={editAnchorRef}
              placeholder={`Search ${field.label.toLowerCase()}...`}
            />
          </>
        );
      }

      // Relation field editing — searchable dropdown portal
      if (field.type === 'relation' && field.relationEntity) {
        const nid = row.notion_id ?? row.id;
        const scopeValue = field.scopeByField
          ? (row[field.scopeByField] as string | null | undefined)
          : undefined;
        const scopeRowArray = field.scopeByRowArray
          ? (row[field.scopeByRowArray] as string[] | null | undefined)
          : undefined;
        return (
          <>
            <span className="text-sm text-stone-400 dark:text-stone-500">{value ?? '—'}</span>
            <CellDropdown
              mode="single"
              options={relationDropdownOptions(field.relationEntity, field.scopeByField, scopeValue, nid, scopeRowArray)}
              value={(value as string) || null}
              onSelect={(id) => {
                cancelEditing();
                void saveCell(nid, field.supabaseColumn, id || null);
              }}
              onClose={cancelEditing}
              anchorRef={editAnchorRef}
              placeholder={`Search ${field.label.toLowerCase()}...`}
            />
          </>
        );
      }

      if (field.type === 'select' && field.options) {
        const nid = row.notion_id ?? row.id;
        const selectOptions: DropdownOption[] = field.options.map((opt) => ({ id: opt, label: opt }));
        const isTmStatus = entity === 'trademarks' && field.supabaseColumn === 'status';
        return (
          <>
            {value ? <SelectPill value={String(value)} /> : <span className="text-sm text-stone-400 dark:text-stone-500">—</span>}
            <CellDropdown
              mode="single"
              options={selectOptions}
              value={(value as string) || null}
              onSelect={(id) => {
                cancelEditing();
                // Trademarks: changing status from admin grid bypasses the
                // lifecycle state machine. Confirm before persisting.
                if (isTmStatus && id && id !== value) {
                  setTmStatusConfirm({
                    nid,
                    from: String(value ?? ''),
                    to: String(id),
                  });
                  return;
                }
                void saveCell(nid, field.supabaseColumn, id || null);
              }}
              onClose={cancelEditing}
              anchorRef={editAnchorRef}
              placeholder={`Search ${field.label.toLowerCase()}...`}
            />
          </>
        );
      }

      if (field.type === 'date' || field.type === 'datetime') {
        const nid = row.notion_id ?? row.id;
        const isDateTime = field.type === 'datetime';
        return (
          <>
            <span className="text-sm text-stone-400 dark:text-stone-500">{value ? formatDisplayValue(value, field) : '—'}</span>
            <CellDatePicker
              value={isDateTime ? (value ? String(value) : null) : (value ? String(value).slice(0, 10) : null)}
              showTime={isDateTime}
              onSelect={(date) => {
                cancelEditing();
                void saveCell(nid, field.supabaseColumn, date || null);
              }}
              onClose={cancelEditing}
              anchorRef={editAnchorRef}
            />
          </>
        );
      }

      if (field.type === 'number') {
        return (
          <input
            ref={editInputRef as React.RefObject<HTMLInputElement>}
            type="number"
            value={editValue ?? ''}
            onChange={(e) => setEditValue(e.target.valueAsNumber || e.target.value)}
            onBlur={() => saveEdit(row, field)}
            onKeyDown={(e) => handleEditKeyDown(e, row, field)}
            className={commonClasses}
          />
        );
      }

      return (
        <input
          ref={editInputRef as React.RefObject<HTMLInputElement>}
          type="text"
          value={editValue ?? ''}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={() => saveEdit(row, field)}
          onKeyDown={(e) => handleEditKeyDown(e, row, field)}
          className={commonClasses}
        />
      );
    }

    // ── Display mode ──

    // People fields: show initials
    if (field.type === 'people') {
      const ids: string[] = Array.isArray(value) ? value : (value ? String(value).split(',') : []);
      const validIds = ids.filter((id) => id && id !== '');
      const isReviewerField = field.key === 'reviewer_ids';
      if (validIds.length === 0) {
        if (!field.editable) return <span className="text-sm text-stone-400 dark:text-stone-500">{'\u2014'}</span>;
        return (
          <div onClick={(e) => startEditing(row, field, e.currentTarget)} className="group/cell flex items-center min-h-[28px] cursor-pointer rounded px-1 -mx-1 hover:bg-stone-50 dark:hover:bg-stone-800/40 transition-colors">
            <span className="text-sm text-stone-400 dark:text-stone-500">{'\u2014'}</span>
          </div>
        );
      }
      if (isReviewerField) {
        // Numbered reviewer display showing order and role
        const getLabel = (i: number, total: number) => {
          if (total === 1) return '';
          if (i === 0) return 'Initial';
          if (i === total - 1) return 'Final';
          return ['2nd', '3rd', '4th'][i - 1] ?? `${i + 1}th`;
        };
        return (
          <div
            onClick={(e) => field.editable ? startEditing(row, field, e.currentTarget) : undefined}
            className={`flex items-center gap-1 flex-wrap min-h-[28px] ${field.editable ? 'cursor-pointer rounded px-1 -mx-1 hover:bg-stone-50 dark:hover:bg-stone-800/40 transition-colors' : ''}`}
            title={validIds.map((id, i) => {
              const name = peopleMap[id]?.name ?? id;
              const label = getLabel(i, validIds.length);
              return label ? `${label}: ${name}` : name;
            }).join(' → ')}
          >
            {validIds.map((id, i) => {
              const person = peopleMap[id];
              const label = getLabel(i, validIds.length);
              return (
                <span
                  key={id}
                  className="inline-flex items-center gap-0.5 shrink-0"
                >
                  {i > 0 && <span className="text-stone-300 dark:text-stone-600 text-[10px] mx-0.5">→</span>}
                  <span
                    className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-navy-100 text-navy-700 dark:bg-navy-500/15 dark:text-navy-300 text-[10px] font-bold"
                    title={`${label ? label + ': ' : ''}${person?.name ?? FORMER_MEMBER}`}
                  >
                    {person?.initials ?? '–'}
                  </span>
                  {label && (
                    <span className="text-[9px] text-stone-400 dark:text-stone-500 font-medium">{label}</span>
                  )}
                </span>
              );
            })}
          </div>
        );
      }
      return (
        <div
          onClick={(e) => field.editable ? startEditing(row, field, e.currentTarget) : undefined}
          className={`flex items-center gap-1 flex-wrap min-h-[28px] ${field.editable ? 'cursor-pointer rounded px-1 -mx-1 hover:bg-stone-50 dark:hover:bg-stone-800/40 transition-colors' : ''}`}
          title={validIds.map((id) => peopleMap[id]?.name ?? id).join(', ')}
        >
          {validIds.map((id) => {
            const person = peopleMap[id];
            return (
              <span
                key={id}
                className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-navy-100 text-navy-700 dark:bg-navy-500/15 dark:text-navy-300 text-[10px] font-bold shrink-0"
                title={person?.name ?? FORMER_MEMBER}
              >
                {person?.initials ?? '–'}
              </span>
            );
          })}
        </div>
      );
    }

    // Relation multi: render name chips from stored notion_ids
    if (field.type === 'relation_multi' && field.relationEntity) {
      const ids: string[] = Array.isArray(value)
        ? (value as string[])
        : value
          ? String(value).split(',').filter(Boolean)
          : [];
      const nameMap = relationIdNameMap(field.relationEntity);
      if (ids.length === 0) {
        if (!field.editable) return <span className="text-sm text-stone-400 dark:text-stone-500">{'\u2014'}</span>;
        return (
          <div
            onClick={(e) => startEditing(row, field, e.currentTarget)}
            className="group/cell flex items-center min-h-[28px] cursor-pointer rounded px-1 -mx-1 hover:bg-stone-50 dark:hover:bg-stone-800/40 transition-colors"
          >
            <span className="text-sm text-stone-400 dark:text-stone-500">{'\u2014'}</span>
          </div>
        );
      }
      return (
        <div
          onClick={(e) =>
            field.editable ? startEditing(row, field, e.currentTarget) : undefined
          }
          className={`flex items-center gap-1 flex-wrap min-h-[28px] ${
            field.editable
              ? 'cursor-pointer rounded px-1 -mx-1 hover:bg-stone-50 dark:hover:bg-stone-800/40 transition-colors'
              : ''
          }`}
          title={ids.map((id) => nameMap[id] ?? id).join(', ')}
        >
          {ids.map((id) => (
            <span
              key={id}
              className="inline-flex items-center px-1.5 py-0.5 rounded-md bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-300 text-[11px] font-medium max-w-[160px] truncate"
            >
              {nameMap[id] ?? '(unknown)'}
            </span>
          ))}
        </div>
      );
    }

    // Review dates array: show as labeled date chips
    if (field.key === 'review_dates') {
      const dates: (string | null)[] = Array.isArray(value) ? value : [];
      const reviewerIds: string[] = Array.isArray(row.reviewer_ids) ? row.reviewer_ids : [];
      const getLabel = (i: number, total: number) => {
        if (total === 1) return '';
        if (i === 0) return 'Initial';
        if (i === total - 1) return 'Final';
        return ['2nd', '3rd', '4th'][i - 1] ?? `${i + 1}th`;
      };
      const fmt = (d: string) => {
        const dt = new Date(d + 'T00:00:00');
        return isNaN(dt.getTime()) ? d : dt.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
      };
      if (dates.length === 0 && reviewerIds.length === 0) {
        if (!field.editable) return <span className="text-sm text-stone-400 dark:text-stone-500">{'\u2014'}</span>;
        return (
          <div onClick={(e) => startEditing(row, field, e.currentTarget)} className="group/cell flex items-center min-h-[28px] cursor-pointer rounded px-1 -mx-1 hover:bg-stone-50 dark:hover:bg-stone-800/40 transition-colors">
            <span className="text-sm text-stone-400 dark:text-stone-500">{'\u2014'}</span>
          </div>
        );
      }
      const content = (
        <div className="flex flex-col gap-0.5" title={dates.filter(Boolean).map((d, i) => `${getLabel(i, reviewerIds.length || dates.length)}: ${d}`).join(', ')}>
          {(reviewerIds.length > 0 ? reviewerIds : dates).map((_, i) => {
            const label = getLabel(i, reviewerIds.length || dates.length);
            const d = dates[i];
            return (
              <span key={i} className="text-xs text-stone-600 dark:text-stone-400">
                {label && <span className="text-[10px] text-stone-400 dark:text-stone-500 font-medium mr-1">{label}:</span>}
                {d ? fmt(d) : '—'}
              </span>
            );
          })}
        </div>
      );
      if (!field.editable) return content;
      return (
        <div
          onClick={(e) => startEditing(row, field, e.currentTarget)}
          className="cursor-pointer rounded px-1 -mx-1 hover:bg-stone-50 dark:hover:bg-stone-800/40 transition-colors min-h-[28px]"
        >
          {content}
        </div>
      );
    }

    // Select fields render as pills
    if (field.type === 'select') {
      if (!value || value === '') {
        if (!field.editable) return <span className="text-sm text-stone-400 dark:text-stone-500">—</span>;
        return (
          <div
            onClick={(e) => startEditing(row, field, e.currentTarget)}
            className="group/cell flex items-center gap-1.5 min-h-[28px] cursor-pointer rounded px-1 -mx-1 hover:bg-stone-50 dark:hover:bg-stone-800/40 transition-colors duration-100"
          >
            <span className="text-sm text-stone-400 dark:text-stone-500">—</span>
            <Pencil className="w-3 h-3 text-stone-400 dark:text-stone-500 opacity-0 group-hover/cell:opacity-100 transition-opacity duration-100 shrink-0" />
          </div>
        );
      }
      if (!field.editable) return <SelectPill value={String(value)} />;
      return (
        <div
          onClick={(e) => startEditing(row, field, e.currentTarget)}
          className="group/cell flex items-center gap-1.5 min-h-[28px] cursor-pointer rounded px-1 -mx-1 hover:bg-stone-50 dark:hover:bg-stone-800/40 transition-colors duration-100"
        >
          <SelectPill value={String(value)} />
          <Pencil className="w-3 h-3 text-stone-400 dark:text-stone-500 opacity-0 group-hover/cell:opacity-100 transition-opacity duration-100 shrink-0" />
        </div>
      );
    }

    // Files field: preview + upload buttons
    if (field.type === 'files') {
      const files: FileAttachment[] = Array.isArray(value) ? value : (typeof value === 'string' ? (() => { try { return JSON.parse(value); } catch { return []; } })() : []);
      const notionId = row.notion_id as string;
      return (
        <div className="inline-flex items-center gap-1.5">
          {files && files.length > 0 && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setFilePreview(files); }}
              className="inline-flex items-center gap-1 text-sm text-stone-500 dark:text-stone-400 hover:text-navy-600 dark:hover:text-navy-300 transition-colors cursor-pointer"
              title={`Preview ${files.length} file${files.length > 1 ? 's' : ''}`}
            >
              <Eye className="w-3.5 h-3.5" />
              <span className="tabular-nums">{files.length}</span>
            </button>
          )}
          {!readOnly && (
            <button
              type="button"
              onClick={() => setFileUpload({ notionId, files: files || [] })}
              className="inline-flex items-center gap-1 text-sm text-stone-400 dark:text-stone-500 hover:text-navy-600 dark:hover:text-navy-300 transition-colors cursor-pointer"
              title={files?.length ? 'Manage files' : 'Upload files'}
            >
              <Upload className="w-3.5 h-3.5" />
            </button>
          )}
          {!files?.length && (
            <span className="text-sm text-stone-400 dark:text-stone-500">&mdash;</span>
          )}
        </div>
      );
    }

    const displayValue = formatDisplayValue(value, field);

    if (!field.editable) {
      return <span className="text-sm text-stone-700 dark:text-stone-300">{displayValue}</span>;
    }

    return (
      <div
        onClick={(e) => startEditing(row, field, e.currentTarget)}
        className="group/cell flex items-center gap-1.5 min-h-[28px] cursor-pointer rounded px-1 -mx-1 hover:bg-stone-50 dark:hover:bg-stone-800/40 transition-colors duration-100"
      >
        <span className="text-sm text-stone-700 dark:text-stone-300 truncate">{displayValue}</span>
        <Pencil className="w-3 h-3 text-stone-400 dark:text-stone-500 opacity-0 group-hover/cell:opacity-100 transition-opacity duration-100 shrink-0" />
      </div>
    );
  }

  // ── Filter rendering per field ─────────────────────────────────

  function renderFilterControl(field: EntityFieldConfig) {
    const col = field.supabaseColumn;

    if (field.type === 'select' && field.options) {
      const currentValue = filters[col] ?? '';
      const allOptions = ['', ...field.options];
      return (
        <div key={col} className="space-y-1.5">
          <label className="text-xs font-medium text-stone-500 dark:text-stone-400">{field.label}</label>
          <div className="flex flex-wrap gap-1.5">
            {allOptions.map((opt) => {
              const isActive = currentValue === opt;
              const label = opt || 'All';
              if (opt === '') {
                return (
                  <button
                    key="__all__"
                    type="button"
                    onClick={() => onFilterChange(col, '')}
                    className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ring-1 ring-inset whitespace-nowrap cursor-pointer transition-colors ${
                      isActive
                        ? 'bg-stone-700 text-white ring-stone-700 dark:bg-stone-600 dark:text-white dark:ring-stone-500'
                        : 'bg-white text-stone-500 ring-stone-200 hover:bg-stone-50 dark:bg-stone-900 dark:text-stone-400 dark:ring-stone-700 dark:hover:bg-stone-800'
                    }`}
                  >
                    {label}
                  </button>
                );
              }
              const pillColors = PILL_COLORS[opt] ?? DEFAULT_PILL;
              return (
                <button
                  key={opt}
                  type="button"
                  onClick={() => onFilterChange(col, opt)}
                  className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ring-1 ring-inset whitespace-nowrap cursor-pointer transition-opacity ${pillColors} ${
                    isActive ? 'opacity-100' : 'opacity-40 hover:opacity-70'
                  }`}
                >
                  {opt}
                </button>
              );
            })}
          </div>
        </div>
      );
    }

    if (field.type === 'checkbox') {
      const currentValue = filters[col] ?? '';
      const checkboxOptions = [
        { value: '', label: 'All' },
        { value: 'true', label: 'Yes' },
        { value: 'false', label: 'No' },
      ];
      return (
        <div key={col} className="space-y-1.5">
          <label className="text-xs font-medium text-stone-500 dark:text-stone-400">{field.label}</label>
          <div className="flex flex-wrap gap-1.5">
            {checkboxOptions.map(({ value: optVal, label }) => {
              const isActive = currentValue === optVal;
              return (
                <button
                  key={optVal || '__all__'}
                  type="button"
                  onClick={() => onFilterChange(col, optVal)}
                  className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ring-1 ring-inset whitespace-nowrap cursor-pointer transition-colors ${
                    isActive
                      ? 'bg-stone-700 text-white ring-stone-700'
                      : 'bg-white text-stone-500 ring-stone-200 hover:bg-stone-50 dark:bg-stone-900 dark:text-stone-400 dark:ring-stone-700 dark:hover:bg-stone-800'
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      );
    }

    if (field.type === 'people') {
      const currentValue = filters[col] ?? '';
      const activePeople = peopleList.filter((p) => p.active !== false);
      return (
        <div key={col} className="space-y-1.5">
          <label className="text-xs font-medium text-stone-500 dark:text-stone-400">{field.label}</label>
          <div className="flex flex-wrap gap-1.5">
            <button
              key="__all__"
              type="button"
              onClick={() => onFilterChange(col, '')}
              className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ring-1 ring-inset whitespace-nowrap cursor-pointer transition-colors ${
                !currentValue
                  ? 'bg-stone-700 text-white ring-stone-700 dark:bg-stone-600 dark:text-white dark:ring-stone-500'
                  : 'bg-white text-stone-500 ring-stone-200 hover:bg-stone-50 dark:bg-stone-900 dark:text-stone-400 dark:ring-stone-700 dark:hover:bg-stone-800'
              }`}
            >
              All
            </button>
            {activePeople.map((p) => (
              <button
                key={p.person_id}
                type="button"
                onClick={() => onFilterChange(col, p.person_id)}
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ring-1 ring-inset whitespace-nowrap cursor-pointer transition-colors ${
                  currentValue === p.person_id
                    ? 'bg-stone-700 text-white ring-stone-700 dark:bg-stone-600 dark:text-white dark:ring-stone-500'
                    : 'bg-white text-stone-500 ring-stone-200 hover:bg-stone-50 dark:bg-stone-900 dark:text-stone-400 dark:ring-stone-700 dark:hover:bg-stone-800'
                }`}
              >
                <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-gold-100 text-gold-700 dark:bg-gold-500/15 dark:text-gold-300 text-[9px] font-bold leading-none">{p.initials}</span>
                {p.name}
              </button>
            ))}
          </div>
        </div>
      );
    }

    if (field.type === 'date' || field.type === 'datetime') {
      const gteKey = `${col}.gte`;
      const lteKey = `${col}.lte`;
      const fromVal = filters[gteKey] ?? '';
      const toVal = filters[lteKey] ?? '';
      return (
        <div key={col} className="space-y-1.5">
          <label className="text-xs font-medium text-stone-500 dark:text-stone-400">{field.label}</label>
          <div className="flex items-center gap-1.5">
            <DatePickerInput
              variant="filter"
              value={fromVal || null}
              onChange={(v) => onFilterChange(gteKey, v ?? '')}
              placeholder="From"
              className="flex-1"
            />
            <span className="text-xs text-stone-400 dark:text-stone-500">to</span>
            <DatePickerInput
              variant="filter"
              value={toVal || null}
              onChange={(v) => onFilterChange(lteKey, v ?? '')}
              placeholder="To"
              className="flex-1"
            />
          </div>
        </div>
      );
    }

    return null;
  }

  // ── Pagination helpers ──────────────────────────────────────────

  const rangeStart = (page - 1) * pageSize + 1;
  const rangeEnd = Math.min(page * pageSize, total);

  function getPageNumbers(): (number | 'ellipsis')[] {
    const pages: (number | 'ellipsis')[] = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      if (page > 3) pages.push('ellipsis');
      const start = Math.max(2, page - 1);
      const end = Math.min(totalPages - 1, page + 1);
      for (let i = start; i <= end; i++) pages.push(i);
      if (page < totalPages - 2) pages.push('ellipsis');
      pages.push(totalPages);
    }
    return pages;
  }

  // ── Render ────────────────────────────────────────────────────

  const entityLabel = entity.charAt(0).toUpperCase() + entity.slice(1);

  return (
    <div>
      {/* ── Toolbar ──────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-4 gap-4 flex-wrap">
        {/* Left: row count */}
        <p className="text-sm text-stone-500 dark:text-stone-400">
          Showing{' '}
          <span className="font-semibold text-stone-700 dark:text-stone-200 tabular-nums">
            {total > 0 ? `${rangeStart}\u2013${rangeEnd}` : '0'}
          </span>{' '}
          of{' '}
          <span className="font-semibold text-stone-700 dark:text-stone-200 tabular-nums">
            {total.toLocaleString()}
          </span>{' '}
          {entityLabel.toLowerCase()}
        </p>

        {/* Right: controls */}
        <div className="flex items-center gap-2">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-stone-400 pointer-events-none dark:text-stone-500" />
            <input
              ref={searchRef}
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder={`Search ${entity}...`}
              className="pl-8 pr-7 py-1.5 text-xs rounded-lg border border-stone-200 bg-white text-stone-700 placeholder:text-stone-400 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200 dark:placeholder:text-stone-500 focus:outline-none focus:border-gold-300 focus:ring-1 focus:ring-gold-200 w-48 sm:w-56 transition-all duration-150"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => { onSearchChange(''); searchRef.current?.focus(); }}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600 dark:hover:text-stone-200 cursor-pointer dark:text-stone-500"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Filter dropdown */}
          {filterableFields.length > 0 && (
            <div ref={filterDropdown.ref} className="relative">
              <button
                type="button"
                onClick={() => filterDropdown.setOpen(!filterDropdown.open)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-all duration-150 cursor-pointer ${
                  activeFilterCount > 0
                    ? 'bg-gold-50 text-gold-700 border-gold-300 shadow-sm dark:bg-gold-500/10 dark:text-gold-300 dark:border-gold-500/30'
                    : 'bg-white text-stone-500 border-stone-200 hover:border-stone-300 hover:text-stone-700 dark:bg-stone-900 dark:text-stone-400 dark:border-stone-700 dark:hover:border-stone-600 dark:hover:text-stone-200'
                }`}
              >
                <Filter className="w-3.5 h-3.5" />
                Filter
                {activeFilterCount > 0 && (
                  <span className="inline-flex items-center justify-center w-4.5 h-4.5 text-[10px] font-bold rounded-full bg-gold-500 text-white ml-0.5 min-w-[18px] px-1">
                    {activeFilterCount}
                  </span>
                )}
              </button>

              {filterDropdown.open && (
                <div className="absolute right-0 top-full mt-2 w-72 bg-white border border-stone-200 rounded-xl shadow-lg z-30 overflow-hidden dark:bg-stone-900 dark:border-stone-700">
                  <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-stone-100 dark:border-stone-800">
                    <span className="text-xs font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500">Filters</span>
                    {activeFilterCount > 0 && (
                      <button
                        type="button"
                        onClick={() => { onClearAllFilters(); }}
                        className="text-xs text-gold-600 dark:text-gold-400 hover:underline cursor-pointer"
                      >
                        Clear all
                      </button>
                    )}
                  </div>
                  <div className="p-3.5 space-y-3 max-h-80 overflow-y-auto">
                    {filterableFields.map((f) => renderFilterControl(f))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Column visibility dropdown */}
          <div ref={columnsDropdown.ref} className="relative">
            <button
              type="button"
              onClick={() => columnsDropdown.setOpen(!columnsDropdown.open)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-all duration-150 cursor-pointer ${
                hiddenColumns.size > 0
                  ? 'border-violet-400 bg-violet-50 text-violet-700 shadow-sm dark:bg-violet-500/10 dark:text-violet-300 dark:border-violet-500/40'
                  : 'bg-white text-stone-500 border-stone-200 hover:border-stone-300 hover:text-stone-700 dark:bg-stone-900 dark:text-stone-400 dark:border-stone-700 dark:hover:border-stone-600 dark:hover:text-stone-200'
              }`}
            >
              <Columns3 className="w-3.5 h-3.5" />
              Columns
              {hiddenColumns.size > 0 && (
                <span className="inline-flex items-center justify-center w-4.5 h-4.5 text-[10px] font-bold rounded-full bg-violet-500 text-white ml-0.5 min-w-[18px] px-1">
                  {fields.length - hiddenColumns.size}/{fields.length}
                </span>
              )}
            </button>

            {columnsDropdown.open && (
              <div className="absolute right-0 top-full mt-2 w-56 bg-white border border-stone-200 rounded-xl shadow-lg z-30 overflow-hidden dark:bg-stone-900 dark:border-stone-700">
                <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-stone-100 dark:border-stone-800">
                  <span className="text-xs font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500">Toggle columns</span>
                  {hiddenColumns.size > 0 && (
                    <button
                      type="button"
                      onClick={onShowAllColumns}
                      className="text-xs text-violet-600 dark:text-violet-400 hover:underline cursor-pointer"
                    >
                      Show all
                    </button>
                  )}
                </div>
                <div className="p-1.5 max-h-72 overflow-y-auto">
                  {fields.map((f) => {
                    const isVisible = !hiddenColumns.has(f.supabaseColumn);
                    return (
                      <button
                        key={f.supabaseColumn}
                        type="button"
                        onClick={() => onToggleColumn(f.supabaseColumn)}
                        className="flex items-center gap-2.5 w-full px-2.5 py-1.5 text-sm rounded-lg hover:bg-stone-50 dark:hover:bg-stone-800 transition-colors duration-100 cursor-pointer text-left"
                      >
                        {isVisible ? (
                          <Eye className="w-3.5 h-3.5 text-emerald-500 dark:text-emerald-400 shrink-0" />
                        ) : (
                          <EyeOff className="w-3.5 h-3.5 text-stone-400 dark:text-stone-500 shrink-0" />
                        )}
                        <span className={isVisible ? 'text-stone-700 dark:text-stone-200' : 'text-stone-400 dark:text-stone-500'}>
                          {f.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {!readOnly && (
            <>
              {/* Bulk Upload — files entity only: one row per uploaded file */}
              {onBulkUpload && (
                <button
                  type="button"
                  onClick={onBulkUpload}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-stone-200 bg-white text-stone-500 hover:border-stone-300 hover:text-stone-700 dark:bg-stone-900 dark:text-stone-400 dark:border-stone-700 dark:hover:border-stone-600 dark:hover:text-stone-200 transition-all duration-150 cursor-pointer"
                >
                  <Upload className="w-4 h-4" />
                  Bulk upload
                </button>
              )}

              {/* Batch Import */}
              {onBatchImport && (
                <button
                  type="button"
                  onClick={onBatchImport}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-stone-200 bg-white text-stone-500 hover:border-stone-300 hover:text-stone-700 dark:bg-stone-900 dark:text-stone-400 dark:border-stone-700 dark:hover:border-stone-600 dark:hover:text-stone-200 transition-all duration-150 cursor-pointer"
                >
                  <Upload className="w-4 h-4" />
                  Import
                </button>
              )}

              {/* Add button — opens modal */}
              <button
                type="button"
                onClick={onAdd}
                className="inline-flex items-center gap-1.5 bg-gold-500 hover:bg-gold-600 text-white px-4 py-1.5 rounded-lg text-xs font-medium transition-colors duration-150 cursor-pointer shadow-sm"
              >
                <Plus className="w-4 h-4" />
                Add
              </button>
            </>
          )}
        </div>
      </div>

      {/* ── Active filter pills ───────────────────────────────── */}
      {activeFilterCount > 0 && (
        <div className="flex items-center gap-1.5 mb-3 flex-wrap">
          <span className="text-xs text-stone-400 dark:text-stone-500 mr-1">Filtered by:</span>
          {Object.entries(filters).map(([key, value]) => {
            // Resolve label
            const cleanKey = key.replace(/\.(gte|lte)$/, '');
            const suffix = key.endsWith('.gte') ? ' from' : key.endsWith('.lte') ? ' to' : '';
            const fieldDef = fields.find((f) => f.supabaseColumn === cleanKey);
            const label = fieldDef?.label ?? cleanKey;
            const displayVal = fieldDef?.type === 'checkbox'
              ? (value === 'true' ? 'Yes' : 'No')
              : fieldDef?.type === 'people'
                ? (peopleMap[value]?.name ?? value)
                : value;

            return (
              <span
                key={key}
                className="inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full bg-gold-50 text-gold-700 ring-1 ring-inset ring-gold-200/60 dark:bg-gold-500/10 dark:text-gold-400 dark:ring-gold-500/20"
              >
                {label}{suffix}: {displayVal}
                <button
                  type="button"
                  onClick={() => onFilterChange(key, '')}
                  className="hover:text-gold-900 dark:hover:text-gold-200 cursor-pointer ml-0.5"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            );
          })}
          <button
            type="button"
            onClick={onClearAllFilters}
            className="text-xs text-stone-400 hover:text-stone-700 dark:text-stone-500 dark:hover:text-stone-200 ml-1 cursor-pointer"
          >
            Clear all
          </button>
        </div>
      )}

      {/* ── Table ────────────────────────────────────────────── */}
      <div className="relative group/table">
        {/* Hover plus button — left of first data row */}
        {!inlineAddOpen && (
          <button
            type="button"
            onClick={openInlineAdd}
            className="absolute -left-4 z-20 w-6 h-6 rounded-full bg-gold-500 text-white shadow-md flex items-center justify-center opacity-0 group-hover/table:opacity-100 hover:bg-gold-600 hover:scale-110 transition-all duration-150 cursor-pointer"
            style={{ top: (theadHeight ?? 44) + 8 }}
            title="Quick add row"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        )}
        {/* Custom sticky top scrollbar */}
        <div
          ref={topTrackRef}
          className="sticky top-14 z-20 h-3 rounded-full bg-stone-200/80 dark:bg-stone-700/80 cursor-pointer mb-1.5 shadow-sm border border-stone-200 dark:border-stone-600"
        >
          <div
            ref={topThumbRef}
            className="absolute top-0.5 h-2 rounded-full bg-stone-400 dark:bg-stone-500 hover:bg-stone-500 dark:hover:bg-stone-400 transition-colors cursor-grab active:cursor-grabbing shadow-sm"
            style={{ width: 80, left: 0 }}
          />
        </div>
        <div ref={tableScrollRef} onScroll={handleTableScroll} className="relative overflow-x-auto rounded-xl border border-stone-200 bg-white shadow-[var(--shadow-card)] dark:border-stone-800 dark:bg-stone-900">
        <table className="w-full text-sm">
          <thead ref={theadRef}>
            <tr className="border-b border-stone-100 bg-stone-50/60 dark:border-stone-800 dark:bg-stone-800/40">
              {!readOnly && (
                <th className="sticky top-0 z-10 px-4 py-2.5 w-10 bg-stone-50/60 dark:bg-stone-800/80">
                  <input
                    ref={selectAllRef}
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleSelectAll}
                    className="w-3.5 h-3.5 rounded border-stone-300 dark:border-stone-600 dark:bg-stone-800 text-gold-600 focus:ring-gold-300 cursor-pointer accent-[#C9A84C] dark:text-gold-400"
                  />
                </th>
              )}
              {visibleFields.map((field) => {
                const isSorted = sortKey === field.supabaseColumn;
                return (
                  <th
                    key={field.supabaseColumn}
                    className="sticky top-0 z-10 px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500 cursor-pointer select-none hover:text-stone-600 dark:hover:text-stone-300 transition-colors duration-150 bg-stone-50/60 dark:bg-stone-800/80"
                    onClick={() => toggleSort(field.supabaseColumn)}
                  >
                    <span className="flex items-center gap-1">
                      {field.label}
                      {isSorted &&
                        (sortDir === 'asc' ? (
                          <ChevronUp className="w-3 h-3 text-gold-500 dark:text-gold-400" />
                        ) : (
                          <ChevronDown className="w-3 h-3 text-gold-500 dark:text-gold-400" />
                        ))}
                    </span>
                  </th>
                );
              })}
              {/* No dedicated actions column — actions overlay on row hover */}
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
            {/* Inline quick-add row */}
            {inlineAddOpen && (
              <tr className="bg-gold-50/50 dark:bg-gold-500/5">
                {!readOnly && <td className="px-4 py-1.5 border-b border-gold-200/40 dark:border-gold-500/10" />}
                {visibleFields.map((field, idx) => {
                  const isSkipped = !field.editable || field.autoGenerated || field.hideFromAdd;
                  const commonClasses = 'w-full bg-white text-stone-700 text-sm border border-stone-200 rounded-md px-2 py-1 focus:outline-none focus:ring-2 focus:ring-gold-300/30 focus:border-gold-300 dark:bg-stone-800 dark:text-stone-100 dark:border-stone-700 dark:focus:ring-gold-500/30 dark:focus:border-gold-500/50';
                  return (
                    <td key={field.supabaseColumn} className="px-4 py-1.5 border-b border-gold-200/40 dark:border-gold-500/10">
                      {isSkipped ? (
                        <span className="text-xs text-stone-400 dark:text-stone-500">—</span>
                      ) : field.type === 'relation' && field.relationEntity ? (
                        <div className="relative">
                          <CellDropdownTrigger
                            label={inlineValues[field.key] || field.label}
                            hasValue={!!inlineValues[field.key]}
                            onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
                              inlineDropdownAnchorRef.current = e.currentTarget;
                              setInlineDropdownField(inlineDropdownField === field.key ? null : field.key);
                            }}
                          />
                          {inlineDropdownField === field.key && (
                            <CellDropdown
                              mode="single"
                              options={relationDropdownOptions(field.relationEntity!)}
                              value={inlineValues[field.key] || null}
                              onSelect={(id) => {
                                setInlineValues((prev) => ({ ...prev, [field.key]: id ?? '' }));
                                setInlineDropdownField(null);
                              }}
                              onClose={() => setInlineDropdownField(null)}
                              anchorRef={inlineDropdownAnchorRef}
                              placeholder={`Search ${field.label.toLowerCase()}...`}
                            />
                          )}
                        </div>
                      ) : field.type === 'people' ? (
                        <div className="relative">
                          {(() => {
                            const isMulti = !!field.peopleMultiple;
                            const currentVal = inlineValues[field.key] ?? '';
                            // For multi, store as comma-separated IDs
                            const multiIds: string[] = isMulti && currentVal ? String(currentVal).split(',').filter(Boolean) : [];
                            const displayLabel = !currentVal
                              ? field.label
                              : isMulti
                                ? `${multiIds.length} selected`
                                : (peopleMap[currentVal]?.name ?? currentVal);

                            return (
                              <>
                                <CellDropdownTrigger
                                  label={displayLabel}
                                  hasValue={!!currentVal}
                                  onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
                                    inlineDropdownAnchorRef.current = e.currentTarget;
                                    setInlineDropdownField(inlineDropdownField === field.key ? null : field.key);
                                  }}
                                />
                                {inlineDropdownField === field.key && (
                                  isMulti ? (
                                    <CellDropdown
                                      mode="multi"
                                      options={peopleDropdownOptions}
                                      value={multiIds}
                                      onSelect={(ids) => {
                                        setInlineValues((prev) => ({ ...prev, [field.key]: ids.join(',') }));
                                      }}
                                      onClose={() => setInlineDropdownField(null)}
                                      anchorRef={inlineDropdownAnchorRef}
                                      placeholder="Search people..."
                                    />
                                  ) : (
                                    <CellDropdown
                                      mode="single"
                                      options={peopleDropdownOptions}
                                      value={currentVal || null}
                                      onSelect={(id) => {
                                        setInlineValues((prev) => ({ ...prev, [field.key]: id ?? '' }));
                                        setInlineDropdownField(null);
                                      }}
                                      onClose={() => setInlineDropdownField(null)}
                                      anchorRef={inlineDropdownAnchorRef}
                                      placeholder="Search people..."
                                    />
                                  )
                                )}
                              </>
                            );
                          })()}
                        </div>
                      ) : field.type === 'select' && field.options ? (
                        <div className="relative">
                          <CellDropdownTrigger
                            label={inlineValues[field.key] || field.label}
                            hasValue={!!inlineValues[field.key]}
                            onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
                              inlineDropdownAnchorRef.current = e.currentTarget;
                              setInlineDropdownField(inlineDropdownField === field.key ? null : field.key);
                            }}
                          />
                          {inlineDropdownField === field.key && (
                            <CellDropdown
                              mode="single"
                              options={field.options.map((opt) => ({ id: opt, label: opt }))}
                              value={inlineValues[field.key] || null}
                              onSelect={(id) => {
                                setInlineValues((prev) => ({ ...prev, [field.key]: id ?? '' }));
                                setInlineDropdownField(null);
                              }}
                              onClose={() => setInlineDropdownField(null)}
                              anchorRef={inlineDropdownAnchorRef}
                              placeholder={`Search ${field.label.toLowerCase()}...`}
                            />
                          )}
                        </div>
                      ) : field.type === 'date' || field.type === 'datetime' ? (
                        <div className="relative">
                          <CellDateTrigger
                            value={inlineValues[field.key] || null}
                            placeholder={field.label}
                            showTime={field.type === 'datetime'}
                            onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
                              inlineDropdownAnchorRef.current = e.currentTarget;
                              setInlineDropdownField(inlineDropdownField === field.key ? null : field.key);
                            }}
                          />
                          {inlineDropdownField === field.key && (
                            <CellDatePicker
                              value={inlineValues[field.key] || null}
                              showTime={field.type === 'datetime'}
                              onSelect={(date) => {
                                setInlineValues((prev) => ({ ...prev, [field.key]: date ?? '' }));
                                setInlineDropdownField(null);
                              }}
                              onClose={() => setInlineDropdownField(null)}
                              anchorRef={inlineDropdownAnchorRef}
                            />
                          )}
                        </div>
                      ) : (
                        <input
                          ref={idx === 0 ? inlineFirstRef : undefined}
                          type={field.type === 'number' ? 'number' : 'text'}
                          value={inlineValues[field.key] ?? ''}
                          onChange={(e) => setInlineValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
                          onKeyDown={handleInlineKeyDown}
                          placeholder={field.label}
                          className={commonClasses}
                        />
                      )}
                    </td>
                  );
                })}
                <td className="px-4 py-1.5 border-b border-gold-200/40 dark:border-gold-500/10 text-right">
                  <div className="flex items-center justify-end gap-1">
                    <button
                      type="button"
                      onClick={saveInlineAdd}
                      disabled={inlineSaving || !fields.some((f) => f.required && inlineValues[f.key])}
                      className="p-1.5 rounded-lg text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 transition-colors cursor-pointer disabled:opacity-30 dark:text-emerald-400"
                      title="Save (Enter)"
                    >
                      {inlineSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                    </button>
                    <button
                      type="button"
                      onClick={cancelInlineAdd}
                      className="p-1.5 rounded-lg text-stone-400 hover:text-red-500 hover:bg-red-50 transition-colors cursor-pointer dark:text-stone-500 dark:hover:bg-red-500/10 dark:hover:text-red-400"
                      title="Cancel (Esc)"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </td>
              </tr>
            )}
            {data.length === 0 && !inlineAddOpen ? (
              <tr>
                <td
                  colSpan={visibleFields.length + (readOnly ? 1 : 2) + 1}
                  className="px-4 py-12 text-center text-sm text-stone-400 dark:text-stone-500"
                >
                  {searchQuery || activeFilterCount > 0
                    ? `No ${entity} matching current filters`
                    : `No ${entity} found`}
                </td>
              </tr>
            ) : (
              data.map((row) => {
                const rowId = row.notion_id ?? row.id;
                return (
                  <tr
                    key={rowId}
                    className={`group relative hover:bg-gold-50/30 dark:hover:bg-gold-500/5 transition-all duration-150${selectedIds.has(rowId) ? ' bg-gold-50/40 dark:bg-gold-500/10' : ''}`}
                  >
                    {!readOnly && (
                      <td className="px-4 py-2.5 w-10">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(rowId)}
                          onChange={() => toggleSelectRow(rowId)}
                          className="w-3.5 h-3.5 rounded border-stone-300 dark:border-stone-600 dark:bg-stone-800 text-gold-600 focus:ring-gold-300 cursor-pointer accent-[#C9A84C] dark:text-gold-400"
                        />
                      </td>
                    )}
                    {visibleFields.map((field) => {
                      const isThisCellEditing =
                        editingCell?.rowId === rowId &&
                        editingCell?.fieldKey === field.supabaseColumn;
                      const needsAnchor = isThisCellEditing && (field.type === 'people' || field.type === 'relation' || field.type === 'relation_multi' || field.type === 'select' || field.type === 'date' || field.type === 'datetime');
                      return (
                        <td
                          key={field.supabaseColumn}
                          ref={needsAnchor ? (el) => { if (el) editAnchorRef.current = el; } : undefined}
                          className="px-4 py-2.5 text-sm text-stone-700 dark:text-stone-200 max-w-[300px]"
                        >
                          {renderCell(row, field)}
                        </td>
                      );
                    })}
                    {/* Hover action buttons — floating overlay near first column */}
                    <td className="p-0 w-0 border-0">
                      <div className={`absolute ${readOnly ? 'left-36' : 'left-44'} top-1/2 -translate-y-1/2 z-10 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-150 pointer-events-none group-hover:pointer-events-auto`}>
                        <div className="flex items-center gap-1 bg-white/90 backdrop-blur-sm rounded-md shadow-sm border border-stone-200/60 dark:bg-stone-800/90 dark:border-stone-700 px-1.5 py-0.5">
                          {onOpenDetail && (
                            <button
                              type="button"
                              onClick={() => onOpenDetail(rowId)}
                              className="flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium text-stone-500 hover:text-gold-700 hover:bg-gold-50 transition-colors duration-150 cursor-pointer dark:text-stone-400 dark:hover:bg-gold-500/10 dark:hover:text-gold-300"
                            >
                              <SquareArrowOutUpRight className="w-3.5 h-3.5" />
                              <span>Open</span>
                            </button>
                          )}
                          {onUploadFiledVersion && row.status === DELIVERABLE_STATUS.FILED_OR_SENT_OUT && (
                            <button
                              type="button"
                              onClick={() => onUploadFiledVersion(rowId, String(row.name ?? ''), !!row.has_filed_copy)}
                              className="flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium text-stone-500 hover:text-emerald-700 hover:bg-emerald-50 transition-colors duration-150 cursor-pointer dark:text-stone-400 dark:hover:bg-emerald-500/10 dark:hover:text-emerald-300"
                              title={row.has_filed_copy ? 'A filed copy exists — upload a replacement?' : 'Upload the filed/sent-out copy'}
                            >
                              <FileCheck className="w-3.5 h-3.5" />
                              <span>{row.has_filed_copy ? 'Replace Filed Copy' : 'Filed Copy'}</span>
                            </button>
                          )}
                          {onCreateStatusReport && (
                            <button
                              type="button"
                              disabled={srLoadingId === rowId}
                              onClick={() => setSrConfirmTarget({
                                id: rowId,
                                name: String(row.name ?? ''),
                                hasSr: !!row.related_sr_name,
                              })}
                              className="flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium text-stone-500 hover:text-blue-700 hover:bg-blue-50 transition-colors duration-150 cursor-pointer disabled:opacity-50 dark:text-stone-400 dark:hover:bg-blue-500/10"
                              title={row.related_sr_name ? 'A status report already exists — create another?' : 'Create Status Report'}
                            >
                              {srLoadingId === rowId ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <ClipboardList className="w-3.5 h-3.5" />
                              )}
                              <span>Status Report</span>
                            </button>
                          )}
                          {!readOnly && (
                            entity === 'deliverables' && row.status !== DELIVERABLE_STATUS.ARCHIVED ? (
                              <button
                                type="button"
                                onClick={() => setArchiveTarget(rowId)}
                                className="flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium text-stone-500 hover:text-amber-600 hover:bg-amber-50 transition-colors duration-150 cursor-pointer dark:text-stone-400 dark:hover:bg-amber-500/10"
                              >
                                <Archive className="w-3.5 h-3.5" />
                                <span>Archive</span>
                              </button>
                            ) : !readOnly ? (
                              <button
                                type="button"
                                onClick={() => setArchiveTarget(rowId)}
                                className="flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium text-stone-500 hover:text-red-500 hover:bg-red-50 transition-colors duration-150 cursor-pointer dark:text-stone-400 dark:hover:bg-red-500/10 dark:hover:text-red-400"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                                <span>Delete</span>
                              </button>
                            ) : null
                          )}
                        </div>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
        </div>
      </div>

      {/* ── Batch Action Bar ─────────────────────────────────── */}
      {selectedIds.size > 0 && !readOnly && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-navy-800 text-white pl-5 pr-3 py-2.5 flex items-center gap-6 rounded-xl shadow-2xl border border-white/10 animate-fade-up">
          <span className="text-sm font-medium whitespace-nowrap">{selectedIds.size} selected</span>
          <div className="flex items-center gap-2">
            {statusField && (
              <div ref={batchStatusDropdown.ref} className="relative">
                <button
                  type="button"
                  onClick={() => batchStatusDropdown.setOpen(!batchStatusDropdown.open)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white/10 hover:bg-white/20 rounded-lg transition-colors cursor-pointer"
                >
                  Change Status
                  <ChevronDown className="w-3 h-3" />
                </button>
                {batchStatusDropdown.open && (
                  <div className="absolute bottom-full mb-1 right-0 w-48 bg-white rounded-lg shadow-lg border border-stone-200 py-1 max-h-60 overflow-y-auto dark:bg-stone-900 dark:border-stone-700">
                    {statusField.options?.map((opt) => (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => handleBatchStatusChange(opt)}
                        className="w-full text-left px-3 py-1.5 text-sm text-stone-700 hover:bg-gold-50 dark:text-stone-200 dark:hover:bg-gold-500/10 transition-colors cursor-pointer"
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <button
              type="button"
              onClick={handleBatchArchive}
              disabled={batchLoading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-red-500/80 hover:bg-red-500 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
            >
              {batchLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : entity === 'deliverables' && [...selectedIds].some((id) => !isRowArchived(id)) ? <Archive className="w-3 h-3" /> : <Trash2 className="w-3 h-3" />}
              {entity === 'deliverables' && [...selectedIds].some((id) => !isRowArchived(id)) ? 'Archive' : 'Delete'} ({selectedIds.size})
            </button>
            <button
              type="button"
              onClick={() => setSelectedIds(new Set())}
              className="p-1.5 text-white/60 hover:text-white transition-colors cursor-pointer"
              title="Clear selection"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* ── Pagination ────────────────────────────────────────── */}
      {total > 0 && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 mt-4 px-1">
          <div className="flex items-center gap-2 text-sm text-stone-500 dark:text-stone-400">
            <span>Rows per page</span>
            <select
              value={pageSize}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
              className="bg-white border border-stone-200 rounded-lg px-2 py-1 text-sm text-stone-700 dark:bg-stone-900 dark:border-stone-700 dark:text-stone-200 focus:outline-none focus:border-gold-300 focus:ring-1 focus:ring-gold-200 cursor-pointer"
            >
              {PAGE_SIZE_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-1">
            <button type="button" disabled={page <= 1} onClick={() => onPageChange(1)}
              className="p-1.5 rounded-lg text-stone-400 hover:text-stone-700 hover:bg-stone-50 dark:text-stone-500 dark:hover:text-stone-200 dark:hover:bg-stone-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors duration-150 cursor-pointer" title="First page">
              <ChevronsLeft className="w-4 h-4" />
            </button>
            <button type="button" disabled={page <= 1} onClick={() => onPageChange(page - 1)}
              className="p-1.5 rounded-lg text-stone-400 hover:text-stone-700 hover:bg-stone-50 dark:text-stone-500 dark:hover:text-stone-200 dark:hover:bg-stone-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors duration-150 cursor-pointer" title="Previous page">
              <ChevronLeft className="w-4 h-4" />
            </button>

            <div className="flex items-center gap-0.5 mx-1">
              {getPageNumbers().map((p, idx) =>
                p === 'ellipsis' ? (
                  <span key={`ellipsis-${idx}`} className="w-8 text-center text-sm text-stone-400 dark:text-stone-500 select-none">…</span>
                ) : (
                  <button key={p} type="button" onClick={() => onPageChange(p)}
                    className={`min-w-[32px] h-8 rounded-lg text-sm font-medium transition-colors duration-150 cursor-pointer ${
                      p === page
                        ? 'bg-navy-800 text-white shadow-sm dark:bg-gold-500/20 dark:text-gold-200'
                        : 'text-stone-500 hover:text-stone-700 hover:bg-stone-50 dark:text-stone-400 dark:hover:text-stone-200 dark:hover:bg-stone-800'
                    }`}>
                    {p}
                  </button>
                ),
              )}
            </div>

            <button type="button" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}
              className="p-1.5 rounded-lg text-stone-400 hover:text-stone-700 hover:bg-stone-50 dark:text-stone-500 dark:hover:text-stone-200 dark:hover:bg-stone-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors duration-150 cursor-pointer" title="Next page">
              <ChevronRight className="w-4 h-4" />
            </button>
            <button type="button" disabled={page >= totalPages} onClick={() => onPageChange(totalPages)}
              className="p-1.5 rounded-lg text-stone-400 hover:text-stone-700 hover:bg-stone-50 dark:text-stone-500 dark:hover:text-stone-200 dark:hover:bg-stone-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors duration-150 cursor-pointer" title="Last page">
              <ChevronsRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* ── Create Status Report Confirmation ────────────────── */}
      <ConfirmDialog
        open={srConfirmTarget !== null}
        onConfirm={async () => {
          if (!srConfirmTarget || !onCreateStatusReport) return;
          const id = srConfirmTarget.id;
          setSrLoadingId(id);
          setSrConfirmTarget(null);
          try { await onCreateStatusReport(id); } finally { setSrLoadingId(null); }
        }}
        onCancel={() => setSrConfirmTarget(null)}
        title={srConfirmTarget?.hasSr ? 'Status Report Already Exists' : 'Create Status Report?'}
        message={
          srConfirmTarget
            ? srConfirmTarget.hasSr
              ? `A status report already exists for "${srConfirmTarget.name}". Creating another will not replace the existing one — both will coexist. Continue?`
              : `Create a status report for ${entity === 'hearings' ? 'hearing' : 'filing'} "${srConfirmTarget.name}"? Drafters and reviewer will be set from the matter team.`
            : ''
        }
        confirmLabel={srConfirmTarget?.hasSr ? 'Create Anyway' : 'Create'}
        variant={srConfirmTarget?.hasSr ? 'danger' : 'primary'}
        loading={srLoadingId !== null}
      />

      <ConfirmDialog
        open={renameConfirm !== null}
        onConfirm={() => {
          if (!renameConfirm) return;
          const { notionId, column, value } = renameConfirm;
          setRenameConfirm(null);
          void saveCell(notionId, column, value, true);
        }}
        onCancel={() => setRenameConfirm(null)}
        title="Rename this client?"
        message={renameConfirm?.message ?? ''}
        confirmLabel="Rename"
        variant="danger"
      />

      {/* ── Archive Confirmation ─────────────────────────────── */}
      <ConfirmDialog
        open={archiveTarget !== null}
        onConfirm={handleArchive}
        onCancel={() => setArchiveTarget(null)}
        title={
          entity === 'deliverables' && archiveTarget && isRowArchived(archiveTarget)
            ? `Delete ${entityLabel.slice(0, -1)}`
            : `Archive ${entityLabel.slice(0, -1)}`
        }
        message={
          entity === 'deliverables' && archiveTarget && isRowArchived(archiveTarget)
            ? `Are you sure you want to permanently delete this deliverable? This cannot be undone.`
            : entity === 'deliverables'
              ? `Are you sure you want to archive this deliverable? Its status will be set to "Archived".`
              : `Are you sure you want to delete this ${entityLabel.slice(0, -1).toLowerCase()}? It will be removed from the active view.`
        }
        confirmLabel={
          entity === 'deliverables' && archiveTarget && isRowArchived(archiveTarget)
            ? 'Delete'
            : entity === 'deliverables' ? 'Archive' : 'Delete'
        }
        variant={entity === 'deliverables' && archiveTarget && !isRowArchived(archiveTarget) ? 'primary' : 'danger'}
        loading={archiveLoading}
      />

      <ConfirmDialog
        open={tmStatusConfirm !== null}
        onConfirm={async () => {
          if (!tmStatusConfirm) return;
          setTmStatusSaving(true);
          const { nid, to } = tmStatusConfirm;
          try {
            await saveCell(nid, 'status', to || null);
          } finally {
            setTmStatusSaving(false);
            setTmStatusConfirm(null);
          }
        }}
        onCancel={() => setTmStatusConfirm(null)}
        title="Override trademark status?"
        message={
          tmStatusConfirm
            ? `This sets status from "${tmStatusConfirm.from || '(none)'}" to "${tmStatusConfirm.to}" without going through the prosecution workflow on the trademark detail page (Mark as Filed, Notice of Allowance received, etc.). Lifecycle dates won't be auto-populated. Use this only for data corrections — for normal workflow, use the trademark detail page.`
            : ''
        }
        confirmLabel="Override Status"
        variant="danger"
        loading={tmStatusSaving}
      />

      <ConfirmDialog
        open={batchArchiveConfirm !== null}
        onConfirm={executeBatchArchive}
        onCancel={() => setBatchArchiveConfirm(null)}
        title={
          batchArchiveConfirm?.toArchive.length && batchArchiveConfirm?.toDelete.length
            ? `Archive & Delete ${entityLabel}`
            : batchArchiveConfirm?.toArchive.length
              ? `Archive ${entityLabel}`
              : `Delete ${entityLabel}`
        }
        message={
          batchArchiveConfirm?.toArchive.length && batchArchiveConfirm?.toDelete.length
            ? `This will archive ${batchArchiveConfirm.toArchive.length} and permanently delete ${batchArchiveConfirm.toDelete.length} ${entityLabel.toLowerCase()}. This cannot be undone.`
            : batchArchiveConfirm?.toArchive.length
              ? `Are you sure you want to archive ${batchArchiveConfirm.toArchive.length} ${entityLabel.toLowerCase()}? Their status will be set to "Archived".`
              : `Are you sure you want to delete ${batchArchiveConfirm?.toDelete.length ?? 0} ${entityLabel.toLowerCase()}? This cannot be undone.`
        }
        confirmLabel={
          batchArchiveConfirm?.toArchive.length && !batchArchiveConfirm?.toDelete.length
            ? 'Archive'
            : 'Confirm'
        }
        variant={batchArchiveConfirm?.toArchive.length && !batchArchiveConfirm?.toDelete.length ? 'primary' : 'danger'}
        loading={batchLoading}
      />

      {fileUpload && (
        <FileUploadModal
          open
          onClose={() => setFileUpload(null)}
          notionId={fileUpload.notionId}
          existingFiles={fileUpload.files}
          onSuccess={() => { onRefresh(); }}
        />
      )}

      <FilePreviewModal
        open={!!filePreview}
        onClose={() => setFilePreview(null)}
        files={filePreview ?? []}
      />
    </div>
  );
}
