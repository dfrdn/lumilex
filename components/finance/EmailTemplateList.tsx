'use client';

import { createPortal } from 'react-dom';
import { useState, useMemo, useCallback } from 'react';
import {
  Mail, Plus, Pencil, Copy, Trash2, Star, Loader2, X, Check,
} from 'lucide-react';
import EmailTemplateEditor, { type EmailTemplate, type TemplateVars } from './EmailTemplateEditor';
import { useEmailTemplates, type SavedTemplate, toEmailTemplate } from '@/hooks/useEmailTemplates';
import { useBrand } from '@/components/BrandProvider';
import { confirmAction } from '@/components/ui/confirm';
import { toast } from 'sonner';

const CATEGORIES = [
  { key: 'all', label: 'All' },
  { key: 'reminder', label: 'Reminder' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'final', label: 'Final Notice' },
] as const;

const CATEGORY_COLORS: Record<string, { bg: string; text: string }> = {
  billing: { bg: 'bg-blue-50 dark:bg-blue-500/10', text: 'text-blue-700 dark:text-blue-400' },
  reminder: { bg: 'bg-amber-50 dark:bg-amber-500/10', text: 'text-amber-700 dark:text-amber-400' },
  overdue: { bg: 'bg-orange-50 dark:bg-orange-500/10', text: 'text-orange-700 dark:text-orange-400' },
  final: { bg: 'bg-red-50 dark:bg-red-500/10', text: 'text-red-700 dark:text-red-400' },
};

const SAMPLE_VARS: TemplateVars = {
  clientName: 'Acme Corporation',
  month: 'March 2026',
  amount: '₱221,550.00',
  dueDate: '9 April 2026',
  invoiceNumber: 'INV-2026-03-001',
  daysOverdue: '45',
};

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, '').replace(/&\w+;/g, ' ').trim();
}

interface EditingState {
  id?: number;
  name: string;
  category: string;
  template: EmailTemplate;
  isDefault: boolean;
}

