'use client';

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  Search, X, Loader2, Check, ChevronUp, ChevronDown, Pencil,
} from 'lucide-react';
import DatePickerInput from '@/components/DatePickerInput';

interface Employee {
  person_id: string;
  notion_id: string;
  name: string;
  initials: string;
  position: string;
  role: string;
  active: boolean;
  start_date: string | null;
  end_date: string | null;
  monthly_salary: number | null;
}

const PHP_FORMATTER = new Intl.NumberFormat('en-PH', {
  style: 'currency',
  currency: 'PHP',
  maximumFractionDigits: 0,
});

function formatDate(iso: string | null): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-PH', {
    year: 'numeric', month: 'short', day: 'numeric',
  });
}

// ── Salary cell ─────────────────────────────────────────────────

function SalaryCell({
  value,
  personId,
  onSave,
}: {
  value: number | null;
  personId: string;
  onSave: (personId: string, field: 'monthly_salary', value: number | null) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value == null ? '' : String(value));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function beginEdit() {
    setDraft(value == null ? '' : String(value));
    setEditing(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  const commit = useCallback(async () => {
    const trimmed = draft.trim();
    const next: number | null = trimmed === '' ? null : Number(trimmed);
    if (next !== null && (!Number.isFinite(next) || next < 0)) return;
    if (next === value) {
      setEditing(false);
      return;
    }
    setSaving(true);
    const ok = await onSave(personId, 'monthly_salary', next);
    setSaving(false);
    if (ok) {
      setEditing(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    }
  }, [draft, value, personId, onSave]);

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <div className="relative flex-1">
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-[var(--text-muted)]">
            ₱
          </span>
          <input
            ref={inputRef}
            type="number"
            min={0}
            step="100"
            inputMode="decimal"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit();
              if (e.key === 'Escape') setEditing(false);
            }}
            disabled={saving}
            className="w-full pl-5 pr-2 py-1 text-sm rounded-md bg-background border border-gold-400 text-foreground focus:outline-none focus:ring-1 focus:ring-gold-300 disabled:opacity-50 tabular-nums text-right"
          />
        </div>
        {saving && <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--text-muted)] shrink-0" />}
      </div>
    );
  }

  return (
    <div
      className="group/cell flex items-center gap-1.5 cursor-pointer justify-end"
      onClick={beginEdit}
    >
      <span className="text-sm text-foreground tabular-nums">
        {value == null ? '—' : PHP_FORMATTER.format(value)}
      </span>
      {saved ? (
        <Check className="w-3 h-3 text-emerald-600 shrink-0 dark:text-emerald-400" />
      ) : (
        <Pencil className="w-3 h-3 text-[var(--text-muted)] opacity-0 group-hover/cell:opacity-100 transition-opacity shrink-0" />
      )}
    </div>
  );
}

// ── Date cell ─────────────────────────────────────────────────

function DateCell({
  value,
  personId,
  field,
  onSave,
}: {
  value: string | null;
  personId: string;
  field: 'start_date' | 'end_date';
  onSave: (personId: string, field: 'start_date' | 'end_date', value: string | null) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(false);

  async function handleChange(next: string | null) {
    if (next === value) {
      setEditing(false);
      return;
    }
    setSaving(true);
    setError(false);
    const ok = await onSave(personId, field, next);
    setSaving(false);
    if (ok) {
      setEditing(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } else {
      setError(true);
      setTimeout(() => setError(false), 2000);
    }
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1.5">
        <DatePickerInput
          value={value}
          onChange={handleChange}
          placeholder={field === 'start_date' ? 'Start date' : 'End date'}
          hasError={error}
        />
        {saving && <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--text-muted)] shrink-0" />}
      </div>
    );
  }

  return (
    <div
      className="group/cell flex items-center gap-1.5 cursor-pointer"
      onClick={() => setEditing(true)}
    >
      <span className="text-sm text-foreground tabular-nums">
        {value ? formatDate(value) : '—'}
      </span>
      {saved ? (
        <Check className="w-3 h-3 text-emerald-600 shrink-0 dark:text-emerald-400" />
      ) : (
        <Pencil className="w-3 h-3 text-[var(--text-muted)] opacity-0 group-hover/cell:opacity-100 transition-opacity shrink-0" />
      )}
    </div>
  );
}

// ── Component ───────────────────────────────────────────────────

