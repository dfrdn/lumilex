'use client';

import { useState, useCallback, useMemo } from 'react';
import useSWR from 'swr';
import { Loader2, Plus, Trash2, Pencil, X, Receipt, Repeat, AlertCircle } from 'lucide-react';
import DatePickerInput from '@/components/DatePickerInput';
import SingleSelect from '@/components/finance/SingleSelect';
import MonthSelect from '@/components/finance/MonthSelect';
import { fmt, formatManilaDate, manilaToday } from '@/lib/finance/format';

interface FirmExpense {
  id: number;
  expense_date: string;
  category: string;
  amount: number;
  vendor: string;
  description: string;
  payment_method: string;
  notes: string;
  recurring_template_id: number | null;
}

interface Template {
  id: number;
  category: string;
  amount: number;
  vendor: string;
  description: string;
  payment_method: string;
  cadence: string;
  day_of_month: number;
  start_date: string;
  end_date: string | null;
  active: boolean;
  last_generated_month: string | null;
}

const METHOD_OPTIONS = [
  { id: 'bank_transfer', label: 'Bank Transfer' },
  { id: 'check', label: 'Check' },
  { id: 'cash', label: 'Cash' },
  { id: 'online', label: 'Online' },
  { id: 'auto_debit', label: 'Auto-debit' },
];

const CADENCE_OPTIONS = [
  { id: 'monthly', label: 'Monthly' },
  { id: 'quarterly', label: 'Quarterly' },
  { id: 'annual', label: 'Annual' },
];

function methodLabel(id: string) {
  return METHOD_OPTIONS.find((m) => m.id === id)?.label ?? (id || '—');
}

const inputCls = 'w-full px-3 py-1.5 text-xs rounded-lg bg-[var(--background)] border border-[var(--border-color)] focus:outline-none focus:ring-1 focus:ring-gold-300 dark:focus:ring-gold-500/40';
const labelCls = 'block text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1';

/** Shared modal chrome (overlay, header, error banner, footer) for the
 *  expense + template forms — each supplies only its distinct field block. */
