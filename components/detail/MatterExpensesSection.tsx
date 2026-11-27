'use client';

import { useState, useEffect, useCallback } from 'react';
import DatePickerInput from '@/components/DatePickerInput';
import {
  Receipt, Plus, X, ExternalLink, Loader2, Pencil, Check,
} from 'lucide-react';
import { confirmAction } from '@/components/ui/confirm';
import { toast } from 'sonner';

interface Expense {
  id: number | string;
  matter_id: string;
  description: string;
  amount: number;
  category: string;
  expense_date: string;
  receipt_urls: { name?: string; url: string }[];
  billed: boolean;
  invoice_id: number | null;
  created_by: string;
  source: 'finance' | 'reimbursement';
}

const CATEGORIES = [
  'Filing Fees', 'Court Fees', 'Notarial', 'Transportation',
  'Meals', 'Printing', 'Postage', 'Supplies', 'Professional Fees', 'Other',
];

function fmt(n: number) {
  return `₱${Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function MatterExpensesSection({ matterId, canEdit }: { matterId: string; canEdit: boolean }) {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [totalBilled, setTotalBilled] = useState(0);
  const [totalUnbilled, setTotalUnbilled] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  // Add expense form state
  const [desc, setDesc] = useState('');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('Filing Fees');
  const [expDate, setExpDate] = useState(() => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' }));
  const [saving, setSaving] = useState(false);

  // Inline edit state
  const [editingId, setEditingId] = useState<number | string | null>(null);
  const [editDesc, setEditDesc] = useState('');
  const [editAmount, setEditAmount] = useState('');
  const [editCategory, setEditCategory] = useState('Filing Fees');
  const [editDate, setEditDate] = useState('');
  const [editSaving, setEditSaving] = useState(false);

  const startEdit = (e: Expense) => {
    setEditingId(e.id);
    setEditDesc(e.description);
    setEditAmount(String(e.amount));
    setEditCategory(e.category || 'Filing Fees');
    setEditDate(e.expense_date);
  };

  const cancelEdit = () => {
    setEditingId(null);
  };

  const saveEdit = async () => {
    if (editingId == null || !editDesc || !editAmount || !editDate) return;
    setEditSaving(true);
    try {
      const res = await fetch('/api/finance/matter-expenses', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editingId,
          description: editDesc,
          amount: parseFloat(editAmount),
          category: editCategory,
          expenseDate: editDate,
        }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || 'Failed to update');
      }
      setEditingId(null);
      fetchExpenses();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update');
    } finally {
      setEditSaving(false);
    }
  };

  const fetchExpenses = useCallback(async () => {
    try {
      const res = await fetch(`/api/finance/matter-expenses?matterId=${matterId}`);
      const json = await res.json();
      setExpenses(json.data ?? []);
      setTotalBilled(json.totalBilled ?? 0);
      setTotalUnbilled(json.totalUnbilled ?? 0);
    } catch { /* ignore */ }
    setLoading(false);
  }, [matterId]);

  useEffect(() => { fetchExpenses(); }, [fetchExpenses]);

  const handleAddExpense = async () => {
    if (!desc || !amount) return;
    setSaving(true);
    try {
      const res = await fetch('/api/finance/matter-expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          matterId,
          description: desc,
          amount: parseFloat(amount),
          category,
          expenseDate: expDate,
        }),
      });
      if (res.ok) {
        setShowForm(false);
        setDesc('');
        setAmount('');
        fetchExpenses();
      }
    } catch { /* ignore */ }
    setSaving(false);
  };

  const handleDelete = async (id: number | string) => {
    if (String(id).startsWith('reimb-')) return; // Can't delete reimbursements from here
    if (!(await confirmAction({ title: 'Delete this expense?', confirmLabel: 'Delete', danger: true }))) return;
    await fetch(`/api/finance/matter-expenses?id=${id}`, { method: 'DELETE' });
    fetchExpenses();
  };

  if (loading) {
    return (
      <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] shadow-[var(--shadow-card)] overflow-hidden animate-fade-up">
        <div className="px-5 py-4 border-b border-[var(--border-color)]">
          <div className="flex items-center gap-2">
            <Receipt className="w-4.5 h-4.5 text-emerald-500 dark:text-emerald-400" />
            <span className="text-sm font-semibold text-foreground">Expenses</span>
          </div>
        </div>
        <div className="px-5 py-8 text-center">
          <div className="h-4 w-32 mx-auto rounded skeleton-shimmer" />
        </div>
      </div>
    );
  }

  return (
    <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] shadow-[var(--shadow-card)] overflow-hidden animate-fade-up">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-color)]">
        <div className="flex items-center gap-2">
          <Receipt className="w-4.5 h-4.5 text-emerald-500 dark:text-emerald-400" />
          <span className="text-sm font-semibold text-foreground">Expenses</span>
          <span className="text-[10px] font-semibold bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400 rounded-full px-2 py-0.5 tabular-nums">
            {expenses.length}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {/* Totals */}
          <div className="text-right">
            <span className="text-[10px] text-[var(--text-muted)]">Unbilled: </span>
            <span className="text-xs font-semibold text-foreground tabular-nums">{fmt(totalUnbilled)}</span>
            {totalBilled > 0 && (
              <>
                <span className="text-[10px] text-[var(--text-muted)] ml-2">Billed: </span>
                <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400 tabular-nums">{fmt(totalBilled)}</span>
              </>
            )}
          </div>
          {canEdit && (
            <button
              type="button"
              onClick={() => setShowForm(!showForm)}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-[10px] font-medium rounded-full bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200/60 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/30 dark:hover:bg-emerald-500/20 cursor-pointer transition-colors"
            >
              <Plus className="w-3 h-3" />
              Add
            </button>
          )}
        </div>
      </div>

      {/* Add Expense Form */}
      {showForm && (
        <div className="px-5 py-4 bg-emerald-50/30 dark:bg-emerald-500/5 border-b border-[var(--border-color)]">
          <div className="space-y-3">
            <input
              type="text"
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              placeholder="Description"
              className="w-full px-3 py-1.5 text-xs rounded-lg bg-[var(--background)] border border-[var(--border-color)] focus:outline-none focus:ring-1 focus:ring-emerald-300 dark:focus:ring-emerald-500/40"
            />
            <div className="grid grid-cols-3 gap-2">
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="Amount"
                step="0.01"
                className="px-3 py-1.5 text-xs rounded-lg bg-[var(--background)] border border-[var(--border-color)] focus:outline-none focus:ring-1 focus:ring-emerald-300 dark:focus:ring-emerald-500/40"
              />
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="px-3 py-1.5 text-xs rounded-lg bg-[var(--background)] border border-[var(--border-color)] focus:outline-none focus:ring-1 focus:ring-emerald-300 dark:focus:ring-emerald-500/40"
              >
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <DatePickerInput
                variant="compact"
                value={expDate || null}
                onChange={(v) => setExpDate(v ?? '')}
                placeholder="Pick a date"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="px-3 py-1.5 text-xs rounded-lg bg-subtle text-[var(--text-secondary)] border border-[var(--border-color)] cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAddExpense}
                disabled={saving || !desc || !amount}
                className="px-3 py-1.5 text-xs font-medium rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-50 cursor-pointer"
              >
                {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Add Expense'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Expense List */}
      {expenses.length === 0 ? (
        <div className="px-5 py-8 text-center text-sm text-[var(--text-muted)]">
          No expenses recorded
        </div>
      ) : (
        <div className="divide-y divide-[var(--border-color)] max-h-[400px] overflow-y-auto">
          {expenses.map((e) => {
            const isEditing = editingId === e.id;
            if (isEditing) {
              return (
                <div key={e.id} className="px-5 py-3 bg-emerald-50/40 dark:bg-emerald-500/5">
                  <div className="space-y-2">
                    <input
                      type="text"
                      value={editDesc}
                      onChange={(ev) => setEditDesc(ev.target.value)}
                      placeholder="Description"
                      className="w-full px-3 py-1.5 text-xs rounded-lg bg-[var(--background)] border border-[var(--border-color)] focus:outline-none focus:ring-1 focus:ring-emerald-300 dark:focus:ring-emerald-500/40"
                    />
                    <div className="grid grid-cols-3 gap-2">
                      <input
                        type="number"
                        value={editAmount}
                        onChange={(ev) => setEditAmount(ev.target.value)}
                        placeholder="Amount"
                        step="0.01"
                        className="px-3 py-1.5 text-xs rounded-lg bg-[var(--background)] border border-[var(--border-color)] focus:outline-none focus:ring-1 focus:ring-emerald-300 dark:focus:ring-emerald-500/40"
                      />
                      <select
                        value={editCategory}
                        onChange={(ev) => setEditCategory(ev.target.value)}
                        className="px-3 py-1.5 text-xs rounded-lg bg-[var(--background)] border border-[var(--border-color)] focus:outline-none focus:ring-1 focus:ring-emerald-300 dark:focus:ring-emerald-500/40"
                      >
                        {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                        {!CATEGORIES.includes(editCategory) && (
                          <option value={editCategory}>{editCategory}</option>
                        )}
                      </select>
                      <DatePickerInput
                        variant="compact"
                        value={editDate || null}
                        onChange={(v) => setEditDate(v ?? '')}
                        placeholder="Pick a date"
                      />
                    </div>
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={cancelEdit}
                        className="px-3 py-1.5 text-xs rounded-lg bg-subtle text-[var(--text-secondary)] border border-[var(--border-color)] cursor-pointer"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={saveEdit}
                        disabled={editSaving || !editDesc || !editAmount || !editDate}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-50 cursor-pointer"
                      >
                        {editSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                        Save
                      </button>
                    </div>
                  </div>
                </div>
              );
            }
            return (
              <div key={e.id} className="flex items-center gap-3 px-5 py-3 hover:bg-gold-50/40 dark:hover:bg-[rgba(185, 143, 69,0.06)] transition-colors group">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-medium text-foreground truncate">{e.description}</p>
                    {e.source === 'reimbursement' && (
                      <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400 shrink-0">Reimb</span>
                    )}
                    {e.billed && (
                      <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400 shrink-0">Billed</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[10px] text-[var(--text-muted)]">{e.category}</span>
                    <span className="text-[10px] text-[var(--text-muted)]">&middot;</span>
                    <span className="text-[10px] font-mono text-[var(--text-muted)]">
                      {new Date(e.expense_date + 'T00:00:00Z').toLocaleDateString('en-PH', { month: 'short', day: 'numeric', timeZone: 'Asia/Manila' })}
                    </span>
                    {e.created_by && (
                      <>
                        <span className="text-[10px] text-[var(--text-muted)]">&middot;</span>
                        <span className="text-[10px] text-[var(--text-muted)]">{e.created_by}</span>
                      </>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {e.receipt_urls && e.receipt_urls.length > 0 && (
                    <a
                      href={e.receipt_urls[0]?.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-500 hover:text-blue-600"
                      title="View receipt"
                    >
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                  <span className="text-xs font-semibold text-foreground tabular-nums">{fmt(e.amount)}</span>
                  {canEdit && e.source === 'finance' && !e.billed && (
                    <>
                      <button
                        type="button"
                        onClick={() => startEdit(e)}
                        className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 transition-all cursor-pointer"
                        title="Edit"
                      >
                        <Pencil className="w-3 h-3 text-emerald-500 dark:text-emerald-400" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(e.id)}
                        className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-red-50 dark:hover:bg-red-500/10 transition-all cursor-pointer"
                        title="Delete"
                      >
                        <X className="w-3 h-3 text-red-400" />
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
