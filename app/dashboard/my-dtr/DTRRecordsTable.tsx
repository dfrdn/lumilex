'use client';

import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  ChevronUp,
  ChevronDown,
  ExternalLink,
  Check,
  X,
  Loader2,
  Plus,
  Minus,
  Search,
  Pencil,
  Trash2,
} from 'lucide-react';
import type { MyDTREntry } from '@/lib/queries/my-dtr';
import CellDropdown, { CellDropdownTrigger } from '@/components/admin/CellDropdown';
import CellDatePicker, { CellDateTrigger } from '@/components/admin/CellDatePicker';
import { manilaToday } from '@/lib/dates';
import { confirmAction } from '@/components/ui/confirm';
import { toast } from 'sonner';
import { FORMER_MEMBER } from '@/lib/former-member';

// ── Types ─────────────────────────────────────────────────────────

interface Props {
  entries: MyDTREntry[];
  onEntryCreated?: (created: MyDTREntry) => void;
}

type SortKey = 'date' | 'task' | 'hours';

type EditingCell = {
  rowId: string;
  field: string;
} | null;

type CellSaveState = 'idle' | 'saving' | 'saved';

// ── Constants ─────────────────────────────────────────────────────

const TASK_OPTIONS = [
  'Study',
  'Correspondence',
  'Draft',
  'Review and Revise',
  'Finalize',
  'Hearing',
  'Meeting',
  'Internal Discussion',
  'Research',
  'TM',
  'Bail Processing',
  'Others',
] as const;

const TASK_DROPDOWN_OPTIONS = TASK_OPTIONS.map((t) => ({ id: t, label: t }));

// ── Helpers ───────────────────────────────────────────────────────

