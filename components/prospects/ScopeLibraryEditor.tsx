'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { confirmAction } from '@/components/ui/confirm';
import { toast } from 'sonner';
import { Loader2, Plus, Trash2, Save, ArrowUp, ArrowDown, Lock } from 'lucide-react';
import { failureMessage } from '@/lib/api-error';
import CellDropdown from '@/components/admin/CellDropdown';
import type { ProposalBlock } from '@/lib/engagement-proposal/types';
import type {
  LoadedScopeTemplate, ProposalArrangement, ScopeTemplateContent,
} from '@/lib/scope-library/types';

const ARRANGEMENTS: { id: ProposalArrangement; label: string }[] = [
  { id: 'retainer', label: 'Retainer' },
  { id: 'hourly', label: 'Hourly' },
  { id: 'acceptance_completion', label: 'Acceptance + completion' },
  { id: 'fixed', label: 'Fixed fee' },
  { id: 'custom', label: 'Custom' },
];

const BLOCK_KINDS: { id: ProposalBlock['kind']; label: string }[] = [
  { id: 'para', label: 'Paragraph' },
  { id: 'labelled', label: 'Bold lead-in + text' },
  { id: 'list', label: 'List' },
  { id: 'subheading', label: 'Sub-heading' },
];

const inputCls =
  'w-full px-2.5 py-1.5 text-sm rounded-lg border border-[var(--border-color)] bg-[var(--card-bg)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-navy-500/30';
const labelCls = 'block text-[10px] font-medium text-[var(--text-muted)] uppercase tracking-wider mb-1';

function emptyBlock(kind: ProposalBlock['kind']): ProposalBlock {
  switch (kind) {
    case 'subheading': return { kind: 'subheading', text: '' };
    case 'labelled': return { kind: 'labelled', label: '', text: '' };
    case 'list': return { kind: 'list', ordered: true, items: [''] };
    case 'feeTable': return { kind: 'feeTable', rows: [{ fee: '', amount: '', when: '' }] };
    default: return { kind: 'para', text: '' };
  }
}

function newTemplate(): ScopeTemplateContent {
  return {
    slug: '',
    name: '',
    subheading: '',
    blocks: [{ kind: 'labelled', label: '', text: '' }],
    role: 'service',
    arrangements: [],
    autoSelect: false,
    feeScheduleSlugs: [],
    aliases: [],
  };
}

function Toggle({ label, checked, onChange, hint }: {
  label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string;
}) {
  return (
    <label className="flex items-start gap-2 text-sm text-[var(--text-primary)] cursor-pointer">
      <input type="checkbox" checked={checked} className="mt-0.5" onChange={(e) => onChange(e.target.checked)} />
      <span>
        {label}
        {hint && <span className="block text-xs text-[var(--text-muted)]">{hint}</span>}
      </span>
    </label>
  );
}

/** Block-kind picker — the app never renders a native select. */
function KindPicker({ value, onSelect }: { value: ProposalBlock['kind']; onSelect: (k: ProposalBlock['kind']) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button type="button" ref={ref} onClick={() => setOpen((o) => !o)}
        className="text-[11px] text-[var(--text-muted)] hover:text-[var(--text-primary)]">
        {BLOCK_KINDS.find((k) => k.id === value)?.label ?? 'Paragraph'}
      </button>
      {open && (
        <CellDropdown
          mode="single"
          value={value}
          options={BLOCK_KINDS.map((k) => ({ id: k.id, label: k.label }))}
          onSelect={(id) => { if (id) onSelect(id as ProposalBlock['kind']); setOpen(false); }}
          onClose={() => setOpen(false)}
          anchorRef={ref}
        />
      )}
    </>
  );
}

