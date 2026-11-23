'use client';

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  X, Receipt, ChevronDown, Check, CheckCircle2,
  Search, Building2, Scale, Calendar, Paperclip, Upload,
} from 'lucide-react';
import DatePickerInput from '@/components/DatePickerInput';
import { useEnumValues } from '@/hooks/use-enum-options';
import { mintId } from '@/lib/ids';

interface ReceiptItem { name: string; url: string; path?: string }

export interface EditingReimbursement {
  notion_id: string;
  expense: string;
  amount: number;
  expense_category: string;
  expense_date: string | null;
  client_id: string | null;
  matter_id: string | null;
  reimbursed: boolean;
  receipt_urls: ReceiptItem[];
}

interface Props {
  open: boolean;
  onClose: () => void;
  editing?: EditingReimbursement | null;
  onSaved?: () => void;
}

interface ClientOption { id: string; name: string }
interface MatterOption { id: string; name: string; code: string; clientId: string }

// Searchable dropdown (reusable within this modal)
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
    if (isOpen) requestAnimationFrame(() => inputRef.current?.focus());
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
      <label className="flex items-center gap-1.5 text-[11px] font-semibold text-stone-400 dark:text-[var(--text-muted)] uppercase tracking-wider mb-1.5">
        <Icon className="w-3 h-3" />
        {label}
      </label>
      <button
        ref={btnRef}
        type="button"
        onClick={() => { if (!isOpen) setSearch(''); setIsOpen(!isOpen); }}
        className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-sm rounded-lg transition-all duration-150 cursor-pointer border ${
          isOpen
            ? 'border-gold-400 ring-2 ring-gold-400/20 bg-white dark:bg-[#2A2A2D] dark:border-gold-500/40'
            : 'border-stone-200 dark:border-[rgba(255,255,255,0.06)] bg-stone-50/80 dark:bg-[#2A2A2D] hover:border-stone-300 dark:hover:border-stone-600'
        }`}
      >
        <span className={`truncate ${value ? 'text-stone-800 dark:text-[#F5F0EB]' : 'text-stone-400 dark:text-[var(--text-muted)]'}`}>
          {displayValue || placeholder}
        </span>
        <div className="flex items-center gap-0.5 shrink-0">
          {value && onClear && (
            <span
              role="button"
              onClick={(e) => { e.stopPropagation(); onClear(); setIsOpen(false); }}
              className="p-0.5 rounded hover:bg-stone-200 dark:hover:bg-[#232326] text-stone-400 hover:text-stone-600 transition-colors dark:text-stone-500 dark:hover:text-stone-300"
            >
              <X className="w-3 h-3" />
            </span>
          )}
          <ChevronDown className={`w-3.5 h-3.5 text-stone-400 transition-transform duration-150 dark:text-stone-500 ${isOpen ? 'rotate-180' : ''}`} />
        </div>
      </button>

      {isOpen && pos && createPortal(
        <div
          ref={dropRef}
          className="fixed z-[100] bg-white dark:bg-[#2A2A2D] border border-stone-200 dark:border-[rgba(255,255,255,0.06)] rounded-lg shadow-lg overflow-hidden animate-fade-down"
          style={{ top: pos.top, left: pos.left, width: pos.width }}
        >
          <div className="p-2 border-b border-stone-100 dark:border-[rgba(255,255,255,0.06)]">
            <div className="flex items-center gap-2 px-2.5 py-1.5 bg-stone-50 dark:bg-[#232326] rounded-md">
              <Search className="w-3.5 h-3.5 text-stone-400 shrink-0 dark:text-stone-500" />
              <input
                ref={inputRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Type to search..."
                className="flex-1 text-sm bg-transparent outline-none placeholder:text-stone-400 dark:placeholder:text-[var(--text-muted)] text-stone-800 dark:text-[#F5F0EB]"
              />
            </div>
          </div>
          <div className="max-h-44 overflow-y-auto py-0.5">
            {filtered.length === 0 ? (
              <p className="px-3 py-4 text-sm text-stone-400 text-center dark:text-stone-500">No results found</p>
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
                        : 'text-stone-700 dark:text-[#F5F0EB] hover:bg-stone-50 dark:hover:bg-[#232326]'
                    }`}
                  >
                    <div className="min-w-0">
                      <span className={`truncate ${isSelected ? 'font-medium' : ''}`}>{getLabel(opt)}</span>
                      {sub && <span className={`text-xs ml-1.5 ${isSelected ? 'text-gold-500 dark:text-gold-400' : 'text-stone-400 dark:text-stone-500'}`}>{sub}</span>}
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

