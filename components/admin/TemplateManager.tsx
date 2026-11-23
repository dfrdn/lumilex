'use client';

import { useState, useCallback, useRef, useMemo } from 'react';
import useSWR from 'swr';
import JSZip from 'jszip';
import {
  Search,
  Plus,
  Pencil,
  Trash2,
  ToggleLeft,
  ToggleRight,
  X,
  Upload,
  RefreshCw,
  Filter,
  FileText,
} from 'lucide-react';
import { uploadViaSignedUrl } from '@/lib/corporations/upload-file';
import { confirmAction } from '@/components/ui/confirm';

// ── Types ──────────────────────────────────────────────────

interface PlaceholderField {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'number' | 'date';
  required: boolean;
}

interface Template {
  id: number;
  name: string;
  category: string;
  subcategory: string | null;
  description: string | null;
  mode: 'ai' | 'placeholder';
  ai_prompt: string | null;
  file_url: string | null;
  placeholders: PlaceholderField[] | null;
  deadline_kind: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

type TemplateCategory = 'legal' | 'letter' | 'form' | 'report' | 'corporate';
const TRADEMARK_DEADLINE_KINDS = ['1st Publication Fee', 'Issuance Fee', 'OA Response', '3-DAU', '5-DAU', 'Renewal'] as const;

const CATEGORIES: TemplateCategory[] = ['legal', 'letter', 'form', 'report', 'corporate'];

const CATEGORY_BADGES: Record<TemplateCategory, { label: string; className: string }> = {
  legal:     { label: 'Legal',     className: 'bg-purple-50 text-purple-700 dark:bg-purple-500/10 dark:text-purple-400' },
  letter:    { label: 'Letter',    className: 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400' },
  form:      { label: 'Form',      className: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400' },
  report:    { label: 'Report',    className: 'bg-gold-50 text-gold-700 dark:bg-gold-500/10 dark:text-gold-400' },
  corporate: { label: 'Corporate', className: 'bg-navy-50 text-navy-700 dark:bg-navy-500/10 dark:text-navy-400' },
};

const MODE_BADGES: Record<string, { label: string; className: string }> = {
  ai:          { label: 'AI',          className: 'bg-gold-50 text-gold-600 dark:bg-gold-500/10 dark:text-gold-400' },
  placeholder: { label: 'Placeholder', className: 'bg-stone-100 text-stone-600 dark:bg-stone-500/10 dark:text-stone-400' },
};

// ── Empty form state ───────────────────────────────────────

interface FormState {
  id: number | null;
  name: string;
  category: TemplateCategory;
  subcategory: string;
  description: string;
  mode: 'ai' | 'placeholder';
  ai_prompt: string;
  file_url: string;
  placeholders: PlaceholderField[];
  deadline_kind: string;
}

const EMPTY_FORM: FormState = {
  id: null,
  name: '',
  category: 'legal',
  subcategory: '',
  description: '',
  mode: 'ai',
  ai_prompt: '',
  file_url: '',
  placeholders: [],
  deadline_kind: '',
};

// ── Component ──────────────────────────────────────────────

export default function TemplateManager() {
  const [categoryFilter, setCategoryFilter] = useState('');
  const [search, setSearch] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  // Modal
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<FormState>({ ...EMPTY_FORM });
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [parsing, setParsing] = useState(false);
  const dropRef = useRef<HTMLDivElement>(null);

  // ── Fetch ────────────────────────────────────────────────

  const templatesKey = (() => {
    const params = new URLSearchParams({ includeInactive: 'true' });
    if (categoryFilter) params.set('category', categoryFilter);
    if (search) params.set('search', search);
    return `/api/templates?${params}`;
  })();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: templatesData, isValidating, mutate: mutateTemplates } = useSWR<{ data?: any[] }>(templatesKey, {
    keepPreviousData: true,
  });
  const loading = !templatesData;
  const templates = useMemo<Template[]>(
    () => (templatesData?.data ?? []).map((t) => ({
      ...t,
      mode: t.generation_mode ?? t.mode ?? 'ai',
      file_url: t.template_storage_path ?? t.file_url ?? null,
    })),
    [templatesData],
  );
  const fetchTemplates = useCallback(() => { void mutateTemplates(); }, [mutateTemplates]);

  // ── Helpers ──────────────────────────────────────────────

  function openCreate() {
    setForm({ ...EMPTY_FORM });
    setPendingFile(null);
    setModalOpen(true);
  }

  function openEdit(t: Template) {
    setForm({
      id: t.id,
      name: t.name,
      category: t.category as TemplateCategory,
      subcategory: t.subcategory ?? '',
      description: t.description ?? '',
      mode: t.mode,
      ai_prompt: t.ai_prompt ?? '',
      file_url: t.file_url ?? '',
      placeholders: t.placeholders ?? [],
      deadline_kind: t.deadline_kind ?? '',
    });
    setPendingFile(null);
    setModalOpen(true);
  }

  async function handleSave() {
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        name: form.name,
        category: form.category,
        subcategory: form.subcategory || null,
        description: form.description || null,
        generation_mode: form.mode,
        ai_prompt: form.mode === 'ai' ? form.ai_prompt || null : null,
        placeholders: form.mode === 'placeholder' ? form.placeholders : null,
        deadline_kind: form.subcategory === 'trademark_report' && form.deadline_kind ? form.deadline_kind : null,
      };

      let templateId = form.id;

      if (form.id) {
        body.id = form.id;
        await fetch('/api/templates', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      } else {
        const res = await fetch('/api/templates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const json = await res.json();
        templateId = json.data?.id ?? null;
      }

      // Upload pending file after save (so we have the template ID)
      if (pendingFile && templateId) {
        await uploadViaSignedUrl('/api/templates/upload', pendingFile, {
          templateId: String(templateId),
        });
      }

      setPendingFile(null);
      setModalOpen(false);
      fetchTemplates();
    } catch {
      console.error('Failed to save template');
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleActive(t: Template) {
    const next = { ...templatesData, data: (templatesData?.data ?? []).map((r) => (r.id === t.id ? { ...r, is_active: !t.is_active } : r)) };
    const request = async () => {
      const res = await fetch('/api/templates', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: t.id, is_active: !t.is_active }),
      });
      if (!res.ok) throw new Error('Failed to toggle template');
      return next;
    };
    try {
      await mutateTemplates(request, { optimisticData: next, rollbackOnError: true, revalidate: false });
    } catch {
      console.error('Failed to toggle template');
    }
  }

  async function handleDelete(t: Template) {
    if (!(await confirmAction({ title: `Permanently delete template "${t.name}"?`, message: 'This cannot be undone.', confirmLabel: 'Delete', danger: true }))) return;
    const next = { ...templatesData, data: (templatesData?.data ?? []).filter((r) => r.id !== t.id) };
    const request = async () => {
      const res = await fetch(`/api/templates?id=${t.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete template');
      return next;
    };
    try {
      await mutateTemplates(request, { optimisticData: next, rollbackOnError: true, revalidate: false });
    } catch {
      console.error('Failed to delete template');
    }
  }

  /**
   * Extract {{placeholder}} keys from a DOCX file's document.xml.
   * Word sometimes splits {{key}} across multiple XML runs, so we
   * strip tags first and scan the plain text.
   */
  async function extractPlaceholders(file: File): Promise<string[]> {
    const buf = await file.arrayBuffer();
    const zip = await JSZip.loadAsync(buf);
    const docFile = zip.file('word/document.xml');
    if (!docFile) return [];

    const xml = await docFile.async('string');
    // Strip XML tags to get plain text — handles split runs
    const plainText = xml.replace(/<[^>]+>/g, '');
    const matches = plainText.match(/\{\{([^}]+)\}\}/g) ?? [];
    // Deduplicate and extract key names
    const keys = [...new Set(matches.map((m) => m.slice(2, -2).trim()))];
    return keys;
  }

  async function processFile(file: File) {
    if (!file.name.toLowerCase().endsWith('.docx')) return;
    setParsing(true);
    setPendingFile(file);
    try {
      const keys = await extractPlaceholders(file);
      // Merge: keep existing placeholders that match, add new ones
      setForm((prev) => {
        const existingKeys = new Set(prev.placeholders.map((p) => p.key));
        const merged = [...prev.placeholders];
        for (const key of keys) {
          if (!existingKeys.has(key)) {
            merged.push({
              key,
              label: key
                .replace(/_/g, ' ')
                .replace(/\b\w/g, (c) => c.toUpperCase()),
              type: key.includes('date') ? 'date' : key.includes('amount') || key.includes('number') ? 'number' : 'text',
              required: true,
            });
          }
        }
        return { ...prev, placeholders: merged, mode: 'placeholder' };
      });
    } catch (err) {
      console.error('Failed to parse DOCX:', err);
    } finally {
      setParsing(false);
    }
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDragging(true);
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    // Only set dragging false if leaving the drop zone (not entering a child)
    if (dropRef.current && !dropRef.current.contains(e.relatedTarget as Node)) {
      setDragging(false);
    }
  }

  function removePendingFile() {
    setPendingFile(null);
    setForm((prev) => ({ ...prev, file_url: '' }));
  }

  // ── Placeholder rows ─────────────────────────────────────

  function addPlaceholder() {
    setForm((prev) => ({
      ...prev,
      placeholders: [...prev.placeholders, { key: '', label: '', type: 'text', required: false }],
    }));
  }

  function updatePlaceholder(index: number, field: keyof PlaceholderField, value: string | boolean) {
    setForm((prev) => {
      const next = [...prev.placeholders];
      next[index] = { ...next[index], [field]: value };
      return { ...prev, placeholders: next };
    });
  }

  function removePlaceholder(index: number) {
    setForm((prev) => ({
      ...prev,
      placeholders: prev.placeholders.filter((_, i) => i !== index),
    }));
  }

  // ── Filtered list ────────────────────────────────────────

  const filtered = templates.filter((t) => {
    if (search) {
      const q = search.toLowerCase();
      if (!t.name.toLowerCase().includes(q) && !(t.subcategory ?? '').toLowerCase().includes(q)) return false;
    }
    return true;
  });

  // ── Render ───────────────────────────────────────────────

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search templates..."
            className="w-full pl-9 pr-3 py-2 text-sm bg-card border border-[var(--border-color)] rounded-lg text-foreground placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-1 focus:ring-gold-400/50"
          />
        </div>
        <button
          type="button"
          onClick={() => setShowFilters(!showFilters)}
          className={`p-2 rounded-lg border transition-colors ${
            showFilters || categoryFilter
              ? 'bg-gold-50 dark:bg-gold-500/10 border-gold-300/50 dark:border-gold-500/30 text-gold-700 dark:text-gold-400'
              : 'border-[var(--border-color)] text-[var(--text-muted)] hover:text-foreground hover:bg-[var(--subtle-bg)]'
          }`}
        >
          <Filter className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={fetchTemplates}
          className="p-2 rounded-lg border border-[var(--border-color)] text-[var(--text-muted)] hover:text-foreground hover:bg-[var(--subtle-bg)] transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${isValidating ? 'animate-spin' : ''}`} />
        </button>
        <button
          type="button"
          onClick={openCreate}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg bg-gold-500 text-white hover:bg-gold-600 transition-colors"
        >
          <Plus className="w-4 h-4" />
          New Template
        </button>
      </div>

      {/* Filter panel */}
      {showFilters && (
        <div className="flex flex-wrap items-center gap-2 p-3 bg-card border border-[var(--border-color)] rounded-lg animate-fade-up">
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="text-xs bg-[var(--subtle-bg)] border border-[var(--border-color)] rounded-md px-2 py-1.5 text-foreground"
          >
            <option value="">All categories</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
            ))}
          </select>
          {categoryFilter && (
            <button
              type="button"
              onClick={() => setCategoryFilter('')}
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
                <th className="text-left px-4 py-3 text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">Name</th>
                <th className="text-left px-4 py-3 text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">Category</th>
                <th className="hidden sm:table-cell text-left px-4 py-3 text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">Subcategory</th>
                <th className="text-left px-4 py-3 text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">Mode</th>
                <th className="text-left px-4 py-3 text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">Status</th>
                <th className="text-right px-4 py-3 text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} className="border-b border-[var(--border-color)]">
                    {Array.from({ length: 6 }).map((_, j) => (
                      <td key={j} className="px-4 py-3">
                        <div className="h-4 bg-[var(--subtle-bg)] rounded skeleton-shimmer" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-[var(--text-muted)]">
                    No templates found
                  </td>
                </tr>
              ) : (
                filtered.map((t) => {
                  const catBadge = CATEGORY_BADGES[t.category as TemplateCategory] ?? { label: t.category, className: 'bg-stone-100 text-stone-600 dark:bg-stone-500/10 dark:text-stone-400' };
                  const modeBadge = MODE_BADGES[t.mode] ?? MODE_BADGES.ai;
                  return (
                    <tr key={t.id} className="border-b border-[var(--border-color)] hover:bg-[var(--subtle-bg)] transition-colors">
                      <td className="px-4 py-2.5">
                        <span className="text-sm font-medium text-foreground">{t.name}</span>
                        {t.description && (
                          <p className="text-xs text-[var(--text-muted)] truncate max-w-[260px] mt-0.5">{t.description}</p>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${catBadge.className}`}>
                          {catBadge.label}
                        </span>
                      </td>
                      <td className="hidden sm:table-cell px-4 py-2.5 text-xs text-[var(--text-secondary)]">
                        {t.subcategory ?? '\u2014'}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${modeBadge.className}`}>
                          {modeBadge.label}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                          t.is_active
                            ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400'
                            : 'bg-stone-100 text-stone-500 dark:bg-stone-500/10 dark:text-stone-400'
                        }`}>
                          {t.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => openEdit(t)}
                            className="p-1.5 rounded-md hover:bg-[var(--subtle-bg)] text-[var(--text-muted)] hover:text-foreground transition-colors"
                            title="Edit"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleToggleActive(t)}
                            className="p-1.5 rounded-md hover:bg-[var(--subtle-bg)] text-[var(--text-muted)] hover:text-foreground transition-colors"
                            title={t.is_active ? 'Deactivate' : 'Activate'}
                          >
                            {t.is_active ? <ToggleRight className="w-3.5 h-3.5 text-emerald-500 dark:text-emerald-400" /> : <ToggleLeft className="w-3.5 h-3.5" />}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(t)}
                            className="p-1.5 rounded-md hover:bg-red-50 dark:hover:bg-red-500/10 text-[var(--text-muted)] hover:text-red-600 dark:hover:text-red-400 transition-colors"
                            title="Delete"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
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

      {/* ── Create / Edit Modal ──────────────────────────── */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/40 dark:bg-black/60 backdrop-blur-sm" onClick={() => setModalOpen(false)} />

          {/* Panel */}
          <div className="relative w-full max-w-2xl mx-4 max-h-[85vh] flex flex-col bg-card border border-[var(--border-color)] rounded-xl shadow-[var(--shadow-card)] animate-fade-up">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-color)]">
              <h2 className="text-lg font-semibold text-foreground">
                {form.id ? 'Edit Template' : 'New Template'}
              </h2>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="p-1.5 rounded-md hover:bg-[var(--subtle-bg)] text-[var(--text-muted)] hover:text-foreground transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
              {/* Name */}
              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Name</label>
                <input
                  autoFocus
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                  placeholder="e.g. Demand Letter"
                  className="w-full px-3 py-2 text-sm bg-[var(--subtle-bg)] border border-[var(--border-color)] rounded-lg text-foreground placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-1 focus:ring-gold-400/50"
                />
              </div>

              {/* Category + Subcategory */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Category</label>
                  <select
                    value={form.category}
                    onChange={(e) => setForm((p) => ({ ...p, category: e.target.value as TemplateCategory }))}
                    className="w-full px-3 py-2 text-sm bg-[var(--subtle-bg)] border border-[var(--border-color)] rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-gold-400/50"
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Subcategory</label>
                  <input
                    type="text"
                    value={form.subcategory}
                    onChange={(e) => setForm((p) => ({ ...p, subcategory: e.target.value }))}
                    placeholder="e.g. Civil  ·  trademark_report"
                    className="w-full px-3 py-2 text-sm bg-[var(--subtle-bg)] border border-[var(--border-color)] rounded-lg text-foreground placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-1 focus:ring-gold-400/50"
                  />
                </div>
              </div>

              {/* Trademark deadline kind — only when this is a trademark report template */}
              {form.subcategory === 'trademark_report' && (
                <div>
                  <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
                    Trademark deadline kind
                  </label>
                  <select
                    value={form.deadline_kind}
                    onChange={(e) => setForm((p) => ({ ...p, deadline_kind: e.target.value }))}
                    className="w-full px-3 py-2 text-sm bg-[var(--subtle-bg)] border border-[var(--border-color)] rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-gold-400/50"
                  >
                    <option value="">— Select —</option>
                    {TRADEMARK_DEADLINE_KINDS.map((k) => (
                      <option key={k} value={k}>{k}</option>
                    ))}
                  </select>
                  <p className="text-[10px] text-[var(--text-muted)] mt-1">
                    The trademark deadlines page picks this template automatically when reporting a {form.deadline_kind || '<kind>'} deadline.
                  </p>
                </div>
              )}

              {/* Description */}
              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Description</label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
                  rows={2}
                  placeholder="Brief description of this template..."
                  className="w-full px-3 py-2 text-sm bg-[var(--subtle-bg)] border border-[var(--border-color)] rounded-lg text-foreground placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-1 focus:ring-gold-400/50 resize-none"
                />
              </div>

              {/* Mode Toggle */}
              <div>
                <label className="block text-xs font-medium text-[var(--text-secondary)] mb-2">Generation Mode</label>
                <div className="inline-flex rounded-lg border border-[var(--border-color)] overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setForm((p) => ({ ...p, mode: 'ai' }))}
                    className={`px-4 py-1.5 text-xs font-medium transition-colors ${
                      form.mode === 'ai'
                        ? 'bg-gold-50 dark:bg-gold-500/10 text-gold-700 dark:text-gold-400'
                        : 'text-[var(--text-muted)] hover:text-foreground hover:bg-[var(--subtle-bg)]'
                    }`}
                  >
                    AI
                  </button>
                  <button
                    type="button"
                    onClick={() => setForm((p) => ({ ...p, mode: 'placeholder' }))}
                    className={`px-4 py-1.5 text-xs font-medium border-l border-[var(--border-color)] transition-colors ${
                      form.mode === 'placeholder'
                        ? 'bg-stone-100 dark:bg-stone-500/10 text-stone-700 dark:text-stone-400'
                        : 'text-[var(--text-muted)] hover:text-foreground hover:bg-[var(--subtle-bg)]'
                    }`}
                  >
                    Placeholder
                  </button>
                </div>
              </div>

              {/* AI Mode: Prompt */}
              {form.mode === 'ai' && (
                <div>
                  <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">AI Prompt</label>
                  <textarea
                    value={form.ai_prompt}
                    onChange={(e) => setForm((p) => ({ ...p, ai_prompt: e.target.value }))}
                    rows={6}
                    placeholder="Enter the AI generation prompt. Use {{variable}} for dynamic values..."
                    className="w-full px-3 py-2 text-sm bg-[var(--subtle-bg)] border border-[var(--border-color)] rounded-lg text-foreground placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-1 focus:ring-gold-400/50 resize-none font-mono"
                  />
                </div>
              )}

              {/* Placeholder Mode: File Upload + Fields */}
              {form.mode === 'placeholder' && (
                <>
                  {/* Drag-and-drop file zone */}
                  <div>
                    <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Template File (.docx)</label>
                    {pendingFile || form.file_url ? (
                      <div className="flex items-center gap-3 p-3 bg-[var(--subtle-bg)] border border-[var(--border-color)] rounded-lg">
                        <FileText className="w-8 h-8 text-blue-500 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-foreground truncate">
                            {pendingFile?.name ?? form.file_url?.split('/').pop() ?? 'Template file'}
                          </p>
                          <p className="text-[10px] text-[var(--text-muted)]">
                            {pendingFile
                              ? `${(pendingFile.size / 1024).toFixed(0)} KB — will be uploaded on save`
                              : 'Uploaded'}
                          </p>
                        </div>
                        <div className="flex items-center gap-1">
                          <label className="relative p-1.5 rounded-md hover:bg-card text-[var(--text-muted)] hover:text-foreground transition-colors cursor-pointer" title="Replace file">
                            <Upload className="w-3.5 h-3.5" />
                            <input type="file" accept=".docx" className="absolute inset-0 opacity-0 cursor-pointer" onChange={handleFileSelect} />
                          </label>
                          <button
                            type="button"
                            onClick={removePendingFile}
                            className="p-1.5 rounded-md hover:bg-red-50 dark:hover:bg-red-500/10 text-[var(--text-muted)] hover:text-red-600 dark:hover:text-red-400 transition-colors"
                            title="Remove file"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div
                        ref={dropRef}
                        onDrop={handleDrop}
                        onDragOver={handleDragOver}
                        onDragLeave={handleDragLeave}
                        className={`relative flex flex-col items-center justify-center gap-2 p-6 border-2 border-dashed rounded-lg transition-colors cursor-pointer ${
                          dragging
                            ? 'border-gold-400 bg-gold-50/50 dark:bg-gold-500/5'
                            : 'border-[var(--border-color)] hover:border-gold-300 dark:hover:border-gold-500/30 hover:bg-[var(--subtle-bg)]'
                        }`}
                      >
                        <input
                          type="file"
                          accept=".docx"
                          onChange={handleFileSelect}
                          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                        />
                        {parsing ? (
                          <>
                            <RefreshCw className="w-6 h-6 text-gold-500 animate-spin dark:text-gold-400" />
                            <p className="text-xs text-[var(--text-muted)]">Extracting placeholders...</p>
                          </>
                        ) : (
                          <>
                            <Upload className={`w-6 h-6 ${dragging ? 'text-gold-500 dark:text-gold-400' : 'text-[var(--text-muted)]'}`} />
                            <div className="text-center">
                              <p className="text-sm font-medium text-[var(--text-secondary)]">
                                {dragging ? 'Drop file here' : 'Drag & drop a .docx file'}
                              </p>
                              <p className="text-[10px] text-[var(--text-muted)] mt-0.5">
                                or click to browse — placeholders will be auto-detected
                              </p>
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Placeholder fields editor */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-xs font-medium text-[var(--text-secondary)]">Placeholder Fields</label>
                      <button
                        type="button"
                        onClick={addPlaceholder}
                        className="inline-flex items-center gap-1 text-[10px] font-medium text-gold-600 dark:text-gold-400 hover:text-gold-700 dark:hover:text-gold-300 transition-colors"
                      >
                        <Plus className="w-3 h-3" />
                        Add Field
                      </button>
                    </div>

                    {form.placeholders.length === 0 ? (
                      <p className="text-xs text-[var(--text-muted)] py-3 text-center border border-dashed border-[var(--border-color)] rounded-lg">
                        No placeholder fields yet. Click &quot;Add Field&quot; to start.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {form.placeholders.map((ph, idx) => (
                          <div key={idx} className="flex items-center gap-2 p-2 bg-[var(--subtle-bg)] border border-[var(--border-color)] rounded-lg">
                            <input
                              type="text"
                              value={ph.key}
                              onChange={(e) => updatePlaceholder(idx, 'key', e.target.value)}
                              placeholder="key"
                              className="w-24 px-2 py-1 text-xs bg-card border border-[var(--border-color)] rounded text-foreground placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-1 focus:ring-gold-400/50 font-mono"
                            />
                            <input
                              type="text"
                              value={ph.label}
                              onChange={(e) => updatePlaceholder(idx, 'label', e.target.value)}
                              placeholder="Label"
                              className="flex-1 px-2 py-1 text-xs bg-card border border-[var(--border-color)] rounded text-foreground placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-1 focus:ring-gold-400/50"
                            />
                            <select
                              value={ph.type}
                              onChange={(e) => updatePlaceholder(idx, 'type', e.target.value)}
                              className="w-24 px-2 py-1 text-xs bg-card border border-[var(--border-color)] rounded text-foreground focus:outline-none focus:ring-1 focus:ring-gold-400/50"
                            >
                              <option value="text">Text</option>
                              <option value="textarea">Textarea</option>
                              <option value="number">Number</option>
                              <option value="date">Date</option>
                            </select>
                            <label className="flex items-center gap-1 text-[10px] text-[var(--text-muted)] whitespace-nowrap cursor-pointer">
                              <input
                                type="checkbox"
                                checked={ph.required}
                                onChange={(e) => updatePlaceholder(idx, 'required', e.target.checked)}
                                className="rounded border-[var(--border-color)] text-gold-500 focus:ring-gold-400/50 dark:text-gold-400"
                              />
                              Req
                            </label>
                            <button
                              type="button"
                              onClick={() => removePlaceholder(idx)}
                              className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-500/10 text-[var(--text-muted)] hover:text-red-600 dark:hover:text-red-400 transition-colors"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-[var(--border-color)]">
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="px-4 py-2 text-sm font-medium text-[var(--text-secondary)] hover:text-foreground rounded-lg hover:bg-[var(--subtle-bg)] transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving || !form.name}
                className="px-4 py-2 text-sm font-medium rounded-lg bg-gold-500 text-white hover:bg-gold-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {saving ? 'Saving...' : form.id ? 'Update Template' : 'Create Template'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