function BlockEditor({ block, onChange }: { block: ProposalBlock; onChange: (b: ProposalBlock) => void }) {
  if (block.kind === 'subheading') {
    return <input className={inputCls} value={block.text} placeholder="Sub-heading"
      onChange={(e) => onChange({ ...block, text: e.target.value })} />;
  }
  if (block.kind === 'labelled') {
    return (
      <div className="space-y-1.5">
        <input className={inputCls} value={block.label} placeholder="Bold lead-in"
          onChange={(e) => onChange({ ...block, label: e.target.value })} />
        <textarea className={inputCls} rows={4} value={block.text} placeholder="Body text"
          onChange={(e) => onChange({ ...block, text: e.target.value })} />
      </div>
    );
  }
  if (block.kind === 'list') {
    return (
      <div className="space-y-1.5">
        {block.items.map((item, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <input className={inputCls} value={item}
              onChange={(e) => onChange({ ...block, items: block.items.map((v, j) => (j === i ? e.target.value : v)) })} />
            <button type="button" title="Remove item" className="text-[var(--text-muted)] hover:text-red-500 shrink-0"
              onClick={() => onChange({ ...block, items: block.items.filter((_, j) => j !== i) })}>
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
        <div className="flex items-center gap-3">
          <button type="button" className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] inline-flex items-center gap-1"
            onClick={() => onChange({ ...block, items: [...block.items, ''] })}>
            <Plus className="w-3 h-3" /> Add item
          </button>
          <Toggle label="Numbered" checked={block.ordered} onChange={(v) => onChange({ ...block, ordered: v })} />
        </div>
      </div>
    );
  }
  if (block.kind === 'feeTable') {
    return <p className="text-xs text-[var(--text-muted)]">Fee tables belong in the fee schedule, not a scope line.</p>;
  }
  return (
    <textarea className={inputCls} rows={5} value={block.text}
      placeholder="Paragraph — wrap text in **double asterisks** for bold"
      onChange={(e) => onChange({ ...block, text: e.target.value })} />
  );
}

export default function ScopeLibraryEditor({ canEdit }: { canEdit: boolean }) {
  const [templates, setTemplates] = useState<LoadedScopeTemplate[]>([]);
  const [schedules, setSchedules] = useState<{ slug: string; name: string }[]>([]);
  const [slug, setSlug] = useState<string | null>(null);
  const [content, setContent] = useState<ScopeTemplateContent | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const set = useCallback((mut: (draft: ScopeTemplateContent) => void) => {
    setContent((prev) => {
      if (!prev) return prev;
      const next = structuredClone(prev);
      mut(next);
      return next;
    });
    setDirty(true);
  }, []);

  useEffect(() => {
    Promise.all([
      fetch('/api/scope-library').then((r) => r.json()),
      fetch('/api/fee-schedule').then((r) => r.json()).catch(() => ({ schedules: [] })),
    ])
      .then(([lib, fee]) => {
        const list: LoadedScopeTemplate[] = lib?.templates ?? [];
        setTemplates(list);
        setSchedules((fee?.schedules ?? []).map((s: { slug: string; name: string }) => ({ slug: s.slug, name: s.name })));
        if (list.length) {
          setSlug(list[0].slug);
          setContent(list[0].content);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const select = async (next: string) => {
    if (dirty && !(await confirmAction({ title: 'Discard unsaved changes to this scope line?', confirmLabel: 'Discard', danger: true }))) return;
    const found = templates.find((t) => t.slug === next);
    if (!found) return;
    setSlug(next);
    setContent(found.content);
    setIsNew(false);
    setDirty(false);
  };

  const startNew = async () => {
    if (dirty && !(await confirmAction({ title: 'Discard unsaved changes to this scope line?', confirmLabel: 'Discard', danger: true }))) return;
    setSlug(null);
    setContent(newTemplate());
    setIsNew(true);
    setDirty(false);
  };

  const save = async () => {
    if (!content) return;
    if (!content.slug.trim() || !content.name.trim() || !content.subheading.trim()) {
      toast.error('A scope line needs a slug, a name, and a subheading.');
      return;
    }
    if (isNew && templates.some((t) => t.slug === content.slug)) {
      toast.error(`"${content.slug}" already exists — pick a different slug or edit that line.`);
      return;
    }
    setSaving(true);
    try {
      const r = await fetch('/api/scope-library', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: content.name, content }),
      });
      if (!r.ok) throw new Error(await failureMessage(r, 'Save failed.'));
      // The server decides where a line sits in the catalogue; mirroring the
      // saved row keeps this list in the order the next proposal will print.
      const saved = (await r.json())?.template as { id?: string; sort_order?: number } | undefined;
      setTemplates((prev) => {
        const existing = prev.find((t) => t.slug === content.slug);
        const row = {
          id: saved?.id ?? null,
          slug: content.slug,
          name: content.name,
          content,
          sortOrder: saved?.sort_order ?? existing?.sortOrder ?? prev.length,
          isActive: existing?.isActive ?? true,
          isTemplate: false,
        };
        const next = existing ? prev.map((t) => (t.slug === content.slug ? row : t)) : [...prev, row];
        return next.sort((a, b) => a.sortOrder - b.sortOrder || a.slug.localeCompare(b.slug));
      });
      setSlug(content.slug);
      setIsNew(false);
      setDirty(false);
      toast.success(`${content.name} saved — the next proposal drafted will use it.`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const setActive = async (target: LoadedScopeTemplate, isActive: boolean) => {
    try {
      const r = await fetch('/api/scope-library', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: target.content, name: target.name, isActive }),
      });
      if (!r.ok) throw new Error(await failureMessage(r, 'Could not change this line.'));
      setTemplates((prev) => prev.map((t) => (t.slug === target.slug ? { ...t, isActive } : t)));
      toast.success(isActive ? `${target.name} is offered again` : `${target.name} is no longer offered`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-5 h-5 text-[var(--text-muted)] animate-spin" />
      </div>
    );
  }

  const current = slug ? templates.find((t) => t.slug === slug) : null;

  return (
    <div className="h-full flex">
      {/* Catalogue */}
      <aside className="w-72 shrink-0 border-r border-[var(--border-color)] overflow-y-auto">
        <div className="px-3 py-2.5 flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">Scope lines</span>
          {canEdit && (
            <button type="button" onClick={startNew}
              className="inline-flex items-center gap-1 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]">
              <Plus className="w-3.5 h-3.5" /> New
            </button>
          )}
        </div>
        {templates.map((t) => (
          <button
            key={t.slug}
            type="button"
            onClick={() => select(t.slug)}
            className={`w-full text-left px-3 py-2 border-l-2 ${
              slug === t.slug && !isNew
                ? 'border-gold-500 bg-gold-50/60 dark:bg-gold-500/10'
                : 'border-transparent hover:bg-[var(--bg-hover)]'
            }`}
          >
            <span className={`block text-sm ${t.isActive ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)] line-through'}`}>
              {t.name}
            </span>
            <span className="block text-[11px] text-[var(--text-muted)]">
              {t.content.role === 'exclusions' ? 'Carve-outs · always last' : t.content.subheading}
              {t.content.autoSelect && ' · auto'}
            </span>
          </button>
        ))}
        {isNew && (
          <div className="px-3 py-2 border-l-2 border-gold-500 bg-gold-50/60 dark:bg-gold-500/10">
            <span className="block text-sm text-[var(--text-primary)]">{content?.name || 'New scope line'}</span>
            <span className="block text-[11px] text-[var(--text-muted)]">Unsaved</span>
          </div>
        )}
      </aside>

      {/* Editor */}
      <div className="flex-1 overflow-y-auto">
        {!content ? (
          <div className="p-6 text-sm text-[var(--text-muted)]">Pick a scope line to edit it.</div>
        ) : (
          <div className="p-5 max-w-3xl space-y-5">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                {isNew ? 'New scope line' : content.name}
              </h2>
              {dirty && <span className="text-xs text-amber-600">• unsaved</span>}
              {current?.isTemplate && (
                <span className="inline-flex items-center gap-1 text-[11px] text-[var(--text-muted)]">
                  <Lock className="w-3 h-3" /> shipped default — saving replaces it
                </span>
              )}
              {canEdit && (
                <button type="button" onClick={save} disabled={saving}
                  className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-navy-900 text-white hover:bg-navy-800 dark:bg-zinc-100 dark:text-zinc-900 disabled:opacity-50">
                  {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Save
                </button>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className={labelCls}>Name (admin only)</span>
                <input className={inputCls} value={content.name} placeholder="Retainer — General Legal Support"
                  onChange={(e) => set((d) => { d.name = e.target.value; })} />
              </label>
              <label className="block">
                <span className={labelCls}>Slug</span>
                <input className={inputCls} value={content.slug} placeholder="retainer-general" disabled={!isNew}
                  onChange={(e) => set((d) => { d.slug = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'); })} />
              </label>
            </div>

            <label className="block">
              <span className={labelCls}>Subheading printed in the letter</span>
              <input className={inputCls} value={content.subheading} placeholder="Retainer Services"
                onChange={(e) => set((d) => { d.subheading = e.target.value; })} />
            </label>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <span className={labelCls}>Role</span>
                <div className="flex gap-3 text-sm">
                  {(['service', 'exclusions'] as const).map((role) => (
                    <label key={role} className="inline-flex items-center gap-1.5 text-[var(--text-primary)] cursor-pointer">
                      <input type="radio" checked={content.role === role} onChange={() => set((d) => { d.role = role; })} />
                      {role === 'service' ? 'Service line' : 'Carve-outs'}
                    </label>
                  ))}
                </div>
                <p className="text-[11px] text-[var(--text-muted)] mt-1">
                  Carve-outs always print last, under their own heading. Only one is used per letter.
                </p>
              </div>
              <div className="space-y-1.5">
                <Toggle
                  label="Pre-select this line"
                  hint="Selected by default whenever the arrangement matches."
                  checked={content.autoSelect}
                  onChange={(v) => set((d) => { d.autoSelect = v; })}
                />
              </div>
            </div>

            <div>
              <span className={labelCls}>Offered under</span>
              <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                {ARRANGEMENTS.map((a) => (
                  <Toggle
                    key={a.id}
                    label={a.label}
                    checked={content.arrangements.includes(a.id)}
                    onChange={(v) => set((d) => {
                      d.arrangements = v
                        ? [...d.arrangements, a.id]
                        : d.arrangements.filter((x) => x !== a.id);
                    })}
                  />
                ))}
              </div>
              <p className="text-[11px] text-[var(--text-muted)] mt-1">Tick none to offer it under every arrangement.</p>
            </div>

            <div>
              <span className={labelCls}>Attach these fee schedules as Annex &ldquo;A&rdquo;</span>
              <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                {schedules.map((s) => (
                  <Toggle
                    key={s.slug}
                    label={s.name}
                    checked={content.feeScheduleSlugs.includes(s.slug)}
                    onChange={(v) => set((d) => {
                      d.feeScheduleSlugs = v
                        ? [...d.feeScheduleSlugs, s.slug]
                        : d.feeScheduleSlugs.filter((x) => x !== s.slug);
                    })}
                  />
                ))}
              </div>
              <p className="text-[11px] text-[var(--text-muted)] mt-1">
                Selecting this line attaches them, so an offer never reaches the client without its price.
              </p>
            </div>

            <label className="block">
              <span className={labelCls}>Intake phrasings that mean this line</span>
              <input className={inputCls} value={content.aliases.join(', ')} placeholder="retainer, monthly retainer"
                onChange={(e) => set((d) => { d.aliases = e.target.value.split(',').map((s) => s.trim()).filter(Boolean); })} />
              <span className="block text-[11px] text-[var(--text-muted)] mt-1">
                Comma-separated. Used to pre-tick this line from what the intake recorded.
              </span>
            </label>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className={labelCls}>Text</span>
                <span className="text-[11px] text-[var(--text-muted)]">
                  Tokens: {'{{retainerHours}}'} {'{{monthlyFee}}'} {'{{initialFee}}'} {'{{tierLabel}}'}
                </span>
              </div>
              {content.blocks.map((block, i) => (
                <div key={i} className="rounded-lg border border-[var(--border-color)] p-2.5 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <KindPicker value={block.kind} onSelect={(k) => set((d) => { d.blocks[i] = emptyBlock(k); })} />
                    <div className="ml-auto flex items-center gap-1">
                      <button type="button" title="Move up" className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                        onClick={() => set((d) => {
                          if (i === 0) return;
                          [d.blocks[i - 1], d.blocks[i]] = [d.blocks[i], d.blocks[i - 1]];
                        })}><ArrowUp className="w-3.5 h-3.5" /></button>
                      <button type="button" title="Move down" className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                        onClick={() => set((d) => {
                          if (i >= d.blocks.length - 1) return;
                          [d.blocks[i + 1], d.blocks[i]] = [d.blocks[i], d.blocks[i + 1]];
                        })}><ArrowDown className="w-3.5 h-3.5" /></button>
                      <button type="button" title="Remove block" className="text-[var(--text-muted)] hover:text-red-500"
                        onClick={() => set((d) => { d.blocks.splice(i, 1); })}><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  </div>
                  <BlockEditor block={block} onChange={(b) => set((d) => { d.blocks[i] = b; })} />
                </div>
              ))}
              <button type="button" className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] inline-flex items-center gap-1"
                onClick={() => set((d) => { d.blocks.push(emptyBlock('labelled')); })}>
                <Plus className="w-3.5 h-3.5" /> Add block
              </button>
            </div>

            {canEdit && current && !isNew && (
              <div className="pt-3 border-t border-[var(--border-color)]">
                <Toggle
                  label="Offer this line when drafting"
                  hint="Turn off to retire a line without losing its text. Letters already sent are unaffected."
                  checked={current.isActive}
                  onChange={(v) => setActive(current, v)}
                />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