function FormModal({
  title, onClose, onSave, saving, canSave, saveLabel, error, children,
}: {
  title: string;
  onClose: () => void;
  onSave: () => void;
  saving: boolean;
  canSave: boolean;
  saveLabel: string;
  error: string;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm animate-fade-in">
      <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] shadow-xl w-full max-w-md mx-4">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-color)]">
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          <button type="button" onClick={onClose} className="p-1 rounded-lg hover:bg-subtle cursor-pointer"><X className="w-4 h-4" /></button>
        </div>
        <div className="px-6 py-5 space-y-4">
          {children}
          {error && (
            <div className="rounded-lg bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 p-2.5 text-[11px] text-red-700 dark:text-red-400 flex items-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5" />{error}
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 px-6 py-4 border-t border-[var(--border-color)]">
          <button type="button" onClick={onClose} className="px-4 py-2 text-xs font-medium rounded-lg bg-subtle text-[var(--text-secondary)] hover:bg-stone-100 dark:hover:bg-stone-800 border border-[var(--border-color)] cursor-pointer">Cancel</button>
          <button type="button" onClick={onSave} disabled={saving || !canSave} className="px-4 py-2 text-xs font-medium rounded-lg bg-foreground text-[var(--background)] hover:opacity-90 disabled:opacity-50 cursor-pointer inline-flex items-center gap-1.5">
            {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : saveLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

async function loadRows(url: string) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Failed (${r.status})`);
  return r.json();
}

/** A `{ data: T[] }` list from SWR, with a setter for the local edits made after the server confirms them. */
function useRows<T>(key: string) {
  const { data, error: loadError, isLoading, mutate } = useSWR<{ data?: T[] }>(key, loadRows, { keepPreviousData: true });
  const rows = useMemo(() => data?.data ?? [], [data]);
  const setRows = useCallback(
    (next: T[] | ((prev: T[]) => T[])) =>
      mutate((d) => ({ ...d, data: typeof next === 'function' ? next(d?.data ?? []) : next }), { revalidate: false }),
    [mutate],
  );
  return {
    rows,
    setRows,
    loading: isLoading && !data,
    error: loadError ? (loadError instanceof Error ? loadError.message : 'Failed to load') : '',
  };
}

export default function OperatingExpenses() {
  const [tab, setTab] = useState<'expenses' | 'recurring'>('expenses');
  const { data: categoryData } = useSWR<{ options?: { value: string }[] }>('/api/enum-options?entity=firm_expenses&field=category');
  const categories = useMemo(
    () => (categoryData?.options ?? []).map((o) => ({ id: o.value, label: o.value })),
    [categoryData],
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-foreground font-[family-name:var(--font-playfair)] flex items-center gap-2">
            <Receipt className="w-5 h-5 text-[var(--text-muted)]" />
            Operating Expenses
          </h1>
          <p className="text-sm text-[var(--text-secondary)] mt-1">
            The firm’s own costs — rent, payroll, utilities, software, taxes. The money-out side of cash flow.
          </p>
        </div>
      </div>

      <div className="flex gap-1 p-1 bg-[var(--subtle-bg)] rounded-lg w-fit mb-4">
        <button
          onClick={() => setTab('expenses')}
          className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all flex items-center gap-1.5 ${
            tab === 'expenses' ? 'bg-[var(--card-bg)] text-foreground shadow-sm' : 'text-[var(--text-muted)] hover:text-foreground'
          }`}
        >
          <Receipt className="w-3.5 h-3.5" /> Expenses
        </button>
        <button
          onClick={() => setTab('recurring')}
          className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all flex items-center gap-1.5 ${
            tab === 'recurring' ? 'bg-[var(--card-bg)] text-foreground shadow-sm' : 'text-[var(--text-muted)] hover:text-foreground'
          }`}
        >
          <Repeat className="w-3.5 h-3.5" /> Recurring
        </button>
      </div>

      {tab === 'expenses' ? <ExpensesTab categories={categories} /> : <RecurringTab categories={categories} />}
    </div>
  );
}

// ── Expenses tab ──────────────────────────────────────────────────

function ExpensesTab({ categories }: { categories: { id: string; label: string }[] }) {
  const [monthEnabled, setMonthEnabled] = useState(false);
  const [month, setMonth] = useState(() => manilaToday().slice(0, 7));
  const [editing, setEditing] = useState<FirmExpense | null>(null);
  const [showModal, setShowModal] = useState(false);
  const { rows, setRows, loading, error } = useRows<FirmExpense>(
    `/api/finance/firm-expenses?${new URLSearchParams(monthEnabled ? { month } : {})}`,
  );

  const total = rows.reduce((s, r) => s + Number(r.amount), 0);

  const handleSaved = (saved: FirmExpense, isNew: boolean) => {
    setRows((prev) => {
      const next = isNew ? [saved, ...prev] : prev.map((r) => (r.id === saved.id ? saved : r));
      return [...next].sort((a, b) => b.expense_date.localeCompare(a.expense_date));
    });
  };

  const handleDelete = async (id: number) => {
    const prev = rows;
    setRows((r) => r.filter((x) => x.id !== id));
    const res = await fetch(`/api/finance/firm-expenses?id=${id}`, { method: 'DELETE' });
    if (!res.ok) setRows(prev); // rollback
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)] cursor-pointer select-none">
            <input type="checkbox" checked={monthEnabled} onChange={(e) => setMonthEnabled(e.target.checked)} className="w-4 h-4 rounded border-[var(--border-color)] accent-gold-500" />
            Filter month
          </label>
          <div className={monthEnabled ? 'w-44' : 'w-44 opacity-40 pointer-events-none'}>
            <MonthSelect value={month} onChange={setMonth} />
          </div>
        </div>
        <button
          onClick={() => { setEditing(null); setShowModal(true); }}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg bg-foreground text-[var(--background)] hover:opacity-90 cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" /> Add expense
        </button>
      </div>

      <div className="mb-4 bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] p-3.5 shadow-[var(--shadow-card)] w-fit min-w-[180px]">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1">
          {monthEnabled ? `Total · ${month}` : 'Total (all time)'}
        </div>
        <p className="text-lg font-semibold tabular-nums text-foreground">{fmt(total)}</p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-[var(--text-muted)]" /></div>
      ) : error ? (
        <div className="text-center py-12 text-red-600 dark:text-red-400 text-sm">{error}</div>
      ) : rows.length === 0 ? (
        <div className="text-center py-12 text-[var(--text-muted)] text-sm">No operating expenses recorded yet.</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[var(--border-color)] bg-card shadow-[var(--shadow-card)]">
          <table className="w-full border-collapse">
            <thead>
              <tr className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                <th className="text-left px-4 py-3 border-b border-[var(--border-color)]">Date</th>
                <th className="text-left px-3 py-3 border-b border-[var(--border-color)]">Category</th>
                <th className="text-left px-3 py-3 border-b border-[var(--border-color)]">Vendor / Description</th>
                <th className="text-left px-3 py-3 border-b border-[var(--border-color)]">Method</th>
                <th className="text-right px-3 py-3 border-b border-[var(--border-color)]">Amount</th>
                <th className="px-3 py-3 border-b border-[var(--border-color)]"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-[var(--subtle-bg)] transition-colors align-top group">
                  <td className="px-4 py-2.5 text-xs text-[var(--text-secondary)] border-b border-[var(--border-color)] whitespace-nowrap tabular-nums">{formatManilaDate(r.expense_date)}</td>
                  <td className="px-3 py-2.5 border-b border-[var(--border-color)] whitespace-nowrap">
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded-md bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300">
                      {r.category}
                    </span>
                    {r.recurring_template_id && (
                      <span title="From a recurring template" className="ml-1 inline-flex"><Repeat className="w-3 h-3 text-[var(--text-muted)]" /></span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-sm text-[var(--text-secondary)] border-b border-[var(--border-color)]">
                    {r.vendor && <span className="text-foreground">{r.vendor}</span>}
                    {r.vendor && r.description && <span className="text-[var(--text-muted)]"> — </span>}
                    {r.description}
                    {!r.vendor && !r.description && <span className="text-[var(--text-muted)]">—</span>}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-[var(--text-muted)] border-b border-[var(--border-color)] capitalize whitespace-nowrap">{methodLabel(r.payment_method)}</td>
                  <td className="px-3 py-2.5 text-sm font-medium text-right border-b border-[var(--border-color)] tabular-nums whitespace-nowrap text-foreground">{fmt(Number(r.amount))}</td>
                  <td className="px-3 py-2.5 border-b border-[var(--border-color)] whitespace-nowrap">
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => { setEditing(r); setShowModal(true); }} className="p-1 rounded hover:bg-subtle text-[var(--text-muted)] hover:text-foreground"><Pencil className="w-3.5 h-3.5" /></button>
                      <button onClick={() => handleDelete(r.id)} className="p-1 rounded hover:bg-subtle text-[var(--text-muted)] hover:text-red-500"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <ExpenseModal
          categories={categories}
          editing={editing}
          onClose={() => setShowModal(false)}
          onSaved={(saved, isNew) => { handleSaved(saved, isNew); setShowModal(false); }}
        />
      )}
    </div>
  );
}

function ExpenseModal({
  categories, editing, onClose, onSaved,
}: {
  categories: { id: string; label: string }[];
  editing: FirmExpense | null;
  onClose: () => void;
  onSaved: (saved: FirmExpense, isNew: boolean) => void;
}) {
  const [expenseDate, setExpenseDate] = useState(editing?.expense_date ?? manilaToday());
  const [category, setCategory] = useState<string | null>(editing?.category ?? null);
  const [amount, setAmount] = useState(editing ? String(editing.amount) : '');
  const [vendor, setVendor] = useState(editing?.vendor ?? '');
  const [description, setDescription] = useState(editing?.description ?? '');
  const [paymentMethod, setPaymentMethod] = useState<string | null>(editing?.payment_method || 'bank_transfer');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    if (!category || !Number.isFinite(parseFloat(amount)) || !expenseDate) {
      setError('Date, category, and a valid amount are required.');
      return;
    }
    setSaving(true); setError('');
    const payload = {
      expenseDate, category, amount: parseFloat(amount),
      vendor, description, paymentMethod: paymentMethod ?? '', notes: editing?.notes ?? '',
    };
    try {
      const res = await fetch('/api/finance/firm-expenses', {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editing ? { id: editing.id, ...payload } : payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to save');
      onSaved(data.data, !editing);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormModal
      title={editing ? 'Edit expense' : 'Add operating expense'}
      onClose={onClose}
      onSave={handleSave}
      saving={saving}
      canSave={!!amount && !!category}
      saveLabel={editing ? 'Save' : 'Add expense'}
      error={error}
    >
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>Date</label>
          <DatePickerInput variant="compact" value={expenseDate || null} onChange={(v) => setExpenseDate(v ?? '')} placeholder="Pick a date" />
        </div>
        <div>
          <label className={labelCls}>Category</label>
          <SingleSelect value={category} options={categories} placeholder="Select category" onChange={setCategory} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>Amount</label>
          <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} step="0.01" className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Method</label>
          <SingleSelect value={paymentMethod} options={METHOD_OPTIONS} placeholder="Method" onChange={setPaymentMethod} />
        </div>
      </div>
      <div>
        <label className={labelCls}>Vendor</label>
        <input type="text" value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="Optional" className={inputCls} />
      </div>
      <div>
        <label className={labelCls}>Description</label>
        <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" className={inputCls} />
      </div>
    </FormModal>
  );
}

// ── Recurring templates tab ───────────────────────────────────────

function RecurringTab({ categories }: { categories: { id: string; label: string }[] }) {
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Template | null>(null);
  const { rows, setRows, loading, error } = useRows<Template>('/api/finance/firm-expense-templates');

  const handleSaved = (saved: Template, isNew: boolean) => {
    setRows((prev) => (isNew ? [saved, ...prev] : prev.map((r) => (r.id === saved.id ? saved : r))));
  };

  const handleDelete = async (id: number) => {
    const prev = rows;
    setRows((r) => r.filter((x) => x.id !== id));
    const res = await fetch(`/api/finance/firm-expense-templates?id=${id}`, { method: 'DELETE' });
    if (!res.ok) setRows(prev);
  };

  const toggleActive = async (t: Template) => {
    const next = !t.active;
    setRows((rs) => rs.map((x) => (x.id === t.id ? { ...x, active: next } : x)));
    const res = await fetch('/api/finance/firm-expense-templates', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: t.id, active: next }),
    });
    if (!res.ok) setRows((rs) => rs.map((x) => (x.id === t.id ? { ...x, active: t.active } : x)));
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs text-[var(--text-muted)] max-w-lg">
          Fixed recurring costs (rent, payroll, subscriptions). A nightly job materializes each active template into an expense once per period.
        </p>
        <button onClick={() => { setEditing(null); setShowModal(true); }} className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg bg-foreground text-[var(--background)] hover:opacity-90 cursor-pointer">
          <Plus className="w-3.5 h-3.5" /> Add template
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-[var(--text-muted)]" /></div>
      ) : error ? (
        <div className="text-center py-12 text-red-600 dark:text-red-400 text-sm">{error}</div>
      ) : rows.length === 0 ? (
        <div className="text-center py-12 text-[var(--text-muted)] text-sm">No recurring templates yet.</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[var(--border-color)] bg-card shadow-[var(--shadow-card)]">
          <table className="w-full border-collapse">
            <thead>
              <tr className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                <th className="text-left px-4 py-3 border-b border-[var(--border-color)]">Category</th>
                <th className="text-left px-3 py-3 border-b border-[var(--border-color)]">Vendor</th>
                <th className="text-left px-3 py-3 border-b border-[var(--border-color)]">Cadence</th>
                <th className="text-left px-3 py-3 border-b border-[var(--border-color)]">Day</th>
                <th className="text-right px-3 py-3 border-b border-[var(--border-color)]">Amount</th>
                <th className="text-left px-3 py-3 border-b border-[var(--border-color)]">Status</th>
                <th className="px-3 py-3 border-b border-[var(--border-color)]"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id} className="hover:bg-[var(--subtle-bg)] transition-colors group">
                  <td className="px-4 py-2.5 text-sm text-foreground border-b border-[var(--border-color)]">{t.category}</td>
                  <td className="px-3 py-2.5 text-sm text-[var(--text-secondary)] border-b border-[var(--border-color)]">{t.vendor || '—'}</td>
                  <td className="px-3 py-2.5 text-xs text-[var(--text-secondary)] border-b border-[var(--border-color)] capitalize">{t.cadence}</td>
                  <td className="px-3 py-2.5 text-xs text-[var(--text-secondary)] border-b border-[var(--border-color)] tabular-nums">Day {t.day_of_month}</td>
                  <td className="px-3 py-2.5 text-sm font-medium text-right border-b border-[var(--border-color)] tabular-nums text-foreground">{fmt(Number(t.amount))}</td>
                  <td className="px-3 py-2.5 border-b border-[var(--border-color)]">
                    <button onClick={() => toggleActive(t)} className={`inline-flex items-center px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded-md cursor-pointer ${t.active ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300' : 'bg-stone-100 text-stone-500 dark:bg-stone-500/15 dark:text-stone-400'}`}>
                      {t.active ? 'Active' : 'Paused'}
                    </button>
                  </td>
                  <td className="px-3 py-2.5 border-b border-[var(--border-color)] whitespace-nowrap">
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => { setEditing(t); setShowModal(true); }} className="p-1 rounded hover:bg-subtle text-[var(--text-muted)] hover:text-foreground"><Pencil className="w-3.5 h-3.5" /></button>
                      <button onClick={() => handleDelete(t.id)} className="p-1 rounded hover:bg-subtle text-[var(--text-muted)] hover:text-red-500"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <TemplateModal
          categories={categories}
          editing={editing}
          onClose={() => setShowModal(false)}
          onSaved={(saved, isNew) => { handleSaved(saved, isNew); setShowModal(false); }}
        />
      )}
    </div>
  );
}

