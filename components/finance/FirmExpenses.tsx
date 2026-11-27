'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  Loader2, Receipt, AlertCircle, Search, X, Plus, Check,
  ChevronDown, Building2, Scale,
} from 'lucide-react';
import DatePickerInput from '@/components/DatePickerInput';
import { manilaToday } from '@/lib/dates';
import { confirmAction } from '@/components/ui/confirm';
import { toast } from 'sonner';

const EXPENSE_CATEGORIES = [
  'Filing Fees', 'Court Fees', 'Notarial', 'Transportation', 'Meals',
  'Printing', 'Postage', 'Supplies', 'Professional Fees', 'Other',
];

// Searchable dropdown (same pattern as FileReimbursementModal)
function DropdownSelect({
  label,
  icon: Icon,
  value,
  displayValue,
  placeholder,
  options,
  onSelect,
  onClear,
  getLabel,
  getSublabel,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  value: string | null;
  displayValue: string;
  placeholder: string;
  options: { id: string }[];
  onSelect: (id: string) => void;
  onClear?: () => void;
  getLabel: (o: { id: string }) => string;
  getSublabel?: (o: { id: string }) => string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen || !btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    setPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    function handleClick(e: MouseEvent) {
      const t = e.target as Node;
      if (
        btnRef.current && !btnRef.current.contains(t) &&
        dropRef.current && !dropRef.current.contains(t)
      ) {
        setIsOpen(false);
        setSearch('');
      }
    }
    document.addEventListener('mousedown', handleClick, true);
    return () => document.removeEventListener('mousedown', handleClick, true);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    requestAnimationFrame(() => setSearch(''));
  }, [isOpen]);

  const filtered = useMemo(() => {
    if (!search) return options;
    const q = search.toLowerCase();
    return options.filter((o) => {
      const l = getLabel(o).toLowerCase();
      const s = getSublabel?.(o)?.toLowerCase() ?? '';
      return l.includes(q) || s.includes(q);
    });
  }, [options, search, getLabel, getSublabel]);

  return (
    <div ref={containerRef} className="relative">
      <label className="block text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1">
        <span className="flex items-center gap-1.5"><Icon className="w-3 h-3" />{label}</span>
      </label>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setIsOpen((o) => !o)}
        className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-sm rounded-lg transition-all duration-150 cursor-pointer border ${
          isOpen
            ? 'border-gold-400 ring-2 ring-gold-400/20 bg-[var(--background)]'
            : 'border-[var(--border-color)] bg-[var(--background)] hover:border-[var(--text-muted)]'
        }`}
      >
        <span className={`truncate ${value ? 'text-foreground' : 'text-[var(--text-muted)]'}`}>
          {displayValue || placeholder}
        </span>
        <div className="flex items-center gap-0.5 shrink-0">
          {value && onClear && (
            <span
              role="button"
              onClick={(e) => { e.stopPropagation(); onClear(); setIsOpen(false); }}
              className="p-0.5 rounded hover:bg-[var(--subtle-bg)] text-[var(--text-muted)] hover:text-foreground transition-colors"
            >
              <X className="w-3 h-3" />
            </span>
          )}
          <ChevronDown className={`w-3.5 h-3.5 text-[var(--text-muted)] transition-transform duration-150 ${isOpen ? 'rotate-180' : ''}`} />
        </div>
      </button>

      {isOpen && pos && createPortal(
        <div
          ref={dropRef}
          className="fixed z-[100] bg-[var(--card-bg)] border border-[var(--border-color)] rounded-lg shadow-lg overflow-hidden"
          style={{ top: pos.top, left: pos.left, width: pos.width }}
        >
          <div className="p-2 border-b border-[var(--border-color)]">
            <div className="flex items-center gap-2 px-2.5 py-1.5 bg-[var(--subtle-bg)] rounded-md">
              <Search className="w-3.5 h-3.5 text-[var(--text-muted)] shrink-0" />
              <input
                ref={inputRef}
                type="text"
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Type to search..."
                className="flex-1 text-sm bg-transparent outline-none placeholder:text-[var(--text-muted)] text-foreground"
              />
            </div>
          </div>
          <div className="max-h-44 overflow-y-auto py-0.5">
            {filtered.length === 0 ? (
              <p className="px-3 py-4 text-sm text-[var(--text-muted)] text-center">No results found</p>
            ) : (
              filtered.map((opt) => {
                const isSelected = opt.id === value;
                const sub = getSublabel?.(opt);
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => { onSelect(opt.id); setIsOpen(false); setSearch(''); }}
                    className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-sm text-left transition-colors duration-75 cursor-pointer ${
                      isSelected
                        ? 'text-gold-700 dark:text-gold-400 bg-gold-50/80 dark:bg-gold-500/10'
                        : 'text-foreground hover:bg-[var(--subtle-bg)]'
                    }`}
                  >
                    <div className="min-w-0">
                      <span className={`truncate ${isSelected ? 'font-medium' : ''}`}>{getLabel(opt)}</span>
                      {sub && <span className={`text-xs ml-1.5 ${isSelected ? 'text-gold-500 dark:text-gold-400' : 'text-[var(--text-muted)]'}`}>{sub}</span>}
                    </div>
                    {isSelected && <Check className="w-3.5 h-3.5 text-gold-600 dark:text-gold-400 shrink-0" />}
                  </button>
                );
              })
            )}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