function fmtDate(d: string | null): string {
  if (!d) return '—';
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function toDecimal(h: number, m: number): number {
  return h + (m > 0 ? Math.ceil(m / 6) / 10 : 0);
}

function fmtHours(h: number, m: number): string {
  return toDecimal(h, m).toFixed(1);
}

// ── Component ─────────────────────────────────────────────────────

export default function DTRRecordsTable({ entries, onEntryCreated }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  // Inline editing state
  const [editingCell, setEditingCell] = useState<EditingCell>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [editValue, setEditValue] = useState<any>('');
  const [cellSaveStates, setCellSaveStates] = useState<Record<string, CellSaveState>>({});
  const editInputRef = useRef<HTMLInputElement | HTMLSelectElement>(null);
  const editAnchorRef = useRef<HTMLElement | null>(null);

  // Quick-add dropdown/picker anchors
  const addTaskAnchorRef = useRef<HTMLButtonElement | null>(null);
  const addDateAnchorRef = useRef<HTMLButtonElement | null>(null);
  const [addTaskOpen, setAddTaskOpen] = useState(false);
  const [addDateOpen, setAddDateOpen] = useState(false);

  // Quick-add row
  const [addOpen, setAddOpen] = useState(false);
  const [addValues, setAddValues] = useState({
    remarks: '',
    task: '',
    date: manilaToday(),
    hours: 1,
    minutes: 0,
  });
  const [addSaving, setAddSaving] = useState(false);
  const addRemarksRef = useRef<HTMLInputElement>(null);

  // People list for lawyer editing (lazy-loaded)
  const [allLawyers, setAllLawyers] = useState<{ id: string; name: string; initials: string }[]>([]);
  const [lawyersFetched, setLawyersFetched] = useState(false);

  const ensureLawyers = useCallback(async () => {
    if (lawyersFetched) return;
    try {
      const res = await fetch('/api/people?role=lawyers');
      if (res.ok) {
        const data = await res.json();
        setAllLawyers(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (data.people ?? []).map((p: any) => ({
            id: p.person_id,
            name: p.name,
            initials: p.initials,
          })),
        );
      }
    } catch { /* ignore */ }
    setLawyersFetched(true);
  }, [lawyersFetched]);

  // Local entries for optimistic updates
  const [localEntries, setLocalEntries] = useState(entries);
  useEffect(() => { setLocalEntries(entries); }, [entries]);

  // Focus edit input when editing starts
  useEffect(() => {
    if (editingCell && editInputRef.current) {
      editInputRef.current.focus();
      if ('select' in editInputRef.current && editInputRef.current.type !== 'select-one') {
        editInputRef.current.select();
      }
    }
  }, [editingCell]);

  // Focus remarks input when add row opens
  useEffect(() => {
    if (addOpen) {
      requestAnimationFrame(() => addRemarksRef.current?.focus());
    }
  }, [addOpen]);

  const sorted = useMemo(() => {
    return [...localEntries].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'date':
          cmp = (a.date ?? '').localeCompare(b.date ?? '');
          if (cmp === 0) cmp = (a.lastEditedAt ?? '').localeCompare(b.lastEditedAt ?? '');
          break;
        case 'task':
          cmp = a.task.localeCompare(b.task);
          break;
        case 'hours':
          cmp = toDecimal(a.hours, a.minutes) - toDecimal(b.hours, b.minutes);
          break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [localEntries, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'date' ? 'desc' : 'asc');
    }
  }

  function SortIcon({ col }: { col: SortKey }) {
    if (sortKey !== col) return null;
    return sortDir === 'asc' ? (
      <ChevronUp className="w-3 h-3 text-gold-500 dark:text-gold-400" />
    ) : (
      <ChevronDown className="w-3 h-3 text-gold-500 dark:text-gold-400" />
    );
  }

  // ── Cell save states ─────────────────────────────────────────

  function setCellState(rowId: string, field: string, state: CellSaveState) {
    const key = `${rowId}:${field}`;
    setCellSaveStates((prev) => ({ ...prev, [key]: state }));
    if (state === 'saved') {
      setTimeout(() => {
        setCellSaveStates((prev) => ({ ...prev, [key]: 'idle' }));
      }, 1500);
    }
  }

  function getCellState(rowId: string, field: string): CellSaveState {
    return cellSaveStates[`${rowId}:${field}`] ?? 'idle';
  }

  // ── Inline editing ──────────────────────────────────────────

  function startEditing(entry: MyDTREntry, field: string) {
    setEditingCell({ rowId: entry.id, field });
    switch (field) {
      case 'remarks': setEditValue(entry.remarks); break;
      case 'task': setEditValue(entry.task); break;
      case 'date': setEditValue(entry.date ?? ''); break;
      case 'hours': setEditValue(entry.hours); break;
      case 'minutes': setEditValue(entry.minutes); break;
      default: setEditValue('');
    }
  }

  function cancelEditing() {
    setEditingCell(null);
    setEditValue('');
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const saveEdit = useCallback(async (entry: MyDTREntry, field: string, val: any) => {
    // Check if value changed
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const original = (entry as any)[field];
    if (val === original || (val === '' && original == null)) {
      cancelEditing();
      return;
    }

    cancelEditing();
    setCellState(entry.id, field, 'saving');

    // Optimistic update
    setLocalEntries((prev) =>
      prev.map((e) => (e.id === entry.id ? { ...e, [field]: val } : e)),
    );

    try {
      const res = await fetch('/api/dtr', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notionId: entry.id, field, value: val }),
      });

      if (!res.ok) {
        // Revert
        setLocalEntries((prev) =>
          prev.map((e) => (e.id === entry.id ? { ...e, [field]: original } : e)),
        );
        const err = await res.json().catch(() => ({ error: 'Save failed' }));
        toast.error(`Save failed: ${err.error}`);
        setCellState(entry.id, field, 'idle');
        return;
      }

      const data = await res.json();
      // Update withNames if people field was changed
      if (field === 'withIds' && data.withNames) {
        setLocalEntries((prev) =>
          prev.map((e) => (e.id === entry.id ? { ...e, withNames: data.withNames } : e)),
        );
      }

      setCellState(entry.id, field, 'saved');
    } catch {
      setLocalEntries((prev) =>
        prev.map((e) => (e.id === entry.id ? { ...e, [field]: original } : e)),
      );
      setCellState(entry.id, field, 'idle');
    }
  }, []);

  // Save both hours and minutes together
  const saveDuration = useCallback(async (entry: MyDTREntry, val: { hours: number; minutes: number }) => {
    const hoursChanged = val.hours !== entry.hours;
    const minsChanged = val.minutes !== entry.minutes;
    if (!hoursChanged && !minsChanged) {
      cancelEditing();
      return;
    }
    cancelEditing();

    // Optimistic update
    setLocalEntries((prev) =>
      prev.map((e) => (e.id === entry.id ? { ...e, hours: val.hours, minutes: val.minutes } : e)),
    );

    // Save hours and minutes in parallel
    const saves: Promise<void>[] = [];
    if (hoursChanged) {
      setCellState(entry.id, 'hours', 'saving');
      saves.push(
        fetch('/api/dtr', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ notionId: entry.id, field: 'hours', value: val.hours }),
        }).then((res) => {
          if (!res.ok) throw new Error('Failed');
          setCellState(entry.id, 'hours', 'saved');
        }).catch(() => {
          setCellState(entry.id, 'hours', 'idle');
        }),
      );
    }
    if (minsChanged) {
      setCellState(entry.id, 'minutes', 'saving');
      saves.push(
        fetch('/api/dtr', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ notionId: entry.id, field: 'minutes', value: val.minutes }),
        }).then((res) => {
          if (!res.ok) throw new Error('Failed');
          setCellState(entry.id, 'minutes', 'saved');
        }).catch(() => {
          setCellState(entry.id, 'minutes', 'idle');
        }),
      );
    }

    try {
      await Promise.all(saves);
    } catch {
      // Revert on failure
      setLocalEntries((prev) =>
        prev.map((e) => (e.id === entry.id ? { ...e, hours: entry.hours, minutes: entry.minutes } : e)),
      );
    }
  }, []);

  // ── Delete ─────────────────────────────────────────────────
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const deleteEntry = useCallback(async (entry: MyDTREntry) => {
    if (!(await confirmAction({ title: 'Delete this DTR entry?', confirmLabel: 'Delete', danger: true }))) return;
    setDeletingId(entry.id);

    // Optimistic remove
    setLocalEntries((prev) => prev.filter((e) => e.id !== entry.id));

    try {
      const res = await fetch('/api/dtr', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notionId: entry.id }),
      });
      if (!res.ok) {
        // Revert
        setLocalEntries((prev) => [...prev, entry]);
        const err = await res.json().catch(() => ({ error: 'Delete failed' }));
        toast.error(`Delete failed: ${err.error}`);
      }
    } catch {
      setLocalEntries((prev) => [...prev, entry]);
      toast.error('Something went wrong');
    } finally {
      setDeletingId(null);
    }
  }, []);

  function handleKeyDown(e: React.KeyboardEvent, entry: MyDTREntry, field: string) {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveEdit(entry, field, editValue);
    } else if (e.key === 'Escape') {
      cancelEditing();
    }
  }

  // ── Quick-add ───────────────────────────────────────────────

  async function handleQuickAdd() {
    if (!addValues.remarks || !addValues.task) return;
    setAddSaving(true);
    try {
      const res = await fetch('/api/dtr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          remarks: addValues.remarks,
          task: addValues.task,
          date: addValues.date,
          hours: addValues.hours,
          minutes: addValues.minutes,
          withIds: [],
          matterId: null,
        }),
      });
      const data = await res.json().catch(() => ({ error: 'Failed' }));
      if (!res.ok) {
        toast.error(`Failed: ${data.error}`);
        return;
      }
      // Reset and hand the created row up so it appears without a refresh
      setAddValues({
        remarks: '',
        task: '',
        date: manilaToday(),
        hours: 1,
        minutes: 0,
      });
      setAddOpen(false);
      if (data.entry) onEntryCreated?.(data.entry);
    } catch {
      toast.error('Something went wrong');
    } finally {
      setAddSaving(false);
    }
  }

  // ── Cell save indicator ─────────────────────────────────────

  function SaveIndicator({ rowId, field }: { rowId: string; field: string }) {
    const state = getCellState(rowId, field);
    if (state === 'saving') return <Loader2 className="w-3 h-3 text-gold-500 animate-spin dark:text-gold-400" />;
    if (state === 'saved') return <Check className="w-3 h-3 text-emerald-500 dark:text-emerald-400" />;
    return null;
  }

  // ── Render cell (editing vs display) ────────────────────────

  function renderCell(entry: MyDTREntry, field: string) {
    const isEditing = editingCell?.rowId === entry.id && editingCell?.field === field;

    switch (field) {
      case 'date': {
        if (isEditing) {
          return (
            <>
              <div
                ref={(el) => { editAnchorRef.current = el; }}
                className="flex items-center gap-1 min-h-[28px] rounded px-1 -mx-1 bg-gold-50/50 dark:bg-gold-500/10"
              >
                <span className="text-stone-600 dark:text-stone-300">{fmtDate(entry.date)}</span>
              </div>
              <CellDatePicker
                value={entry.date}
                anchorRef={editAnchorRef}
                onSelect={(date) => {
                  saveEdit(entry, field, date);
                }}
                onClose={cancelEditing}
              />
            </>
          );
        }
        return (
          <div
            onClick={(e) => {
              editAnchorRef.current = e.currentTarget;
              startEditing(entry, field);
            }}
            className="group/cell flex items-center gap-1 min-h-[28px] cursor-pointer rounded px-1 -mx-1 hover:bg-gold-50/50 dark:hover:bg-gold-500/10 transition-colors"
          >
            <span className="text-stone-600 dark:text-stone-300">{fmtDate(entry.date)}</span>
            <SaveIndicator rowId={entry.id} field={field} />
          </div>
        );
      }

      case 'task': {
        if (isEditing) {
          return (
            <>
              <div
                ref={(el) => { editAnchorRef.current = el; }}
                className="flex items-center gap-1.5 min-h-[28px] rounded px-1 -mx-1 bg-gold-50/50 dark:bg-gold-500/10"
              >
                {entry.task ? (
                  <span className="inline-block px-2 py-0.5 text-xs font-medium rounded-md bg-stone-100 text-stone-600 dark:bg-stone-700 dark:text-stone-300">
                    {entry.task}
                  </span>
                ) : (
                  <span className="text-stone-300 dark:text-stone-600">—</span>
                )}
              </div>
              <CellDropdown
                mode="single"
                options={TASK_DROPDOWN_OPTIONS}
                value={entry.task || null}
                anchorRef={editAnchorRef}
                onSelect={(id) => {
                  saveEdit(entry, field, id ?? '');
                }}
                onClose={cancelEditing}
                placeholder="Search tasks..."
              />
            </>
          );
        }
        return (
          <div
            onClick={(e) => {
              editAnchorRef.current = e.currentTarget;
              startEditing(entry, field);
            }}
            className="group/cell flex items-center gap-1.5 min-h-[28px] cursor-pointer rounded px-1 -mx-1 hover:bg-gold-50/50 dark:hover:bg-gold-500/10 transition-colors"
          >
            {entry.task ? (
              <span className="inline-block px-2 py-0.5 text-xs font-medium rounded-md bg-stone-100 text-stone-600 dark:bg-stone-700 dark:text-stone-300">
                {entry.task}
              </span>
            ) : (
              <span className="text-stone-300 dark:text-stone-600">—</span>
            )}
            <Pencil className="w-3 h-3 text-stone-400 dark:text-stone-500 opacity-0 group-hover/cell:opacity-100 transition-opacity shrink-0" />
            <SaveIndicator rowId={entry.id} field={field} />
          </div>
        );
      }

      case 'remarks': {
        if (isEditing) {
          return (
            <input
              ref={editInputRef as React.RefObject<HTMLInputElement>}
              type="text"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={() => saveEdit(entry, field, editValue)}
              onKeyDown={(e) => handleKeyDown(e, entry, field)}
              className="w-full px-1.5 py-0.5 text-sm border border-gold-300 rounded bg-white dark:bg-stone-800 dark:text-stone-100 dark:border-gold-500/40 focus:outline-none focus:ring-2 focus:ring-gold-400/30"
            />
          );
        }
        return (
          <div
            onClick={() => startEditing(entry, field)}
            className="group/cell flex items-center gap-1 min-h-[28px] cursor-pointer rounded px-1 -mx-1 hover:bg-gold-50/50 dark:hover:bg-gold-500/10 transition-colors"
          >
            <span className="text-stone-700 dark:text-stone-200 line-clamp-2">{entry.remarks || '—'}</span>
            <SaveIndicator rowId={entry.id} field={field} />
          </div>
        );
      }

      default:
        return null;
    }
  }

  // Combined hours+minutes cell — click to edit both at once
  function renderHoursCell(entry: MyDTREntry) {
    const isEditing = editingCell?.rowId === entry.id && editingCell?.field === 'duration';

    if (isEditing) {
      const { hours: h, minutes: m } = editValue as { hours: number; minutes: number };
      return (
        <div className="flex items-center gap-1">
          <div className="flex items-center gap-0.5">
            <input
              ref={editInputRef as React.RefObject<HTMLInputElement>}
              type="number"
              min={0}
              value={h}
              onChange={(e) => setEditValue({ hours: Math.max(0, parseInt(e.target.value) || 0), minutes: m })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  saveDuration(entry, editValue);
                } else if (e.key === 'Escape') {
                  cancelEditing();
                }
              }}
              className="w-10 px-1 py-0.5 text-sm text-center border border-gold-300 rounded bg-white dark:bg-stone-800 dark:text-stone-100 dark:border-gold-500/40 focus:outline-none focus:ring-2 focus:ring-gold-400/30 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
            <span className="text-[10px] text-stone-400 dark:text-stone-500">h</span>
          </div>
          <div className="flex items-center gap-0.5">
            <input
              type="number"
              min={0}
              max={59}
              value={m}
              onChange={(e) => setEditValue({ hours: h, minutes: Math.min(59, Math.max(0, parseInt(e.target.value) || 0)) })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  saveDuration(entry, editValue);
                } else if (e.key === 'Escape') {
                  cancelEditing();
                }
              }}
              onBlur={() => saveDuration(entry, editValue)}
              className="w-10 px-1 py-0.5 text-sm text-center border border-gold-300 rounded bg-white dark:bg-stone-800 dark:text-stone-100 dark:border-gold-500/40 focus:outline-none focus:ring-2 focus:ring-gold-400/30 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
            <span className="text-[10px] text-stone-400 dark:text-stone-500">m</span>
          </div>
        </div>
      );
    }

    const hourState = getCellState(entry.id, 'hours');
    const minState = getCellState(entry.id, 'minutes');
    const isSaving = hourState === 'saving' || minState === 'saving';
    const isSaved = hourState === 'saved' || minState === 'saved';

    return (
      <div
        onClick={() => {
          setEditingCell({ rowId: entry.id, field: 'duration' });
          setEditValue({ hours: entry.hours, minutes: entry.minutes });
        }}
        className="group/cell flex items-center gap-1 min-h-[28px] cursor-pointer rounded px-1 -mx-1 hover:bg-gold-50/50 dark:hover:bg-gold-500/10 transition-colors"
      >
        <span className="font-medium text-stone-800 dark:text-stone-100 tabular-nums">
          {fmtHours(entry.hours, entry.minutes)}
        </span>
        <span className="text-[10px] text-stone-400 dark:text-stone-500 hidden group-hover/cell:inline">
          ({entry.hours}h {entry.minutes}m)
        </span>
        {isSaving && <Loader2 className="w-3 h-3 text-gold-500 animate-spin dark:text-gold-400" />}
        {isSaved && <Check className="w-3 h-3 text-emerald-500 dark:text-emerald-400" />}
      </div>
    );
  }

  // ── Lawyers cell (people multi-select) ────────────────────

  function LawyersEditor({ entry }: { entry: MyDTREntry }) {
    const [search, setSearch] = useState('');
    const [selectedIds, setSelectedIds] = useState<string[]>(entry.withIds ?? []);
    const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number; width: number } | null>(null);
    const anchorRef = useRef<HTMLDivElement>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
      if (anchorRef.current) {
        const rect = anchorRef.current.getBoundingClientRect();
        setDropdownPos({ top: rect.bottom + 4, left: rect.left, width: Math.max(rect.width, 220) });
      }
      requestAnimationFrame(() => inputRef.current?.focus());
    }, []);

    // Close on outside click
    useEffect(() => {
      function handleClick(e: MouseEvent) {
        const target = e.target as Node;
        if (
          anchorRef.current && !anchorRef.current.contains(target) &&
          dropdownRef.current && !dropdownRef.current.contains(target)
        ) {
          handleSave();
        }
      }
      document.addEventListener('mousedown', handleClick, true);
      return () => document.removeEventListener('mousedown', handleClick, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedIds]);

    function handleSave() {
      // Compare with original
      const original = entry.withIds ?? [];
      const changed = selectedIds.length !== original.length || selectedIds.some((id, i) => id !== original[i]);
      if (changed) {
        saveEdit(entry, 'withIds', selectedIds);
      } else {
        cancelEditing();
      }
    }

    function toggle(id: string) {
      setSelectedIds((prev) =>
        prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id],
      );
    }

    const filtered = useMemo(() => {
      if (!search) return allLawyers;
      const q = search.toLowerCase();
      return allLawyers.filter(
        (l) => l.name.toLowerCase().includes(q) || l.initials.toLowerCase().includes(q),
      );
    }, [search]);

    return (
      <div ref={anchorRef}>
        {/* Selected chips */}
        <div className="flex flex-wrap gap-1 mb-1">
          {selectedIds.map((id) => {
            const lawyer = allLawyers.find((l) => l.id === id);
            return (
              <span
                key={id}
                className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium bg-gold-50 text-gold-700 border border-gold-200/60 rounded-full dark:bg-gold-500/10 dark:text-gold-300 dark:border-gold-500/30"
              >
                {lawyer?.initials ?? FORMER_MEMBER}
                <button
                  type="button"
                  onClick={() => toggle(id)}
                  className="text-gold-400 hover:text-red-500 cursor-pointer dark:hover:text-red-400"
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              </span>
            );
          })}
        </div>

        {/* Dropdown */}
        {dropdownPos && createPortal(
          <div
            ref={dropdownRef}
            className="fixed z-[100] bg-white border border-stone-200 rounded-lg shadow-lg shadow-stone-900/5 overflow-hidden animate-fade-down dark:bg-stone-900 dark:border-stone-700"
            style={{ top: dropdownPos.top, left: dropdownPos.left, width: dropdownPos.width }}
          >
            <div className="p-1.5 border-b border-stone-100 dark:border-stone-800">
              <div className="flex items-center gap-1.5 px-2 py-1 bg-stone-50 rounded-md dark:bg-stone-800">
                <Search className="w-3 h-3 text-stone-400 dark:text-stone-500 shrink-0" />
                <input
                  ref={inputRef}
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Escape') handleSave(); }}
                  placeholder="Search..."
                  className="flex-1 text-xs bg-transparent outline-none placeholder:text-stone-400 text-stone-800 dark:text-stone-200 dark:placeholder:text-stone-500"
                />
              </div>
            </div>
            <div className="max-h-36 overflow-y-auto py-0.5">
              {filtered.length === 0 ? (
                <p className="px-3 py-3 text-xs text-stone-400 dark:text-stone-500 text-center">No lawyers found</p>
              ) : (
                filtered.map((lawyer) => {
                  const isSelected = selectedIds.includes(lawyer.id);
                  return (
                    <button
                      key={lawyer.id}
                      type="button"
                      onClick={() => toggle(lawyer.id)}
                      className={`w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-left transition-colors cursor-pointer ${
                        isSelected ? 'bg-gold-50/80 text-gold-700 dark:bg-gold-500/15 dark:text-gold-300' : 'text-stone-700 hover:bg-stone-50 dark:text-stone-300 dark:hover:bg-stone-800'
                      }`}
                    >
                      <span className="w-5 h-5 rounded-full bg-gold-100 text-gold-700 dark:bg-gold-500/15 dark:text-gold-300 text-[9px] font-bold flex items-center justify-center shrink-0">
                        {lawyer.initials}
                      </span>
                      <span className="flex-1 truncate">{lawyer.name}</span>
                      {isSelected && <Check className="w-3 h-3 text-gold-600 dark:text-gold-400 shrink-0" />}
                    </button>
                  );
                })
              )}
            </div>
            <div className="p-1.5 border-t border-stone-100 dark:border-stone-800">
              <button
                type="button"
                onClick={handleSave}
                className="w-full px-2 py-1 text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-300 dark:hover:bg-emerald-500/20 rounded-md transition-colors cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>,
          document.body,
        )}
      </div>
    );
  }

  function renderLawyersCell(entry: MyDTREntry) {
    const isEditing = editingCell?.rowId === entry.id && editingCell?.field === 'withIds';
    const state = getCellState(entry.id, 'withIds');

    if (isEditing) {
      return <LawyersEditor entry={entry} />;
    }

    return (
      <div
        onClick={async () => {
          await ensureLawyers();
          setEditingCell({ rowId: entry.id, field: 'withIds' });
          setEditValue(entry.withIds ?? []);
        }}
        className="group/cell flex items-center gap-1 min-h-[28px] cursor-pointer rounded px-1 -mx-1 hover:bg-gold-50/50 dark:hover:bg-gold-500/10 transition-colors"
      >
        {entry.withNames.length > 0 ? (
          <span className="text-xs text-stone-500 dark:text-stone-400 truncate">{entry.withNames.join(', ')}</span>
        ) : (
          <span className="text-xs text-stone-300 dark:text-stone-600">—</span>
        )}
        {state === 'saving' && <Loader2 className="w-3 h-3 text-gold-500 animate-spin shrink-0 dark:text-gold-400" />}
        {state === 'saved' && <Check className="w-3 h-3 text-emerald-500 shrink-0 dark:text-emerald-400" />}
      </div>
    );
  }

  // ── Quick-add row render ────────────────────────────────────

  function renderAddRow() {
    if (!addOpen) return null;

    return (
      <tr className="bg-gold-50/30 border-t-2 border-gold-200/60 dark:bg-gold-500/5 dark:border-gold-500/20">
        <td className="px-4 py-2">
          <CellDateTrigger
            value={addValues.date}
            placeholder="Date"
            onClick={(e) => {
              addDateAnchorRef.current = e.currentTarget;
              setAddDateOpen(true);
            }}
          />
          {addDateOpen && (
            <CellDatePicker
              value={addValues.date}
              anchorRef={addDateAnchorRef}
              onSelect={(date) => {
                setAddValues((v) => ({ ...v, date: date ?? '' }));
                setAddDateOpen(false);
              }}
              onClose={() => setAddDateOpen(false)}
            />
          )}
        </td>
        <td className="px-4 py-2">
          <CellDropdownTrigger
            label={addValues.task || 'Select task'}
            hasValue={!!addValues.task}
            onClick={(e) => {
              addTaskAnchorRef.current = e.currentTarget;
              setAddTaskOpen(true);
            }}
          />
          {addTaskOpen && (
            <CellDropdown
              mode="single"
              options={TASK_DROPDOWN_OPTIONS}
              value={addValues.task || null}
              anchorRef={addTaskAnchorRef}
              onSelect={(id) => {
                setAddValues((v) => ({ ...v, task: id ?? '' }));
                setAddTaskOpen(false);
              }}
              onClose={() => setAddTaskOpen(false)}
              placeholder="Search tasks..."
            />
          )}
        </td>
        <td className="px-4 py-2">
          <input
            ref={addRemarksRef}
            type="text"
            value={addValues.remarks}
            onChange={(e) => setAddValues((v) => ({ ...v, remarks: e.target.value }))}
            onKeyDown={(e) => { if (e.key === 'Enter') handleQuickAdd(); if (e.key === 'Escape') setAddOpen(false); }}
            placeholder="What did you work on?"
            className="w-full px-1.5 py-1 text-sm border border-stone-200 rounded bg-white dark:bg-stone-800 dark:text-stone-100 dark:border-stone-700 dark:placeholder:text-stone-500 focus:outline-none focus:ring-2 focus:ring-gold-400/30 focus:border-gold-400 placeholder:text-stone-400"
          />
        </td>
        <td className="px-4 py-2">
          <div className="flex items-center gap-1">
            <div className="flex items-center border border-stone-200 rounded bg-white overflow-hidden dark:bg-stone-800 dark:border-stone-700">
              <button
                type="button"
                onClick={() => setAddValues((v) => ({ ...v, hours: Math.max(0, v.hours - 1) }))}
                className="px-1.5 py-1 text-stone-400 hover:text-stone-600 hover:bg-stone-50 dark:text-stone-500 dark:hover:text-stone-200 dark:hover:bg-stone-700 transition-colors cursor-pointer"
              >
                <Minus className="w-3 h-3" />
              </button>
              <input
                type="number"
                min={0}
                value={addValues.hours}
                onChange={(e) => setAddValues((v) => ({ ...v, hours: Math.max(0, parseInt(e.target.value) || 0) }))}
                className="w-8 text-center text-sm py-1 bg-transparent outline-none tabular-nums [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
              <button
                type="button"
                onClick={() => setAddValues((v) => ({ ...v, hours: v.hours + 1 }))}
                className="px-1.5 py-1 text-stone-400 hover:text-stone-600 hover:bg-stone-50 dark:text-stone-500 dark:hover:text-stone-200 dark:hover:bg-stone-700 transition-colors cursor-pointer"
              >
                <Plus className="w-3 h-3" />
              </button>
            </div>
            <span className="text-[10px] text-stone-400 dark:text-stone-500">h</span>
            <div className="flex items-center border border-stone-200 rounded bg-white overflow-hidden dark:bg-stone-800 dark:border-stone-700">
              <button
                type="button"
                onClick={() => setAddValues((v) => ({ ...v, minutes: Math.max(0, v.minutes - 10) }))}
                className="px-1.5 py-1 text-stone-400 hover:text-stone-600 hover:bg-stone-50 dark:text-stone-500 dark:hover:text-stone-200 dark:hover:bg-stone-700 transition-colors cursor-pointer"
              >
                <Minus className="w-3 h-3" />
              </button>
              <input
                type="number"
                min={0}
                max={59}
                value={addValues.minutes}
                onChange={(e) => setAddValues((v) => ({ ...v, minutes: Math.min(59, Math.max(0, parseInt(e.target.value) || 0)) }))}
                className="w-8 text-center text-sm py-1 bg-transparent outline-none tabular-nums [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
              <button
                type="button"
                onClick={() => setAddValues((v) => ({ ...v, minutes: Math.min(59, v.minutes + 10) }))}
                className="px-1.5 py-1 text-stone-400 hover:text-stone-600 hover:bg-stone-50 dark:text-stone-500 dark:hover:text-stone-200 dark:hover:bg-stone-700 transition-colors cursor-pointer"
              >
                <Plus className="w-3 h-3" />
              </button>
            </div>
            <span className="text-[10px] text-stone-400 dark:text-stone-500">m</span>
          </div>
        </td>
        <td className="px-4 py-2" />
        <td className="px-4 py-2">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handleQuickAdd}
              disabled={addSaving || !addValues.remarks || !addValues.task}
              className="p-1.5 rounded-md bg-emerald-50 text-emerald-600 hover:bg-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-400 dark:hover:bg-emerald-500/20 transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
              title="Save"
            >
              {addSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
            </button>
            <button
              type="button"
              onClick={() => setAddOpen(false)}
              className="p-1.5 rounded-md text-stone-400 hover:bg-stone-100 hover:text-stone-600 dark:text-stone-500 dark:hover:bg-stone-800 dark:hover:text-stone-200 transition-colors cursor-pointer"
              title="Cancel"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-stone-700 dark:text-stone-200">Records</h3>
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-gold-700 bg-gold-50 hover:bg-gold-100 border border-gold-200/60 dark:bg-gold-500/10 dark:text-gold-300 dark:hover:bg-gold-500/20 dark:border-gold-500/30 rounded-lg transition-colors cursor-pointer"
        >
          <Plus className="w-3 h-3" />
          Quick Add
        </button>
      </div>

      {/* Desktop table */}
      <div className="hidden md:block overflow-x-auto rounded-xl border border-stone-200 bg-white shadow-[var(--shadow-card)] dark:border-stone-800 dark:bg-stone-900">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-stone-100 bg-stone-50/60 dark:border-stone-800 dark:bg-stone-800/40">
              {([
                ['date', 'Date'],
                ['task', 'Task'],
                [null, 'Remarks'],
                [null, 'Client'],
                [null, 'Matter'],
                ['hours', 'Hours'],
                [null, 'Lawyers'],
                [null, ''],
              ] as const).map(([key, label], i) => (
                <th
                  key={i}
                  className={`px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500 ${
                    key ? 'cursor-pointer select-none hover:text-stone-600 dark:hover:text-stone-300 transition-colors duration-150' : ''
                  } ${label === 'Client' || label === 'Matter' ? 'hidden lg:table-cell' : ''}`}
                  onClick={() => key && toggleSort(key as SortKey)}
                >
                  <span className="flex items-center gap-1">
                    {label}
                    {key && <SortIcon col={key as SortKey} />}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
            {renderAddRow()}
            {sorted.length === 0 && !addOpen ? (
              <tr>
                <td colSpan={8} className="px-4 py-12 text-center text-sm text-stone-400 dark:text-stone-500">
                  No DTR entries for this month
                </td>
              </tr>
            ) : (
              sorted.map((e) => (
                <tr key={e.id} className="group hover:bg-gold-50/30 dark:hover:bg-gold-500/5 transition-colors duration-100">
                  <td className="px-4 py-2.5 whitespace-nowrap">
                    {renderCell(e, 'date')}
                  </td>
                  <td className="px-4 py-2.5">
                    {renderCell(e, 'task')}
                  </td>
                  <td className="px-4 py-2.5 max-w-sm">
                    {renderCell(e, 'remarks')}
                  </td>
                  <td className="hidden lg:table-cell px-4 py-2.5 text-xs text-stone-500 dark:text-stone-400 max-w-[150px] truncate" title={e.clientName || '—'}>
                    {e.clientName || <span className="text-stone-300 dark:text-stone-600">—</span>}
                  </td>
                  <td className="hidden lg:table-cell px-4 py-2.5 text-xs text-stone-500 dark:text-stone-400 max-w-[180px] truncate" title={e.matterName || '—'}>
                    {e.matterName ? (
                      e.matterId ? (
                        <a href={`/dashboard/matters/${e.matterId}`} className="hover:text-gold-600 dark:hover:text-gold-400 transition-colors">
                          {e.matterName}
                        </a>
                      ) : e.matterName
                    ) : <span className="text-stone-300 dark:text-stone-600">—</span>}
                  </td>
                  <td className="px-4 py-2.5 whitespace-nowrap">
                    {renderHoursCell(e)}
                  </td>
                  <td className="px-4 py-2.5 text-stone-500 dark:text-stone-400 text-xs max-w-[180px]">
                    {renderLawyersCell(e)}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-1.5">
                      {e.url && (
                        <a
                          href={e.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-stone-300 hover:text-gold-600 dark:text-stone-600 dark:hover:text-gold-400 transition-colors duration-150"
                          title="Open in Notion"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      )}
                      <button
                        type="button"
                        onClick={() => deleteEntry(e)}
                        disabled={deletingId === e.id}
                        className="text-stone-300 hover:text-red-500 dark:text-stone-600 dark:hover:text-red-400 transition-colors duration-150 opacity-0 group-hover:opacity-100 cursor-pointer disabled:opacity-50"
                        title="Delete entry"
                      >
                        {deletingId === e.id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="md:hidden space-y-2">
        {/* Mobile quick-add */}
        {addOpen && (
          <div className="bg-gold-50/50 rounded-xl border-2 border-gold-200/60 p-4 space-y-3 dark:bg-gold-500/5 dark:border-gold-500/30">
            <input
              ref={addRemarksRef}
              type="text"
              value={addValues.remarks}
              onChange={(e) => setAddValues((v) => ({ ...v, remarks: e.target.value }))}
              placeholder="What did you work on?"
              className="w-full px-3 py-2 text-sm border border-stone-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-gold-400/30 placeholder:text-stone-400 dark:bg-stone-800 dark:text-stone-100 dark:border-stone-700 dark:placeholder:text-stone-500"
            />
            <div className="grid grid-cols-2 gap-2">
              <CellDropdownTrigger
                label={addValues.task || 'Task'}
                hasValue={!!addValues.task}
                onClick={(e) => {
                  addTaskAnchorRef.current = e.currentTarget;
                  setAddTaskOpen(true);
                }}
              />
              <CellDateTrigger
                value={addValues.date}
                placeholder="Date"
                onClick={(e) => {
                  addDateAnchorRef.current = e.currentTarget;
                  setAddDateOpen(true);
                }}
              />
              {addTaskOpen && (
                <CellDropdown
                  mode="single"
                  options={TASK_DROPDOWN_OPTIONS}
                  value={addValues.task || null}
                  anchorRef={addTaskAnchorRef}
                  onSelect={(id) => {
                    setAddValues((v) => ({ ...v, task: id ?? '' }));
                    setAddTaskOpen(false);
                  }}
                  onClose={() => setAddTaskOpen(false)}
                  placeholder="Search tasks..."
                />
              )}
              {addDateOpen && (
                <CellDatePicker
                  value={addValues.date}
                  anchorRef={addDateAnchorRef}
                  onSelect={(date) => {
                    setAddValues((v) => ({ ...v, date: date ?? '' }));
                    setAddDateOpen(false);
                  }}
                  onClose={() => setAddDateOpen(false)}
                />
              )}
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1">
                <span className="text-xs text-stone-500 dark:text-stone-400">Hours:</span>
                <input
                  type="number"
                  min={0}
                  value={addValues.hours}
                  onChange={(e) => setAddValues((v) => ({ ...v, hours: Math.max(0, parseInt(e.target.value) || 0) }))}
                  className="w-12 text-center text-sm py-1 border border-stone-200 rounded bg-white dark:bg-stone-800 dark:text-stone-100 dark:border-stone-700 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
              </div>
              <div className="flex items-center gap-1">
                <span className="text-xs text-stone-500 dark:text-stone-400">Min:</span>
                <input
                  type="number"
                  min={0}
                  max={59}
                  value={addValues.minutes}
                  onChange={(e) => setAddValues((v) => ({ ...v, minutes: Math.min(59, Math.max(0, parseInt(e.target.value) || 0)) }))}
                  className="w-12 text-center text-sm py-1 border border-stone-200 rounded bg-white dark:bg-stone-800 dark:text-stone-100 dark:border-stone-700 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
              </div>
              <div className="flex-1" />
              <button
                type="button"
                onClick={handleQuickAdd}
                disabled={addSaving || !addValues.remarks || !addValues.task}
                className="px-3 py-1.5 text-xs font-semibold text-white bg-gold-600 hover:bg-gold-700 rounded-lg disabled:opacity-40 cursor-pointer"
              >
                {addSaving ? 'Saving...' : 'Add'}
              </button>
              <button
                type="button"
                onClick={() => setAddOpen(false)}
                className="p-1.5 text-stone-400 hover:text-stone-600 dark:text-stone-500 dark:hover:text-stone-200 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {sorted.length === 0 && !addOpen ? (
          <div className="text-center text-sm text-stone-400 dark:text-stone-500 py-12">
            No DTR entries for this month
          </div>
        ) : (
          sorted.map((e) => (
            <div
              key={e.id}
              className="bg-white rounded-xl border border-stone-200 p-4 space-y-2 dark:bg-stone-900 dark:border-stone-800"
            >
              <div className="flex items-center justify-between">
                <span
                  className="text-sm font-medium text-stone-700 dark:text-stone-200 cursor-pointer hover:text-gold-600 dark:hover:text-gold-400 transition-colors"
                  onClick={(ev) => {
                    editAnchorRef.current = ev.currentTarget;
                    startEditing(e, 'date');
                  }}
                >
                  {fmtDate(e.date)}
                </span>
                {editingCell?.rowId === e.id && editingCell?.field === 'duration' ? (
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      min={0}
                      value={(editValue as { hours: number; minutes: number }).hours}
                      onChange={(ev) => setEditValue({ ...(editValue as { hours: number; minutes: number }), hours: Math.max(0, parseInt(ev.target.value) || 0) })}
                      autoFocus
                      className="w-10 px-1 py-0.5 text-sm text-center border border-gold-300 rounded bg-white [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none dark:bg-stone-900 dark:text-stone-100 dark:border-gold-500/40"
                    />
                    <span className="text-[10px] text-stone-400 dark:text-stone-500">h</span>
                    <input
                      type="number"
                      min={0}
                      max={59}
                      value={(editValue as { hours: number; minutes: number }).minutes}
                      onChange={(ev) => setEditValue({ ...(editValue as { hours: number; minutes: number }), minutes: Math.min(59, Math.max(0, parseInt(ev.target.value) || 0)) })}
                      onBlur={() => saveDuration(e, editValue as { hours: number; minutes: number })}
                      className="w-10 px-1 py-0.5 text-sm text-center border border-gold-300 rounded bg-white [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none dark:bg-stone-900 dark:text-stone-100 dark:border-gold-500/40"
                    />
                    <span className="text-[10px] text-stone-400 dark:text-stone-500">m</span>
                  </div>
                ) : (
                  <span
                    className="text-sm font-semibold text-stone-800 dark:text-stone-100 tabular-nums cursor-pointer hover:text-gold-600 dark:hover:text-gold-400 transition-colors"
                    onClick={() => {
                      setEditingCell({ rowId: e.id, field: 'duration' });
                      setEditValue({ hours: e.hours, minutes: e.minutes });
                    }}
                  >
                    {fmtHours(e.hours, e.minutes)}
                  </span>
                )}
              </div>
              {e.task && (
                <span
                  className="inline-block px-2 py-0.5 text-xs font-medium rounded-md bg-stone-100 text-stone-600 dark:bg-stone-700 dark:text-stone-300 cursor-pointer hover:bg-gold-50 dark:hover:bg-gold-500/10 transition-colors"
                  onClick={(ev) => {
                    editAnchorRef.current = ev.currentTarget;
                    startEditing(e, 'task');
                  }}
                >
                  {e.task}
                </span>
              )}
              {editingCell?.rowId === e.id && editingCell?.field === 'remarks' ? (
                <input
                  type="text"
                  value={editValue}
                  onChange={(ev) => setEditValue(ev.target.value)}
                  onBlur={() => saveEdit(e, 'remarks', editValue)}
                  onKeyDown={(ev) => { if (ev.key === 'Enter') saveEdit(e, 'remarks', editValue); }}
                  autoFocus
                  className="w-full px-2 py-1 text-xs border border-gold-300 rounded bg-white dark:bg-stone-800 dark:text-stone-100 dark:border-gold-500/40"
                />
              ) : (
                e.remarks && (
                  <p
                    className="text-xs text-stone-600 dark:text-stone-300 line-clamp-3 cursor-pointer hover:text-gold-700 dark:hover:text-gold-400 transition-colors"
                    onClick={() => startEditing(e, 'remarks')}
                  >
                    {e.remarks}
                  </p>
                )
              )}
              {(e.clientName || e.matterName) && (
                <p className="text-[11px] text-stone-400 dark:text-stone-500 truncate">
                  {[e.clientName, e.matterName].filter(Boolean).join(' · ')}
                </p>
              )}
              {e.withNames.length > 0 && (
                <p className="text-[11px] text-stone-400 dark:text-stone-500">
                  Lawyers: {e.withNames.join(', ')}
                </p>
              )}
              <div className="flex items-center justify-between">
                {e.url ? (
                  <a
                    href={e.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-gold-600 hover:text-gold-700 inline-flex items-center gap-1 dark:text-gold-400 dark:hover:text-gold-300"
                  >
                    Open in Notion
                    <ExternalLink className="w-3 h-3" />
                  </a>
                ) : <span />}
                <button
                  type="button"
                  onClick={() => deleteEntry(e)}
                  disabled={deletingId === e.id}
                  className="text-stone-300 hover:text-red-500 transition-colors duration-150 p-1 cursor-pointer disabled:opacity-50 dark:text-stone-600 dark:hover:text-red-400"
                  title="Delete entry"
                >
                  {deletingId === e.id ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