function TemplateModal({
  categories, editing, onClose, onSaved,
}: {
  categories: { id: string; label: string }[];
  editing: Template | null;
  onClose: () => void;
  onSaved: (saved: Template, isNew: boolean) => void;
}) {
  const [category, setCategory] = useState<string | null>(editing?.category ?? null);
  const [amount, setAmount] = useState(editing ? String(editing.amount) : '');
  const [cadence, setCadence] = useState<string | null>(editing?.cadence ?? 'monthly');
  const [dayOfMonth, setDayOfMonth] = useState(editing ? String(editing.day_of_month) : '1');
  const [startDate, setStartDate] = useState(editing?.start_date ?? manilaToday());
  const [endDate, setEndDate] = useState<string>(editing?.end_date ?? '');
  const [vendor, setVendor] = useState(editing?.vendor ?? '');
  const [paymentMethod, setPaymentMethod] = useState<string | null>(editing?.payment_method || 'bank_transfer');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    if (!category || !Number.isFinite(parseFloat(amount)) || !startDate) {
      setError('Category, a valid amount, and start date are required.');
      return;
    }
    const day = Math.min(Math.max(parseInt(dayOfMonth, 10) || 1, 1), 28);
    setSaving(true); setError('');
    const payload = {
      category, amount: parseFloat(amount), cadence: cadence ?? 'monthly',
      dayOfMonth: day, startDate, endDate: endDate || null, vendor, paymentMethod: paymentMethod ?? '',
    };
    try {
      const res = await fetch('/api/finance/firm-expense-templates', {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editing ? { id: editing.id, ...payload } : payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to save');
      onSaved(data.data, !editing);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormModal
      title={editing ? 'Edit template' : 'Add recurring template'}
      onClose={onClose}
      onSave={handleSave}
      saving={saving}
      canSave={!!amount && !!category}
      saveLabel={editing ? 'Save' : 'Add template'}
      error={error}
    >
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>Category</label>
          <SingleSelect value={category} options={categories} placeholder="Select category" onChange={setCategory} />
        </div>
        <div>
          <label className={labelCls}>Amount</label>
          <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} step="0.01" className={inputCls} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>Cadence</label>
          <SingleSelect value={cadence} options={CADENCE_OPTIONS} placeholder="Cadence" onChange={setCadence} />
        </div>
        <div>
          <label className={labelCls}>Day of month</label>
          <input type="number" min={1} max={28} value={dayOfMonth} onChange={(e) => setDayOfMonth(e.target.value)} className={inputCls} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>Start date</label>
          <DatePickerInput variant="compact" value={startDate || null} onChange={(v) => setStartDate(v ?? '')} placeholder="Start" />
        </div>
        <div>
          <label className={labelCls}>End date (optional)</label>
          <DatePickerInput variant="compact" value={endDate || null} onChange={(v) => setEndDate(v ?? '')} placeholder="No end" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>Vendor</label>
          <input type="text" value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="Optional" className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Method</label>
          <SingleSelect value={paymentMethod} options={METHOD_OPTIONS} placeholder="Method" onChange={setPaymentMethod} />
        </div>
      </div>
    </FormModal>
  );
}