interface ClientOption {
  id: string;
  name: string;
}

interface MatterOption {
  id: string;
  name: string;
  code: string | null;
  clientId: string;
}

interface Expense {
  id: string;
  date: string;
  description: string;
  category: string;
  amount: number;
  clientName: string;
  matterName: string;
  billed: boolean;
  source: 'finance' | 'reimbursement';
}

interface ExpenseData {
  expenses: Expense[];
  total: number;
  totalAmount: number;
  billedAmount: number;
  unbilledAmount: number;
  byCategory: Record<string, number>;
}

function fmt(n: number) {
  return `₱${Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function FirmExpenses() {
  const [data, setData] = useState<ExpenseData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterBilled, setFilterBilled] = useState<'' | 'true' | 'false'>('');

  // Add expense modal state
  const [showAddModal, setShowAddModal] = useState(false);
  const [addSaving, setAddSaving] = useState(false);
  const [allClients, setAllClients] = useState<ClientOption[]>([]);
  const [allMatters, setAllMatters] = useState<MatterOption[]>([]);
  const [dataLoaded, setDataLoaded] = useState(false);
  const [clientId, setClientId] = useState<string | null>(null);
  const [matterId, setMatterId] = useState<string | null>(null);
  const [newExpense, setNewExpense] = useState({ description: '', amount: '', category: 'Filing Fees', date: manilaToday() });

  // Per-cell inline edit state (click any value to edit it)
  type ExpenseField = 'date' | 'description' | 'category' | 'amount';
  const [editingCell, setEditingCell] = useState<
    | { id: string; field: ExpenseField; value: string }
    | null
  >(null);
  const [savingCells, setSavingCells] = useState<Set<string>>(new Set());
  const [rowBusyId, setRowBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (showAddModal && !dataLoaded) {
      fetch('/api/clients-matters')
        .then((r) => r.json())
        .then((d) => {
          setAllClients(d.clients ?? []);
          setAllMatters(d.matters ?? []);
          setDataLoaded(true);
        })
        .catch(() => {});
    }
  }, [showAddModal, dataLoaded]);

  const filteredMatters = useMemo(() => {
    if (!clientId) return allMatters;
    return allMatters.filter((m) => m.clientId === clientId);
  }, [allMatters, clientId]);

  const selectedClient = allClients.find((c) => c.id === clientId);
  const selectedMatter = allMatters.find((m) => m.id === matterId);

  const handleClientSelect = useCallback((id: string) => {
    setClientId(id);
    if (matterId) {
      const m = allMatters.find((m) => m.id === matterId);
      if (m && m.clientId !== id) setMatterId(null);
    }
  }, [matterId, allMatters]);

  const handleMatterSelect = useCallback((id: string) => {
    setMatterId(id);
    const m = allMatters.find((m) => m.id === id);
    if (m?.clientId) setClientId(m.clientId);
  }, [allMatters]);

  const fetchExpenses = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (filterBilled) params.set('billed', filterBilled);
      const res = await fetch(`/api/finance/expenses?${params}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to fetch');
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load expenses');
    } finally {
      setLoading(false);
    }
  }, [filterBilled]);

  useEffect(() => { fetchExpenses(); }, [fetchExpenses]);

  const stripFinanceId = (id: string) => id.replace(/^mexp-/, '');
  const canEditCell = (exp: Expense) => exp.source === 'finance' && !exp.billed;

  const startEdit = useCallback((exp: Expense, field: ExpenseField) => {
    if (!canEditCell(exp)) return;
    let value = '';
    if (field === 'date') value = exp.date;
    else if (field === 'description') value = exp.description;
    else if (field === 'category') value = exp.category;
    else if (field === 'amount') value = String(exp.amount);
    setEditingCell({ id: exp.id, field, value });
  }, []);

  const cancelEdit = useCallback(() => setEditingCell(null), []);

  const isEditing = (id: string, field: ExpenseField) =>
    editingCell?.id === id && editingCell.field === field;
  const isSaving = (id: string, field: ExpenseField) =>
    savingCells.has(`${id}|${field}`);

  const saveExpenseCell = useCallback(async (
    exp: Expense,
    change: Record<string, unknown>,
  ) => {
    const cellKey = `${exp.id}|${Object.keys(change).join(',')}`;
    setSavingCells((s) => { const n = new Set(s); n.add(cellKey); return n; });
    try {
      const res = await fetch('/api/finance/matter-expenses', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: stripFinanceId(exp.id), ...change }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || 'Failed to update');
      }
      fetchExpenses();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update');
    } finally {
      setSavingCells((s) => { const n = new Set(s); n.delete(cellKey); return n; });
    }
  }, [fetchExpenses]);

  const commitEdit = useCallback(async (overrideValue?: string) => {
    if (!editingCell) return;
    const exp = (data?.expenses ?? []).find((e) => e.id === editingCell.id);
    const field = editingCell.field;
    const value = overrideValue !== undefined ? overrideValue : editingCell.value;
    setEditingCell(null);
    if (!exp) return;
    let change: Record<string, unknown> | null = null;
    if (field === 'date') {
      if (value && value !== exp.date) change = { expenseDate: value };
    } else if (field === 'description') {
      const v = value.trim();
      if (v && v !== exp.description) change = { description: v };
    } else if (field === 'category') {
      if (value && value !== exp.category) change = { category: value };
    } else if (field === 'amount') {
      const num = parseFloat(value);
      if (!Number.isNaN(num) && num >= 0 && num !== exp.amount) change = { amount: num };
    }
    if (change) await saveExpenseCell(exp, change);
  }, [editingCell, data, saveExpenseCell]);

  const handleDelete = useCallback(async (exp: Expense) => {
    if (!(await confirmAction({ title: `Delete "${exp.description}" (${fmt(exp.amount)})?`, confirmLabel: 'Delete', danger: true }))) return;
    setRowBusyId(exp.id);
    try {
      const res = await fetch(
        `/api/finance/matter-expenses?id=${encodeURIComponent(stripFinanceId(exp.id))}`,
        { method: 'DELETE' },
      );
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error || 'Failed to delete');
      }
      fetchExpenses();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete');
    } finally {
      setRowBusyId(null);
    }
  }, [fetchExpenses]);

  const handleAddExpense = useCallback(async () => {
    if (!matterId || !newExpense.description || !newExpense.amount || !newExpense.date) return;
    setAddSaving(true);
    try {
      const res = await fetch('/api/finance/matter-expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          matterId,
          description: newExpense.description,
          amount: parseFloat(newExpense.amount),
          category: newExpense.category,
          expenseDate: newExpense.date,
        }),
      });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error || 'Failed to add expense');
      }
      setShowAddModal(false);
      setClientId(null);
      setMatterId(null);
      setNewExpense({ description: '', amount: '', category: 'Filing Fees', date: manilaToday() });
      fetchExpenses();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed');
    } finally {
      setAddSaving(false);
    }
  }, [matterId, newExpense, fetchExpenses]);

  const filtered = (data?.expenses ?? []).filter((e) => {
    if (filterCategory && e.category !== filterCategory) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        e.description?.toLowerCase().includes(q) ||
        e.clientName?.toLowerCase().includes(q) ||
        e.matterName?.toLowerCase().includes(q) ||
        e.category?.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const filteredTotal = filtered.reduce((s, e) => s + e.amount, 0);

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-[var(--text-muted)]" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-foreground font-serif">
          Matter Expenses
        </h1>
        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-navy-900 dark:bg-gold-400 text-white dark:text-navy-950 hover:bg-navy-800 dark:hover:bg-gold-300 transition-all"
        >
          <Plus className="w-4 h-4" /> Add Expense
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10 border border-red-100 dark:border-red-500/20 rounded-xl px-4 py-3 mb-6">
          <AlertCircle className="w-4 h-4 shrink-0" /> {error}
        </div>
      )}

      {/* Summary cards */}
      {data && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
          <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] p-5 shadow-[var(--shadow-card)]">
            <p className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-2">Total Expenses</p>
            <p className="text-2xl font-bold text-foreground tabular-nums">{fmt(data.totalAmount)}</p>
            <p className="text-xs text-[var(--text-muted)] mt-1">{data.total} entries</p>
          </div>
          <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] p-5 shadow-[var(--shadow-card)]">
            <p className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-2">Billed</p>
            <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">{fmt(data.billedAmount)}</p>
          </div>
          <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] p-5 shadow-[var(--shadow-card)]">
            <p className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider mb-2">Unbilled</p>
            <p className="text-2xl font-bold text-amber-600 dark:text-amber-400 tabular-nums">{fmt(data.unbilledAmount)}</p>
          </div>
        </div>
      )}

      {/* Category breakdown */}
      {data && Object.keys(data.byCategory).length > 0 && (
        <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] p-5 mb-6 shadow-[var(--shadow-card)]">
          <h2 className="text-sm font-semibold text-foreground mb-3">By Category</h2>
          <div className="flex flex-wrap gap-2">
            {Object.entries(data.byCategory)
              .sort((a, b) => b[1] - a[1])
              .map(([cat, amount]) => (
                <button
                  key={cat}
                  onClick={() => setFilterCategory(filterCategory === cat ? '' : cat)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    filterCategory === cat
                      ? 'bg-gold-500 text-white'
                      : 'bg-[var(--subtle-bg)] text-[var(--text-secondary)] hover:text-foreground'
                  }`}
                >
                  {cat}: {fmt(amount)}
                </button>
              ))}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] p-4 mb-6 shadow-[var(--shadow-card)]">
        <div className="flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search expenses..."
              className="w-full pl-9 pr-8 py-2 text-sm rounded-lg bg-[var(--background)] border border-[var(--border-color)] text-foreground focus:outline-none focus:border-gold-400 focus:ring-1 focus:ring-gold-400/20 placeholder:text-[var(--text-muted)]"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded text-[var(--text-muted)] hover:text-foreground">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <select
            value={filterBilled}
            onChange={(e) => setFilterBilled(e.target.value as '' | 'true' | 'false')}
            className="px-3 py-2 text-sm rounded-lg bg-[var(--background)] border border-[var(--border-color)] text-foreground focus:outline-none focus:border-gold-400"
          >
            <option value="">All Status</option>
            <option value="false">Unbilled</option>
            <option value="true">Billed</option>
          </select>
          <span className="text-xs text-[var(--text-muted)]">
            {filtered.length} results &middot; {fmt(filteredTotal)}
          </span>
        </div>
      </div>

      {/* Expenses table */}
      <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] shadow-[var(--shadow-card)] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                <th className="text-left px-4 py-3 border-b border-[var(--border-color)]">Date</th>
                <th className="text-left px-3 py-3 border-b border-[var(--border-color)]">Description</th>
                <th className="text-left px-3 py-3 border-b border-[var(--border-color)]">Category</th>
                <th className="text-left px-3 py-3 border-b border-[var(--border-color)]">Client</th>
                <th className="text-left px-3 py-3 border-b border-[var(--border-color)]">Source</th>
                <th className="text-right px-4 py-3 border-b border-[var(--border-color)]">Amount</th>
                <th className="text-center px-3 py-3 border-b border-[var(--border-color)]">Status</th>
                <th className="px-2 py-3 border-b border-[var(--border-color)] w-10"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-sm text-[var(--text-muted)]">
                    <Receipt className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    No expenses found
                  </td>
                </tr>
              ) : (
                filtered.map((exp) => {
                  const editable = canEditCell(exp);
                  const editableCellClass = (extra: string) =>
                    `${extra} ${editable ? 'cursor-pointer hover:bg-gold-50/50 dark:hover:bg-gold-500/5' : ''}`;

                  return (
                    <tr key={exp.id} className="transition-colors group">
                      {/* Date */}
                      <td
                        className={editableCellClass('px-4 py-2 text-sm text-foreground border-b border-[var(--border-color)] whitespace-nowrap')}
                        onClick={editable && !isEditing(exp.id, 'date') ? () => startEdit(exp, 'date') : undefined}
                      >
                        {isEditing(exp.id, 'date') ? (
                          <DatePickerInput
                            variant="cell"
                            value={editingCell!.value || null}
                            onChange={(v) => commitEdit(v ?? '')}
                            placeholder="Pick a date"
                          />
                        ) : (
                          <span>
                            {exp.date}
                            {isSaving(exp.id, 'date') && <Loader2 className="inline w-3 h-3 ml-1 animate-spin text-[var(--text-muted)]" />}
                          </span>
                        )}
                      </td>

                      {/* Description */}
                      <td
                        className={editableCellClass('px-3 py-2 text-sm text-foreground border-b border-[var(--border-color)] max-w-[260px]')}
                        onClick={editable && !isEditing(exp.id, 'description') ? () => startEdit(exp, 'description') : undefined}
                      >
                        {isEditing(exp.id, 'description') ? (
                          <input
                            type="text"
                            autoFocus
                            value={editingCell!.value}
                            onChange={(ev) => setEditingCell({ ...editingCell!, value: ev.target.value })}
                            onBlur={() => commitEdit()}
                            onKeyDown={(ev) => {
                              if (ev.key === 'Enter') { ev.preventDefault(); ev.currentTarget.blur(); }
                              if (ev.key === 'Escape') { ev.preventDefault(); cancelEdit(); }
                            }}
                            className="w-full px-2 py-1 text-sm rounded-md bg-[var(--background)] border border-gold-400 ring-1 ring-gold-400/20 text-foreground focus:outline-none"
                          />
                        ) : (
                          <span className="block truncate">
                            {exp.description}
                            {isSaving(exp.id, 'description') && <Loader2 className="inline w-3 h-3 ml-1 animate-spin text-[var(--text-muted)]" />}
                          </span>
                        )}
                      </td>

                      {/* Category */}
                      <td
                        className={editableCellClass('px-3 py-2 text-sm text-[var(--text-secondary)] border-b border-[var(--border-color)]')}
                        onClick={editable && !isEditing(exp.id, 'category') ? () => startEdit(exp, 'category') : undefined}
                      >
                        {isEditing(exp.id, 'category') ? (
                          <select
                            autoFocus
                            value={editingCell!.value}
                            onChange={(ev) => commitEdit(ev.target.value)}
                            onBlur={() => commitEdit()}
                            onKeyDown={(ev) => {
                              if (ev.key === 'Escape') { ev.preventDefault(); cancelEdit(); }
                            }}
                            className="w-full px-2 py-1 text-sm rounded-md bg-[var(--background)] border border-gold-400 ring-1 ring-gold-400/20 text-foreground focus:outline-none"
                          >
                            {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                            {!EXPENSE_CATEGORIES.includes(editingCell!.value) && (
                              <option value={editingCell!.value}>{editingCell!.value}</option>
                            )}
                          </select>
                        ) : (
                          <span>
                            {exp.category}
                            {isSaving(exp.id, 'category') && <Loader2 className="inline w-3 h-3 ml-1 animate-spin text-[var(--text-muted)]" />}
                          </span>
                        )}
                      </td>

                      {/* Client (read-only) */}
                      <td className="px-3 py-2 text-sm text-[var(--text-secondary)] border-b border-[var(--border-color)] max-w-[200px] truncate">
                        {exp.clientName}
                      </td>

                      {/* Source (read-only) */}
                      <td className="px-3 py-2 border-b border-[var(--border-color)]">
                        <span className={`inline-flex px-2 py-0.5 text-[10px] font-medium rounded-full ${
                          exp.source === 'finance'
                            ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                            : 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400'
                        }`}>
                          {exp.source === 'finance' ? 'Finance' : 'Reimb'}
                        </span>
                      </td>

                      {/* Amount */}
                      <td
                        className={editableCellClass('px-4 py-2 text-sm font-medium text-foreground text-right border-b border-[var(--border-color)] tabular-nums')}
                        onClick={editable && !isEditing(exp.id, 'amount') ? () => startEdit(exp, 'amount') : undefined}
                      >
                        {isEditing(exp.id, 'amount') ? (
                          <input
                            type="number"
                            autoFocus
                            value={editingCell!.value}
                            onChange={(ev) => setEditingCell({ ...editingCell!, value: ev.target.value })}
                            onBlur={() => commitEdit()}
                            onKeyDown={(ev) => {
                              if (ev.key === 'Enter') { ev.preventDefault(); ev.currentTarget.blur(); }
                              if (ev.key === 'Escape') { ev.preventDefault(); cancelEdit(); }
                            }}
                            min="0"
                            step="0.01"
                            className="w-full px-2 py-1 text-sm text-right tabular-nums rounded-md bg-[var(--background)] border border-gold-400 ring-1 ring-gold-400/20 text-foreground focus:outline-none"
                          />
                        ) : (
                          <span>
                            {fmt(exp.amount)}
                            {isSaving(exp.id, 'amount') && <Loader2 className="inline w-3 h-3 ml-1 animate-spin text-[var(--text-muted)]" />}
                          </span>
                        )}
                      </td>

                      {/* Status (read-only) */}
                      <td className="px-3 py-2 text-center border-b border-[var(--border-color)]">
                        <span className={`inline-flex px-2 py-0.5 text-[10px] font-medium rounded-full ${
                          exp.billed
                            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                            : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                        }`}>
                          {exp.billed ? 'Billed' : 'Unbilled'}
                        </span>
                      </td>

                      {/* Delete (hover-revealed) */}
                      <td className="px-2 py-2 border-b border-[var(--border-color)] text-right">
                        {editable && (
                          rowBusyId === exp.id ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--text-muted)] inline-block" />
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleDelete(exp)}
                              className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-red-50 dark:hover:bg-red-500/10 transition-all cursor-pointer"
                              title="Delete expense"
                            >
                              <X className="w-3.5 h-3.5 text-red-400" />
                            </button>
                          )
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Expense Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 dark:bg-black/60 backdrop-blur-sm" onClick={() => setShowAddModal(false)} />
          <div className="relative bg-[var(--card-bg)] rounded-2xl border border-[var(--border-color)] shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-color)]">
              <h2 className="text-lg font-semibold text-foreground">Add Expense</h2>
              <button onClick={() => setShowAddModal(false)} className="p-1.5 rounded-lg hover:bg-[var(--subtle-bg)] text-[var(--text-muted)]">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="px-6 py-4 space-y-4">
              {/* Client */}
              <DropdownSelect
                label="Client"
                icon={Building2}
                value={clientId}
                displayValue={selectedClient?.name ?? ''}
                placeholder="Select client"
                options={allClients}
                onSelect={handleClientSelect}
                getLabel={(o) => (o as ClientOption).name}
              />

              {/* Matter */}
              <DropdownSelect
                label="Matter *"
                icon={Scale}
                value={matterId}
                displayValue={selectedMatter ? `${selectedMatter.name}${selectedMatter.code ? ` (${selectedMatter.code})` : ''}` : ''}
                placeholder={clientId ? 'Select matter' : 'Select a client first or search all'}
                options={filteredMatters}
                onSelect={handleMatterSelect}
                onClear={() => setMatterId(null)}
                getLabel={(o) => (o as MatterOption).name}
                getSublabel={(o) => (o as MatterOption).code || ''}
              />

              {/* Description */}
              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1">Description *</label>
                <input
                  type="text"
                  value={newExpense.description}
                  onChange={(e) => setNewExpense({ ...newExpense, description: e.target.value })}
                  placeholder="e.g. Filing fee for motion to dismiss"
                  className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--background)] border border-[var(--border-color)] text-foreground focus:outline-none focus:border-gold-400 focus:ring-1 focus:ring-gold-400/20"
                />
              </div>

              {/* Amount + Category */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1">Amount (₱) *</label>
                  <input
                    type="number"
                    value={newExpense.amount}
                    onChange={(e) => setNewExpense({ ...newExpense, amount: e.target.value })}
                    placeholder="0.00"
                    min="0"
                    step="0.01"
                    className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--background)] border border-[var(--border-color)] text-foreground focus:outline-none focus:border-gold-400 focus:ring-1 focus:ring-gold-400/20"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1">Category</label>
                  <select
                    value={newExpense.category}
                    onChange={(e) => setNewExpense({ ...newExpense, category: e.target.value })}
                    className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--background)] border border-[var(--border-color)] text-foreground focus:outline-none focus:border-gold-400"
                  >
                    {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>

              {/* Date */}
              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1">Expense Date *</label>
                <DatePickerInput
                  variant="token"
                  value={newExpense.date || null}
                  onChange={(v) => setNewExpense({ ...newExpense, date: v ?? '' })}
                  placeholder="Pick a date"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-[var(--border-color)]">
              <button onClick={() => setShowAddModal(false)} className="px-4 py-2 text-sm font-medium text-[var(--text-secondary)] hover:text-foreground transition-colors">
                Cancel
              </button>
              <button
                onClick={handleAddExpense}
                disabled={addSaving || !matterId || !newExpense.description || !newExpense.amount || !newExpense.date}
                className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold bg-navy-900 dark:bg-gold-400 text-white dark:text-navy-950 hover:bg-navy-800 dark:hover:bg-gold-300 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                {addSaving ? <><Loader2 className="w-4 h-4 animate-spin" /> Adding...</> : <><Check className="w-4 h-4" /> Add Expense</>}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