export default function EmployeeCompensation() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [sortKey, setSortKey] = useState<keyof Employee>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch('/api/finance/employees');
        if (!res.ok) throw new Error('Failed to load employees');
        const json = await res.json();
        if (!cancelled) setEmployees(json.data ?? []);
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Failed to load');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return employees.filter((e) => {
      if (!showInactive && !e.active) return false;
      if (!q) return true;
      return (
        e.name.toLowerCase().includes(q) ||
        (e.position ?? '').toLowerCase().includes(q) ||
        (e.initials ?? '').toLowerCase().includes(q)
      );
    });
  }, [employees, searchQuery, showInactive]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const va = a[sortKey];
      const vb = b[sortKey];
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      let cmp: number;
      if (typeof va === 'boolean' && typeof vb === 'boolean') {
        cmp = (va ? 1 : 0) - (vb ? 1 : 0);
      } else if (typeof va === 'number' && typeof vb === 'number') {
        cmp = va - vb;
      } else {
        cmp = String(va).localeCompare(String(vb));
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [filtered, sortKey, sortDir]);

  function toggleSort(col: keyof Employee) {
    if (sortKey === col) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(col);
      setSortDir('asc');
    }
  }

  const handleFieldSave = useCallback(
    async (
      personId: string,
      field: 'monthly_salary' | 'start_date' | 'end_date',
      value: number | string | null,
    ): Promise<boolean> => {
      try {
        const res = await fetch('/api/finance/employees', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ personId, field, value }),
        });
        if (!res.ok) {
          const json = await res.json().catch(() => ({}));
          setUpdateError(json.error ?? 'Update failed');
          setTimeout(() => setUpdateError(null), 4000);
          return false;
        }
        setEmployees((prev) =>
          prev.map((m) => (m.person_id === personId ? { ...m, [field]: value } : m)),
        );
        return true;
      } catch (err) {
        setUpdateError(err instanceof Error ? err.message : 'Update failed');
        setTimeout(() => setUpdateError(null), 4000);
        return false;
      }
    },
    [],
  );

  function SortHeader({
    col, label, className,
  }: { col: keyof Employee; label: string; className?: string }) {
    const isSorted = sortKey === col;
    return (
      <th
        className={`sticky top-0 bg-background z-10 px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] border-b border-[var(--border-color)] cursor-pointer select-none hover:text-foreground transition-colors duration-150 ${className ?? ''}`}
        onClick={() => toggleSort(col)}
      >
        <span className="flex items-center gap-1">
          {label}
          {isSorted &&
            (sortDir === 'asc' ? (
              <ChevronUp className="w-3 h-3 text-gold-500 dark:text-gold-400" />
            ) : (
              <ChevronDown className="w-3 h-3 text-gold-500 dark:text-gold-400" />
            ))}
        </span>
      </th>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-[var(--text-muted)]" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="rounded-xl border border-red-300 bg-red-50 dark:border-red-900/50 dark:bg-red-950/30 p-4 text-sm text-red-700 dark:text-red-300">
        {loadError}
      </div>
    );
  }

  const totalActive = employees.filter((e) => e.active).length;
  const totalPayroll = employees
    .filter((e) => e.active && e.monthly_salary != null)
    .reduce((s, e) => s + (e.monthly_salary ?? 0), 0);

  return (
    <div>
      {/* Toolbar */}
      <div className="flex items-center justify-between mb-4 gap-4 flex-wrap">
        <div className="flex items-center gap-6 text-sm">
          <p className="text-[var(--text-secondary)]">
            <span className="font-semibold text-foreground tabular-nums">{sorted.length}</span>{' '}
            shown · {totalActive} active
          </p>
          <p className="text-[var(--text-secondary)]">
            Monthly payroll:{' '}
            <span className="font-semibold text-foreground tabular-nums">
              {PHP_FORMATTER.format(totalPayroll)}
            </span>
          </p>
        </div>

        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-[var(--text-secondary)] cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
              className="rounded border-[var(--border-color)] text-gold-500 focus:ring-gold-400"
            />
            Show inactive
          </label>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-muted)] pointer-events-none" />
            <input
              ref={searchRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search employees..."
              className="pl-8 pr-7 py-1.5 text-sm rounded-lg bg-[var(--subtle-bg)] border border-[var(--border-color)] text-foreground placeholder:text-[var(--text-muted)] focus:outline-none focus:border-gold-400 focus:ring-1 focus:ring-gold-300 w-48 sm:w-56 transition-all duration-150"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  searchRef.current?.focus();
                }}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-foreground cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>

      {updateError && (
        <div className="mb-3 rounded-lg border border-red-300 bg-red-50 dark:border-red-900/50 dark:bg-red-950/30 px-3 py-2 text-xs text-red-700 dark:text-red-300">
          {updateError}
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-[var(--border-color)] bg-card shadow-[var(--shadow-card)]">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <SortHeader col="name" label="Name" />
              <SortHeader col="position" label="Position" />
              <SortHeader col="start_date" label="Start Date" />
              <SortHeader col="end_date" label="End Date" />
              <SortHeader col="monthly_salary" label="Monthly Salary" className="text-right" />
              <SortHeader col="active" label="Status" />
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="px-3 py-12 text-center text-sm text-[var(--text-muted)]"
                >
                  No employees match.
                </td>
              </tr>
            ) : (
              sorted.map((e) => (
                <tr
                  key={e.notion_id}
                  className={`group hover:bg-[var(--subtle-bg)] transition-colors duration-100 ${e.active ? '' : 'opacity-60'}`}
                >
                  <td className="px-3 py-2 border-b border-[var(--border-color)] font-medium">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-[var(--subtle-bg)] text-[10px] font-semibold text-[var(--text-secondary)] shrink-0">
                        {e.initials || '??'}
                      </span>
                      <span className="truncate">{e.name}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2 border-b border-[var(--border-color)] text-sm text-[var(--text-secondary)]">
                    {e.position || '—'}
                  </td>
                  <td className="px-3 py-2 border-b border-[var(--border-color)]">
                    <DateCell
                      value={e.start_date}
                      personId={e.person_id}
                      field="start_date"
                      onSave={handleFieldSave}
                    />
                  </td>
                  <td className="px-3 py-2 border-b border-[var(--border-color)]">
                    <DateCell
                      value={e.end_date}
                      personId={e.person_id}
                      field="end_date"
                      onSave={handleFieldSave}
                    />
                  </td>
                  <td className="px-3 py-2 border-b border-[var(--border-color)]">
                    <SalaryCell
                      value={e.monthly_salary == null ? null : Number(e.monthly_salary)}
                      personId={e.person_id}
                      onSave={handleFieldSave}
                    />
                  </td>
                  <td className="px-3 py-2 border-b border-[var(--border-color)]">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                        e.active
                          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                          : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-500'
                      }`}
                    >
                      {e.active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