export default function FileReimbursementModal({ open, onClose, editing, onSaved }: Props) {
  const isEdit = !!editing;
  const isReimbursed = !!editing?.reimbursed;
  const receiptInputRef = useRef<HTMLInputElement>(null);
  const [expense, setExpense] = useState('');
  const [amount, setAmount] = useState('');
  const [expenseCategory, setExpenseCategory] = useState('');
  const expenseCategories = useEnumValues('reimbursements', 'expense_category');
  const [expenseDate, setExpenseDate] = useState('');
  const [clientId, setClientId] = useState<string | null>(null);
  const [matterId, setMatterId] = useState<string | null>(null);
  const [receiptFiles, setReceiptFiles] = useState<File[]>([]);
  const [existingReceipts, setExistingReceipts] = useState<ReceiptItem[]>([]);
  const [removedPaths, setRemovedPaths] = useState<string[]>([]);
  const [catOpen, setCatOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [allClients, setAllClients] = useState<ClientOption[]>([]);
  const [allMatters, setAllMatters] = useState<MatterOption[]>([]);

  useEffect(() => {
    if (open) {
      if (editing) {
        setExpense(editing.expense ?? '');
        setAmount(editing.amount != null ? String(editing.amount) : '');
        setExpenseCategory(editing.expense_category ?? '');
        setExpenseDate(editing.expense_date ?? '');
        setClientId(editing.client_id ?? null);
        setMatterId(editing.matter_id ?? null);
        setExistingReceipts(editing.receipt_urls ?? []);
      } else {
        setExpense('');
        setAmount('');
        setExpenseCategory('');
        setExpenseDate('');
        setClientId(null);
        setMatterId(null);
        setExistingReceipts([]);
      }
      setRemovedPaths([]);
      setReceiptFiles([]);
      setSuccess(false);
      setError('');
      setErrors({});
    }
  }, [open, editing]);

  useEffect(() => {
    if (!open) return;
    fetch('/api/clients-matters')
      .then((res) => res.json())
      .then((data) => {
        setAllClients(data.clients ?? []);
        setAllMatters(data.matters ?? []);
      })
      .catch(() => {});
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !submitting) onClose();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onClose, submitting]);

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

  const validate = () => {
    const e: Record<string, string> = {};
    // When reimbursed, only new receipts are allowed — skip field validation
    if (!isReimbursed) {
      if (!expense.trim()) e.expense = 'Expense description is required';
      if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) e.amount = 'Please enter a valid amount';
      if (!expenseCategory) e.expenseCategory = 'Category is required';
      if (!expenseDate) e.expenseDate = 'Date is required';
      if (!clientId) e.clientId = 'Please select a client';
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  async function uploadNewReceipts(reimbursementId?: string) {
    if (receiptFiles.length === 0) return [];

    const urlRes = await fetch('/api/reimbursement', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        receipts: receiptFiles.map((f) => ({ name: f.name, type: f.type, size: f.size })),
        ...(reimbursementId ? { reimbursementId } : {}),
      }),
    });
    if (!urlRes.ok) {
      const data = await urlRes.json();
      throw new Error(data.error || 'Failed to prepare upload');
    }
    const { tempId, uploads } = await urlRes.json() as {
      tempId: string;
      uploads: { signedUrl: string; name: string; storagePath: string }[];
    };

    await Promise.all(
      uploads.map(async (upload, i) => {
        const file = receiptFiles[i];
        const uploadRes = await fetch(upload.signedUrl, {
          method: 'PUT',
          headers: { 'Content-Type': file.type || 'application/octet-stream' },
          body: file,
        });
        if (!uploadRes.ok) throw new Error(`Upload failed for ${file.name}`);
      }),
    );

    return { tempId, uploads };
  }

  const handleSubmit = async () => {
    if (!validate()) return;
    setSubmitting(true);
    setError('');
    try {
      if (editing) {
        const uploadResult = await uploadNewReceipts(editing.notion_id);
        const addReceipts = Array.isArray(uploadResult)
          ? []
          : uploadResult.uploads.map((u) => ({ name: u.name, storagePath: u.storagePath }));

        const body: Record<string, unknown> = { notionId: editing.notion_id };

        if (!isReimbursed) {
          body.expense = expense;
          body.amount = amount;
          body.expenseCategory = expenseCategory;
          body.expenseDate = expenseDate;
          body.clientId = clientId;
          body.matterId = matterId || null;
          if (removedPaths.length > 0) body.removeReceiptPaths = removedPaths;
        }
        if (addReceipts.length > 0) body.addReceipts = addReceipts;

        const res = await fetch('/api/reimbursement', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || 'Failed to save');
        }
      } else {
        const uploadResult = await uploadNewReceipts();
        const { tempId, uploads } = Array.isArray(uploadResult)
          ? { tempId: mintId('reimb'), uploads: [] }
          : uploadResult;

        const confirmRes = await fetch('/api/reimbursement', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            confirm: true,
            tempId,
            expense,
            amount,
            expenseCategory,
            expenseDate,
            clientId,
            matterId: matterId || undefined,
            receipts: uploads.map((u) => ({ name: u.name, storagePath: u.storagePath })),
          }),
        });
        if (!confirmRes.ok) {
          const data = await confirmRes.json();
          throw new Error(data.error || 'Failed to file reimbursement');
        }
      }

      setSuccess(true);
      onSaved?.();
      setTimeout(() => onClose(), 1200);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-[2px] animate-overlay"
        onClick={submitting ? undefined : onClose}
      />

      <div className="relative bg-white dark:bg-[#1C1C1E] rounded-2xl shadow-2xl shadow-stone-900/10 dark:shadow-black/30 w-full max-w-md animate-dialog ring-1 ring-stone-900/5 dark:ring-white/5 overflow-hidden">
        {/* Header */}
        <div className="relative px-5 pt-5 pb-4">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-gold-400 via-gold-500 to-orange-400" />
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-gold-50 to-gold-100 dark:from-gold-500/10 dark:to-gold-500/20 flex items-center justify-center ring-1 ring-gold-200/60 dark:ring-gold-500/20">
                <Receipt className="w-4.5 h-4.5 text-gold-600 dark:text-gold-400" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-stone-900 dark:text-[#F5F0EB] leading-tight">
                  {isEdit ? 'Edit Reimbursement' : 'File Reimbursement'}
                </h2>
                <p className="text-xs text-stone-400 dark:text-[var(--text-muted)] mt-0.5">
                  {isEdit
                    ? isReimbursed
                      ? 'Already reimbursed — you can only attach additional receipts.'
                      : 'Update your expense details or receipts.'
                    : 'Submit an expense for reimbursement'}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="p-1.5 -mr-1 rounded-lg text-stone-400 hover:text-stone-600 dark:hover:text-[#F5F0EB] hover:bg-stone-100 dark:hover:bg-[#2A2A2D] transition-colors duration-150 cursor-pointer disabled:opacity-50 dark:text-stone-500"
            >
              <X className="w-4.5 h-4.5" />
            </button>
          </div>
        </div>

        {success ? (
          <div className="px-6 py-14 text-center">
            <div className="w-14 h-14 rounded-full bg-emerald-50 dark:bg-emerald-500/10 ring-4 ring-emerald-100/60 dark:ring-emerald-500/5 flex items-center justify-center mx-auto mb-4 animate-scale-in">
              <CheckCircle2 className="w-7 h-7 text-emerald-500 dark:text-emerald-400" />
            </div>
            <p className="text-lg font-semibold text-stone-900 dark:text-[#F5F0EB]">
              {isEdit ? 'Changes Saved' : 'Reimbursement Filed'}
            </p>
            <p className="text-sm text-stone-400 dark:text-[var(--text-muted)] mt-1">
              {isEdit ? 'Your reimbursement has been updated.' : 'Your expense has been submitted.'}
            </p>
          </div>
        ) : (
          <>
            <div className="px-5 pb-5 space-y-4 max-h-[62vh] overflow-y-auto">
              <div
                className={`space-y-4 ${isReimbursed ? 'pointer-events-none opacity-60 select-none' : ''}`}
                aria-disabled={isReimbursed || undefined}
              >
              {/* Expense */}
              <div>
                <label className="flex items-center gap-1.5 text-[11px] font-semibold text-stone-400 dark:text-[var(--text-muted)] uppercase tracking-wider mb-1.5">
                  Expense Description
                </label>
                <input
                  type="text"
                  value={expense}
                  onChange={(e) => { setExpense(e.target.value); if (errors.expense) setErrors((p) => ({ ...p, expense: '' })); }}
                  autoFocus
                  className={`w-full px-3 py-2 text-sm text-stone-800 dark:text-[#F5F0EB] bg-stone-50/80 dark:bg-[#2A2A2D] border rounded-lg placeholder:text-stone-400 dark:placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 transition-all duration-150 ${
                    errors.expense ? 'border-red-400 focus:ring-red-400/20' : 'border-stone-200 dark:border-[rgba(255,255,255,0.06)] focus:ring-gold-400/20 focus:border-gold-400 dark:focus:border-gold-500/40'
                  }`}
                  placeholder="e.g., Grab ride to RTC Makati"
                />
                {errors.expense && <p className="text-xs text-red-500 mt-1 dark:text-red-400">{errors.expense}</p>}
              </div>

              {/* Amount + Date row */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="flex items-center gap-1.5 text-[11px] font-semibold text-stone-400 dark:text-[var(--text-muted)] uppercase tracking-wider mb-1.5">
                    Amount (PHP)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={amount}
                    onChange={(e) => { setAmount(e.target.value); if (errors.amount) setErrors((p) => ({ ...p, amount: '' })); }}
                    className={`w-full px-3 py-2 text-sm text-stone-800 dark:text-[#F5F0EB] bg-stone-50/80 dark:bg-[#2A2A2D] border rounded-lg placeholder:text-stone-400 dark:placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 transition-all duration-150 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${
                      errors.amount ? 'border-red-400 focus:ring-red-400/20' : 'border-stone-200 dark:border-[rgba(255,255,255,0.06)] focus:ring-gold-400/20 focus:border-gold-400 dark:focus:border-gold-500/40'
                    }`}
                    placeholder="0.00"
                  />
                  {errors.amount && <p className="text-xs text-red-500 mt-1 dark:text-red-400">{errors.amount}</p>}
                </div>
                <div>
                  <label className="flex items-center gap-1.5 text-[11px] font-semibold text-stone-400 dark:text-[var(--text-muted)] uppercase tracking-wider mb-1.5">
                    <Calendar className="w-3 h-3" />
                    Date
                  </label>
                  <DatePickerInput
                    value={expenseDate || null}
                    onChange={(v) => { setExpenseDate(v ?? ''); setErrors((p) => ({ ...p, expenseDate: '' })); }}
                    placeholder="Pick a date"
                    hasError={!!errors.expenseDate}
                  />
                  {errors.expenseDate && <p className="text-xs text-red-500 mt-1 dark:text-red-400">{errors.expenseDate}</p>}
                </div>
              </div>

              {/* Category */}
              <div className="relative">
                <label className="flex items-center gap-1.5 text-[11px] font-semibold text-stone-400 dark:text-[var(--text-muted)] uppercase tracking-wider mb-1.5">
                  Category
                </label>
                <button
                  type="button"
                  onClick={() => { setCatOpen((o) => !o); }}
                  className={`w-full flex items-center justify-between gap-1 px-3 py-2 text-sm rounded-lg transition-all duration-150 cursor-pointer border ${
                    errors.expenseCategory
                      ? 'border-red-400 ring-1 ring-red-400/20 bg-red-50/20 dark:bg-red-950/10'
                      : catOpen
                        ? 'border-gold-400 ring-2 ring-gold-400/20 bg-white dark:bg-[#2A2A2D] dark:border-gold-500/40'
                        : 'border-stone-200 dark:border-[rgba(255,255,255,0.06)] bg-stone-50/80 dark:bg-[#2A2A2D] hover:border-stone-300 dark:hover:border-stone-600'
                  }`}
                >
                  <span className={`truncate ${expenseCategory ? 'text-stone-800 dark:text-[#F5F0EB]' : 'text-stone-400 dark:text-[var(--text-muted)]'}`}>
                    {expenseCategory || 'Select category'}
                  </span>
                  <ChevronDown className={`w-3.5 h-3.5 text-stone-400 shrink-0 transition-transform duration-150 dark:text-stone-500 ${catOpen ? 'rotate-180' : ''}`} />
                </button>
                {catOpen && (
                  <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-white dark:bg-[#2A2A2D] border border-stone-200 dark:border-[rgba(255,255,255,0.06)] rounded-lg shadow-lg py-0.5 max-h-52 overflow-y-auto animate-fade-down">
                    {expenseCategories.map((opt) => (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => { setExpenseCategory(opt); setCatOpen(false); setErrors((p) => ({ ...p, expenseCategory: '' })); }}
                        className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-sm text-left transition-colors duration-75 cursor-pointer ${
                          expenseCategory === opt
                            ? 'text-gold-700 dark:text-gold-400 bg-gold-50/80 dark:bg-gold-500/10 font-medium'
                            : 'text-stone-700 dark:text-[#F5F0EB] hover:bg-stone-50 dark:hover:bg-[#232326]'
                        }`}
                      >
                        {opt}
                        {expenseCategory === opt && <Check className="w-3.5 h-3.5 text-gold-600 dark:text-gold-400 shrink-0" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {errors.expenseCategory && <p className="text-xs text-red-500 -mt-2 dark:text-red-400">{errors.expenseCategory}</p>}

              {/* Divider */}
              <div className="border-t border-stone-100 dark:border-[rgba(255,255,255,0.06)]" />

              {/* Client */}
              <div>
                <DropdownSelect
                  label="Client"
                  icon={Building2}
                  value={clientId}
                  displayValue={selectedClient?.name ?? ''}
                  placeholder="Select client"
                  options={allClients}
                  onSelect={(id) => { handleClientSelect(id); setErrors((p) => ({ ...p, clientId: '' })); }}
                  getLabel={(o) => (o as ClientOption).name}
                />
                {errors.clientId && <p className="text-xs text-red-500 mt-1 dark:text-red-400">{errors.clientId}</p>}
              </div>

              {/* Matter */}
              <DropdownSelect
                label="Matter (optional)"
                icon={Scale}
                value={matterId}
                displayValue={selectedMatter ? `${selectedMatter.name}${selectedMatter.code ? ` (${selectedMatter.code})` : ''}` : ''}
                placeholder={clientId ? 'Select matter' : 'Select a client first'}
                options={filteredMatters}
                onSelect={handleMatterSelect}
                onClear={() => setMatterId(null)}
                getLabel={(o) => (o as MatterOption).name}
                getSublabel={(o) => (o as MatterOption).code || ''}
              />
              </div>

              {/* Receipts */}
              <div>
                <label className="flex items-center gap-1.5 text-[11px] font-semibold text-stone-400 dark:text-[var(--text-muted)] uppercase tracking-wider mb-1.5">
                  <Paperclip className="w-3 h-3" />
                  Receipts {!isEdit && '(optional)'}
                </label>

                {/* Existing receipts (edit mode) */}
                {isEdit && existingReceipts.filter((r) => !(r.path && removedPaths.includes(r.path))).length > 0 && (
                  <div className="mb-2 space-y-1">
                    {existingReceipts.map((r, i) => {
                      const isRemoved = r.path ? removedPaths.includes(r.path) : false;
                      if (isRemoved) return null;
                      return (
                        <div
                          key={`exist-${i}`}
                          className="flex items-center justify-between gap-2 px-2.5 py-1.5 text-xs bg-stone-50 dark:bg-[#2A2A2D] rounded-md border border-stone-100 dark:border-[rgba(255,255,255,0.06)]"
                        >
                          <a
                            href={r.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="truncate text-stone-600 dark:text-[#C5C0B8] hover:text-gold-600 dark:hover:text-gold-400 hover:underline"
                          >
                            {r.name}
                          </a>
                          {!isReimbursed && r.path && (
                            <button
                              type="button"
                              onClick={() => setRemovedPaths((prev) => [...prev, r.path as string])}
                              className="p-0.5 rounded hover:bg-stone-200 dark:hover:bg-[#232326] text-stone-400 hover:text-red-500 transition-colors shrink-0 cursor-pointer dark:text-stone-500 dark:hover:text-red-400"
                              title="Remove receipt"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
                <div
                  onClick={() => receiptInputRef.current?.click()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const files = Array.from(e.dataTransfer.files);
                    if (files.length > 0) setReceiptFiles((prev) => [...prev, ...files]);
                  }}
                  className="flex flex-col items-center justify-center gap-1.5 px-4 py-4 border-2 border-dashed border-stone-200 dark:border-[rgba(255,255,255,0.08)] rounded-lg cursor-pointer hover:border-gold-400/50 dark:hover:border-gold-500/30 hover:bg-gold-50/30 dark:hover:bg-gold-500/5 transition-all duration-150"
                >
                  <Upload className="w-5 h-5 text-stone-300 dark:text-[var(--text-muted)]" />
                  <span className="text-xs text-stone-400 dark:text-[var(--text-muted)]">Click to upload receipt images</span>
                  <input
                    ref={receiptInputRef}
                    type="file"
                    accept="image/*,.pdf"
                    multiple
                    className="sr-only"
                    onChange={(e) => {
                      const files = Array.from(e.target.files ?? []);
                      e.target.value = '';
                      if (files.length > 0) {
                        setReceiptFiles((prev) => [...prev, ...files]);
                      }
                    }}
                  />
                </div>
                {receiptFiles.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {receiptFiles.map((file, i) => (
                      <div
                        key={`${file.name}-${i}`}
                        className="flex items-center justify-between gap-2 px-2.5 py-1.5 text-xs bg-stone-50 dark:bg-[#2A2A2D] rounded-md border border-stone-100 dark:border-[rgba(255,255,255,0.06)]"
                      >
                        <span className="truncate text-stone-600 dark:text-[#C5C0B8]">{file.name}</span>
                        <button
                          type="button"
                          onClick={() => setReceiptFiles((prev) => prev.filter((_, j) => j !== i))}
                          className="p-0.5 rounded hover:bg-stone-200 dark:hover:bg-[#232326] text-stone-400 hover:text-stone-600 transition-colors shrink-0 cursor-pointer dark:text-stone-500 dark:hover:text-stone-300"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Error */}
              {error && (
                <div className="flex items-start gap-2 bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 text-sm px-3 py-2.5 rounded-lg border border-red-200/60 dark:border-red-500/20">
                  <X className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-5 py-3.5 border-t border-stone-100 dark:border-[rgba(255,255,255,0.06)] bg-stone-50/60 dark:bg-[#141414] rounded-b-2xl flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                className="px-4 py-2 text-sm font-medium text-stone-500 dark:text-[var(--text-secondary)] hover:text-stone-700 dark:hover:text-[#F5F0EB] hover:bg-stone-100 dark:hover:bg-[#2A2A2D] rounded-lg transition-colors duration-150 cursor-pointer disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={submitting}
                className="px-5 py-2 text-sm font-semibold text-white bg-gold-600 hover:bg-gold-700 rounded-lg shadow-sm shadow-gold-600/20 transition-all duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:ring-offset-2 disabled:opacity-40 disabled:shadow-none"
              >
                {submitting ? (
                  <span className="flex items-center gap-2">
                    <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Submitting...
                  </span>
                ) : (
                  isEdit ? 'Save Changes' : 'Submit Reimbursement'
                )}
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