export default function EmailTemplateList({ financeAddress }: { financeAddress: string }) {
  const firmName = useBrand().fullName;
  const { templates, loading, refetch } = useEmailTemplates();
  const [activeCategory, setActiveCategory] = useState('all');
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<number | null>(null);

  // The billing email is written on the Billing Letter page, not kept as
  // templates; only the follow-ups are listed here.
  const followUps = useMemo(() => templates.filter((t) => t.category !== 'billing'), [templates]);
  const filtered = useMemo(() => {
    if (activeCategory === 'all') return followUps;
    return followUps.filter((t) => t.category === activeCategory);
  }, [followUps, activeCategory]);

  const openNew = useCallback(() => {
    setEditing({
      name: '',
      category: 'reminder',
      template: { subject: '', body: '' },
      isDefault: false,
    });
  }, []);

  const openEdit = useCallback((t: SavedTemplate) => {
    setEditing({
      id: t.id,
      name: t.name,
      category: t.category,
      template: toEmailTemplate(t),
      isDefault: t.is_category_default,
    });
  }, []);

  const openDuplicate = useCallback((t: SavedTemplate) => {
    setEditing({
      name: `${t.name} (Copy)`,
      category: t.category,
      template: toEmailTemplate(t),
      isDefault: false,
    });
  }, []);

  const handleSave = useCallback(async () => {
    if (!editing || !editing.name.trim() || !editing.template.subject.trim()) return;
    setSaving(true);
    try {
      const payload = {
        id: editing.id,
        name: editing.name,
        category: editing.category,
        subject: editing.template.subject,
        body: editing.template.body,
        isDefault: editing.isDefault,
      };
      const res = await fetch('/api/finance/email-templates', {
        method: editing.id ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Save failed');
      }
      setEditing(null);
      await refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }, [editing, refetch]);

  const handleDelete = useCallback(async (id: number) => {
    if (!(await confirmAction({ title: 'Delete this template?', confirmLabel: 'Delete', danger: true }))) return;
    setDeleting(id);
    try {
      const res = await fetch(`/api/finance/email-templates?id=${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Delete failed');
      }
      await refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setDeleting(null);
    }
  }, [refetch]);

  const handleSetDefault = useCallback(async (t: SavedTemplate) => {
    try {
      const res = await fetch('/api/finance/email-templates', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: t.id, category: t.category, isDefault: true }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed');
      }
      await refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed');
    }
  }, [refetch]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-[var(--text-muted)]" />
      </div>
    );
  }

  return (
    <>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gold-50 dark:bg-gold-500/10 flex items-center justify-center">
              <Mail className="w-5 h-5 text-gold-600 dark:text-gold-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-foreground">Follow-up Emails</h2>
              <p className="text-sm text-[var(--text-muted)]">Reminders, overdue notices and final notices. The billing letter and the email it goes out with are on the Billing Letter page.</p>
            </div>
          </div>
          <button
            onClick={openNew}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-navy-900 dark:bg-gold-400 text-white dark:text-navy-950 hover:bg-navy-800 dark:hover:bg-gold-300 transition-all"
          >
            <Plus className="w-4 h-4" />
            New Template
          </button>
        </div>

        {/* Category Tabs */}
        <div className="flex gap-1.5 p-1 bg-[var(--subtle-bg)] rounded-xl w-fit">
          {CATEGORIES.map((c) => {
            const count = c.key === 'all' ? followUps.length : followUps.filter((t) => t.category === c.key).length;
            return (
              <button
                key={c.key}
                onClick={() => setActiveCategory(c.key)}
                className={`px-3.5 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                  activeCategory === c.key
                    ? 'bg-[var(--card-bg)] text-foreground shadow-sm'
                    : 'text-[var(--text-muted)] hover:text-foreground'
                }`}
              >
                {c.label}
                <span className="ml-1.5 text-[10px] opacity-60">{count}</span>
              </button>
            );
          })}
        </div>

        {/* Email Template Cards */}
        <div>
          <h2 className="text-sm font-semibold text-foreground mb-3">Follow-up templates</h2>
        </div>

        {/* Template Cards */}
        {filtered.length === 0 ? (
          <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] shadow-[var(--shadow-card)] p-12 text-center">
            <Mail className="w-8 h-8 text-[var(--text-muted)] mx-auto mb-3" />
            <p className="text-sm text-[var(--text-muted)]">No templates in this category</p>
            <button onClick={openNew} className="mt-3 text-sm font-medium text-gold-600 dark:text-gold-400 hover:underline">
              Create one
            </button>
          </div>
        ) : (
          <div className="grid gap-3">
            {filtered.map((t) => {
              const colors = CATEGORY_COLORS[t.category] ?? CATEGORY_COLORS.billing;
              return (
                <div
                  key={t.id}
                  className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] shadow-[var(--shadow-card)] p-4 hover:border-gold-200 dark:hover:border-gold-500/20 transition-colors"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="text-sm font-semibold text-foreground">{t.name}</h3>
                        <span className={`inline-flex items-center px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded-full ${colors.bg} ${colors.text}`}>
                          {t.category}
                        </span>
                        {t.is_category_default && (
                          <span className="inline-flex items-center gap-0.5 px-2 py-0.5 text-[10px] font-semibold rounded-full bg-gold-50 dark:bg-gold-500/10 text-gold-700 dark:text-gold-400">
                            <Star className="w-2.5 h-2.5 fill-current" /> Default
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-[var(--text-secondary)] mb-1 font-mono truncate">{t.subject}</p>
                      <p className="text-xs text-[var(--text-muted)] line-clamp-2">{stripHtml(t.body_html).slice(0, 150)}</p>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      {!t.is_category_default && (
                        <button
                          onClick={() => handleSetDefault(t)}
                          title="Set as default"
                          className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-gold-600 dark:hover:text-gold-400 hover:bg-gold-50 dark:hover:bg-gold-500/10 transition-colors"
                        >
                          <Star className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <button
                        onClick={() => openEdit(t)}
                        title="Edit"
                        className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-foreground hover:bg-[var(--subtle-bg)] transition-colors"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => openDuplicate(t)}
                        title="Duplicate"
                        className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-foreground hover:bg-[var(--subtle-bg)] transition-colors"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleDelete(t.id)}
                        disabled={deleting === t.id}
                        title="Delete"
                        className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors disabled:opacity-50"
                      >
                        {deleting === t.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Edit/Create Modal */}
      {editing && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 dark:bg-black/60 backdrop-blur-sm" onClick={() => setEditing(null)} />
          <div className="relative bg-[var(--card-bg)] rounded-2xl border border-[var(--border-color)] shadow-2xl w-full max-w-6xl max-h-[90vh] flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-color)]">
              <h2 className="text-lg font-semibold text-foreground">
                {editing.id ? 'Edit Template' : 'New Template'}
              </h2>
              <button onClick={() => setEditing(null)} className="p-1.5 rounded-lg hover:bg-[var(--subtle-bg)] text-[var(--text-muted)] transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
              {/* Name + Category + Default */}
              <div className="grid grid-cols-[1fr_auto_auto] gap-3 items-end">
                <div>
                  <label className="block text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1">Template Name</label>
                  <input
                    type="text"
                    value={editing.name}
                    onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                    placeholder="e.g. Standard Billing"
                    className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--background)] border border-[var(--border-color)] text-foreground focus:outline-none focus:border-gold-400 focus:ring-1 focus:ring-gold-400/20"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1">Category</label>
                  <select
                    value={editing.category}
                    onChange={(e) => setEditing({ ...editing, category: e.target.value })}
                    className="px-3 py-2 text-sm rounded-lg bg-[var(--background)] border border-[var(--border-color)] text-foreground focus:outline-none focus:border-gold-400"
                  >
                    <option value="reminder">Reminder</option>
                    <option value="overdue">Overdue</option>
                    <option value="final">Final Notice</option>
                  </select>
                </div>
                <label className="flex items-center gap-2 px-3 py-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editing.isDefault}
                    onChange={(e) => setEditing({ ...editing, isDefault: e.target.checked })}
                    className="rounded border-[var(--border-color)]"
                  />
                  <span className="text-xs font-medium text-[var(--text-secondary)]">Default</span>
                </label>
              </div>

              {/* Template Editor */}
              <EmailTemplateEditor
                template={editing.template}
                onChange={(t) => setEditing({ ...editing, template: t })}
                sampleVars={{ ...SAMPLE_VARS, firmName }}
                financeAddress={financeAddress}
              />
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between px-6 py-4 border-t border-[var(--border-color)]">
              <button
                onClick={() => setEditing(null)}
                className="px-4 py-2 text-sm font-medium text-[var(--text-secondary)] hover:text-foreground transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !editing.name.trim() || !editing.template.subject.trim()}
                className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold bg-navy-900 dark:bg-gold-400 text-white dark:text-navy-950 hover:bg-navy-800 dark:hover:bg-gold-300 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                {saving ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</>
                ) : (
                  <><Check className="w-4 h-4" /> {editing.id ? 'Save Changes' : 'Create Template'}</>
                )}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
