'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  Loader2, Plus, Trash2, Download, RefreshCw, Save, RotateCcw, ArrowUp, ArrowDown,
} from 'lucide-react';
import { failureMessage } from '@/lib/api-error';
import type {
  FeeScheduleContent, ProfessionalBody, TableBody, FeeRow,
} from '@/lib/fee-schedule/types';
import type { LoadedFeeSchedule } from '@/lib/fee-schedule/load';
import { confirmAction } from '@/components/ui/confirm';

const TABS = [
  { id: 'cover', label: 'Cover' },
  { id: 'body', label: 'Fees' },
  { id: 'notes', label: 'Notes' },
] as const;
type TabId = (typeof TABS)[number]['id'];

const inputCls =
  'w-full px-2.5 py-1.5 text-sm rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-gold-500';
const labelCls = 'block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1';

function Field({ label, value, onChange, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  return (
    <label className="block">
      <span className={labelCls}>{label}</span>
      <input className={inputCls} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

/** Numeric field that tolerates an empty box while typing. */
function NumField({ label, value, onChange, placeholder }: {
  label?: string; value: number | null; onChange: (v: number | null) => void; placeholder?: string;
}) {
  return (
    <label className="block">
      {label && <span className={labelCls}>{label}</span>}
      <input
        className={inputCls}
        inputMode="decimal"
        value={value ?? ''}
        placeholder={placeholder}
        onChange={(e) => {
          const raw = e.target.value.trim();
          onChange(raw === '' ? null : Number(raw.replace(/,/g, '')));
        }}
      />
    </label>
  );
}

function SmallBtn({ onClick, children, title }: { onClick: () => void; children: React.ReactNode; title?: string }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="inline-flex items-center justify-center w-7 h-7 rounded-md border border-zinc-300 dark:border-zinc-700 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer shrink-0"
    >
      {children}
    </button>
  );
}

function AddBtn({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 cursor-pointer"
    >
      <Plus className="w-3.5 h-3.5" /> {label}
    </button>
  );
}

function StringList({ items, onChange, multiline, addLabel }: {
  items: string[]; onChange: (next: string[]) => void; multiline?: boolean; addLabel: string;
}) {
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  return (
    <div className="space-y-2">
      {items.map((it, i) => (
        <div key={i} className="flex items-start gap-1.5">
          <div className="flex-1">
            {multiline ? (
              <textarea className={`${inputCls} leading-relaxed`} rows={3} value={it}
                onChange={(e) => onChange(items.map((v, idx) => (idx === i ? e.target.value : v)))} />
            ) : (
              <input className={inputCls} value={it}
                onChange={(e) => onChange(items.map((v, idx) => (idx === i ? e.target.value : v)))} />
            )}
          </div>
          <div className="flex flex-col gap-1 pt-0.5">
            <SmallBtn onClick={() => move(i, -1)} title="Move up"><ArrowUp className="w-3.5 h-3.5" /></SmallBtn>
            <SmallBtn onClick={() => move(i, 1)} title="Move down"><ArrowDown className="w-3.5 h-3.5" /></SmallBtn>
            <SmallBtn onClick={() => onChange(items.filter((_, idx) => idx !== i))} title="Remove"><Trash2 className="w-3.5 h-3.5" /></SmallBtn>
          </div>
        </div>
      ))}
      <AddBtn onClick={() => onChange([...items, ''])} label={addLabel} />
    </div>
  );
}

function Card({ title, children, onRemove }: { title: string; children: React.ReactNode; onRemove?: () => void }) {
  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-3 space-y-2.5">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{title}</h4>
        {onRemove && <SmallBtn onClick={onRemove} title="Remove"><Trash2 className="w-3.5 h-3.5" /></SmallBtn>}
      </div>
      {children}
    </div>
  );
}

// ── Body editors ────────────────────────────────────────────────────
function ProfessionalEditor({ body, set }: {
  body: ProfessionalBody;
  set: (mut: (d: FeeScheduleContent) => void) => void;
}) {
  const mutBody = (fn: (b: ProfessionalBody) => void) =>
    set((d) => { if (d.body.kind === 'professional') fn(d.body); });

  return (
    <>
      <label className="block">
        <span className={labelCls}>Lead paragraph</span>
        <textarea className={`${inputCls} leading-relaxed`} rows={3} value={body.intro}
          onChange={(e) => mutBody((b) => { b.intro = e.target.value; })} />
      </label>

      <Card title="1 · Monthly retainer fees">
        <Field label="Heading" value={body.retainer.heading} onChange={(v) => mutBody((b) => { b.retainer.heading = v; })} />
        <div>
          <span className={labelCls}>Paragraphs — wrap text in **double asterisks** for bold</span>
          <StringList items={body.retainer.paragraphs} multiline addLabel="Add paragraph"
            onChange={(next) => mutBody((b) => { b.retainer.paragraphs = next; })} />
        </div>
        <NumField label="Initial fee = this many months of the monthly retainer"
          value={body.retainer.initialFeeMonths}
          onChange={(v) => mutBody((b) => { b.retainer.initialFeeMonths = v ?? 0; })} />
        <div className="space-y-2">
          <span className={labelCls}>Tiers — leave the fee blank for a negotiated tier</span>
          {body.retainer.tiers.map((t, i) => (
            <div key={i} className="flex items-end gap-1.5">
              <div className="grid grid-cols-4 gap-1.5 flex-1">
                <Field label="Tier" value={t.label} onChange={(v) => mutBody((b) => { b.retainer.tiers[i].label = v; })} />
                <NumField label="Hours" value={t.hours} onChange={(v) => mutBody((b) => { b.retainer.tiers[i].hours = v; })} />
                <NumField label="Monthly fee" value={t.monthlyFee} onChange={(v) => mutBody((b) => { b.retainer.tiers[i].monthlyFee = v; })} />
                <NumField label="Discount %" value={t.discountPct} onChange={(v) => mutBody((b) => { b.retainer.tiers[i].discountPct = v; })} />
              </div>
              <SmallBtn onClick={() => mutBody((b) => { b.retainer.tiers.splice(i, 1); })} title="Remove tier">
                <Trash2 className="w-3.5 h-3.5" />
              </SmallBtn>
            </div>
          ))}
          {body.retainer.tiers.some((t) => t.monthlyFee == null) && (
            <Field label="Note shown in place of the figures (negotiated tier)"
              value={body.retainer.tiers.find((t) => t.monthlyFee == null)?.note ?? ''}
              onChange={(v) => mutBody((b) => {
                const t = b.retainer.tiers.find((x) => x.monthlyFee == null);
                if (t) t.note = v;
              })} />
          )}
          <AddBtn label="Add tier" onClick={() => mutBody((b) => {
            b.retainer.tiers.push({ label: '', hours: null, monthlyFee: null, discountPct: null });
          })} />
        </div>
      </Card>

      <Card title="2 · Hourly rates">
        <Field label="Heading" value={body.hourly.heading} onChange={(v) => mutBody((b) => { b.hourly.heading = v; })} />
        <div>
          <span className={labelCls}>Paragraphs</span>
          <StringList items={body.hourly.paragraphs} multiline addLabel="Add paragraph"
            onChange={(next) => mutBody((b) => { b.hourly.paragraphs = next; })} />
        </div>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Only the standard rate is entered — the per-tier columns are calculated from the tier discounts above.
        </p>
        {body.hourly.rates.map((r, i) => (
          <div key={i} className="flex items-end gap-1.5">
            <div className="grid grid-cols-2 gap-1.5 flex-1">
              <Field label={i === 0 ? 'Position' : ''} value={r.position}
                onChange={(v) => mutBody((b) => { b.hourly.rates[i].position = v; })} />
              <NumField label={i === 0 ? 'Standard rate' : ''} value={r.standard}
                onChange={(v) => mutBody((b) => { b.hourly.rates[i].standard = v ?? 0; })} />
            </div>
            <SmallBtn onClick={() => mutBody((b) => { b.hourly.rates.splice(i, 1); })} title="Remove"><Trash2 className="w-3.5 h-3.5" /></SmallBtn>
          </div>
        ))}
        <AddBtn label="Add position" onClick={() => mutBody((b) => { b.hourly.rates.push({ position: '', standard: 0 }); })} />
      </Card>

      <Card title="3 · Acceptance fees">
        <Field label="Heading" value={body.acceptance.heading} onChange={(v) => mutBody((b) => { b.acceptance.heading = v; })} />
        <div>
          <span className={labelCls}>Paragraphs</span>
          <StringList items={body.acceptance.paragraphs} multiline addLabel="Add paragraph"
            onChange={(next) => mutBody((b) => { b.acceptance.paragraphs = next; })} />
        </div>
        {body.acceptance.fees.map((f, i) => (
          <div key={i} className="flex items-end gap-1.5">
            <div className="grid grid-cols-2 gap-1.5 flex-1">
              <Field label={i === 0 ? 'Matter' : ''} value={f.matter}
                onChange={(v) => mutBody((b) => { b.acceptance.fees[i].matter = v; })} />
              <NumField label={i === 0 ? 'Standard fee' : ''} value={f.standard}
                onChange={(v) => mutBody((b) => { b.acceptance.fees[i].standard = v ?? 0; })} />
            </div>
            <SmallBtn onClick={() => mutBody((b) => { b.acceptance.fees.splice(i, 1); })} title="Remove"><Trash2 className="w-3.5 h-3.5" /></SmallBtn>
          </div>
        ))}
        <AddBtn label="Add matter" onClick={() => mutBody((b) => { b.acceptance.fees.push({ matter: '', standard: 0 }); })} />
      </Card>
    </>
  );
}

function TableEditor({ body, set }: {
  body: TableBody;
  set: (mut: (d: FeeScheduleContent) => void) => void;
}) {
  const mutBody = (fn: (b: TableBody) => void) => set((d) => { if (d.body.kind === 'table') fn(d.body); });
  const cols = body.columns.length;

  const moveRow = (gi: number, ri: number, delta: number) => mutBody((b) => {
    const rows = b.groups[gi].rows;
    const j = ri + delta;
    if (j < 0 || j >= rows.length) return;
    [rows[ri], rows[j]] = [rows[j], rows[ri]];
  });

  return (
    <>
      <Card title="Columns">
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Width is proportional — a column with width 2 is twice as wide as one with width 1.
        </p>
        {body.columns.map((c, i) => (
          <div key={i} className="flex items-end gap-1.5">
            <div className="grid grid-cols-3 gap-1.5 flex-1">
              <Field label={i === 0 ? 'Label' : ''} value={c.label}
                onChange={(v) => mutBody((b) => { b.columns[i].label = v; })} />
              <Field label={i === 0 ? 'Second line' : ''} value={c.sublabel ?? ''}
                onChange={(v) => mutBody((b) => { b.columns[i].sublabel = v || undefined; })} />
              <NumField label={i === 0 ? 'Width' : ''} value={c.flex}
                onChange={(v) => mutBody((b) => { b.columns[i].flex = v ?? 1; })} />
            </div>
            <SmallBtn onClick={() => mutBody((b) => {
              b.columns.splice(i, 1);
              for (const g of b.groups) for (const r of g.rows) r.cells.splice(i, 1);
            })} title="Remove column"><Trash2 className="w-3.5 h-3.5" /></SmallBtn>
          </div>
        ))}
        <AddBtn label="Add column" onClick={() => mutBody((b) => {
          b.columns.push({ label: '', flex: 1, align: 'center' });
          for (const g of b.groups) for (const r of g.rows) r.cells.push('');
        })} />
      </Card>

      {body.groups.map((g, gi) => (
        <Card key={gi} title={g.label || `Group ${gi + 1}`} onRemove={() => mutBody((b) => { b.groups.splice(gi, 1); })}>
          <Field label="Group heading (gold band)" value={g.label}
            onChange={(v) => mutBody((b) => { b.groups[gi].label = v; })} />
          <div className="space-y-1.5">
            {g.rows.map((r, ri) => (
              <div key={ri} className="rounded-md border border-zinc-200 dark:border-zinc-800 p-2 space-y-1.5">
                <div className="flex items-center gap-2 text-xs">
                  <label className="inline-flex items-center gap-1 text-zinc-500 cursor-pointer">
                    <input type="checkbox" checked={r.kind === 'subheader'}
                      onChange={(e) => mutBody((b) => { b.groups[gi].rows[ri].kind = e.target.checked ? 'subheader' : 'row'; })} />
                    Sub-heading
                  </label>
                  <label className="inline-flex items-center gap-1 text-zinc-500 cursor-pointer">
                    <input type="checkbox" checked={!!r.indent}
                      onChange={(e) => mutBody((b) => { b.groups[gi].rows[ri].indent = e.target.checked || undefined; })} />
                    Indent
                  </label>
                  <div className="ml-auto flex gap-1">
                    <SmallBtn onClick={() => moveRow(gi, ri, -1)} title="Move up"><ArrowUp className="w-3.5 h-3.5" /></SmallBtn>
                    <SmallBtn onClick={() => moveRow(gi, ri, 1)} title="Move down"><ArrowDown className="w-3.5 h-3.5" /></SmallBtn>
                    <SmallBtn onClick={() => mutBody((b) => { b.groups[gi].rows.splice(ri, 1); })} title="Remove row"><Trash2 className="w-3.5 h-3.5" /></SmallBtn>
                  </div>
                </div>
                <div className="grid gap-1.5" style={{ gridTemplateColumns: `2fr ${'1fr '.repeat(Math.max(0, cols - 1))}` }}>
                  {Array.from({ length: r.kind === 'subheader' ? 1 : cols }).map((_, ci) => (
                    <input key={ci} className={inputCls} value={r.cells[ci] ?? ''}
                      placeholder={body.columns[ci]?.label}
                      onChange={(e) => mutBody((b) => {
                        const cells = b.groups[gi].rows[ri].cells;
                        while (cells.length <= ci) cells.push('');
                        cells[ci] = e.target.value;
                      })} />
                  ))}
                </div>
              </div>
            ))}
            <AddBtn label="Add row" onClick={() => mutBody((b) => {
              const row: FeeRow = { cells: Array.from({ length: cols }, () => '') };
              b.groups[gi].rows.push(row);
            })} />
          </div>
        </Card>
      ))}
      <AddBtn label="Add group" onClick={() => mutBody((b) => { b.groups.push({ label: '', rows: [] }); })} />
    </>
  );
}

// ── Editor shell ────────────────────────────────────────────────────
export default function FeeScheduleEditor({ canEdit }: { canEdit: boolean }) {
  const [schedules, setSchedules] = useState<LoadedFeeSchedule[]>([]);
  const [slug, setSlug] = useState<string | null>(null);
  const [content, setContent] = useState<FeeScheduleContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [tab, setTab] = useState<TabId>('body');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const previewUrlRef = useRef<string | null>(null);

  const set = useCallback((mut: (draft: FeeScheduleContent) => void) => {
    setContent((prev) => {
      if (!prev) return prev;
      const next = structuredClone(prev);
      mut(next);
      return next;
    });
    setDirty(true);
  }, []);

  useEffect(() => {
    fetch('/api/fee-schedule')
      .then((r) => r.json())
      .then((j) => {
        const list: LoadedFeeSchedule[] = j?.schedules ?? [];
        setSchedules(list);
        if (list.length) {
          setSlug(list[0].slug);
          setContent(list[0].content);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const selectSchedule = async (next: string) => {
    if (dirty && !(await confirmAction({ title: 'Discard unsaved changes to this schedule?', confirmLabel: 'Discard', danger: true }))) return;
    const found = schedules.find((s) => s.slug === next);
    if (!found) return;
    setSlug(next);
    setContent(found.content);
    setDirty(false);
    setPreviewUrl(null);
  };

  const refreshPreview = useCallback(async () => {
    if (!content) return;
    setPreviewing(true);
    try {
      const r = await fetch('/api/fee-schedule/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(content),
      });
      if (!r.ok) throw new Error(await failureMessage(r, 'Could not render a preview.'));
      const url = URL.createObjectURL(await r.blob());
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = url;
      setPreviewUrl(url);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setPreviewing(false);
    }
  }, [content]);

  // Build the first preview once a schedule loads or the selection changes.
  useEffect(() => {
    if (content && !previewUrl && !previewing) refreshPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, previewUrl]);

  useEffect(() => () => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
  }, []);

  const save = async () => {
    if (!content) return;
    setSaving(true);
    try {
      const r = await fetch('/api/fee-schedule', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: content.name, content }),
      });
      if (!r.ok) throw new Error(await failureMessage(r, 'Save failed.'));
      setDirty(false);
      // The saved row replaces the starter skeleton for later tab switches.
      setSchedules((prev) => prev.map((s) => (s.slug === content.slug ? { ...s, content, isTemplate: false } : s)));
      toast.success(`${content.name} saved`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const resetToTemplate = async () => {
    if (!slug) return;
    if (!(await confirmAction({ title: 'Reload the blank starter structure?', message: 'Unsaved edits will be lost.', confirmLabel: 'Reload', danger: true }))) return;
    const mod = await import('@/lib/provisioning/seed-pack/fee-schedules');
    const tpl = mod.SEED_FEE_SCHEDULES.find((s) => s.slug === slug)?.content;
    if (!tpl) {
      toast.error('No starter structure exists for this schedule.');
      return;
    }
    setContent(structuredClone(tpl));
    setDirty(true);
    setPreviewUrl(null);
    toast.message('Loaded the starter structure — fill in your rates and Save.');
  };

  if (loading || !content) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-5 h-5 text-zinc-400 animate-spin" />
      </div>
    );
  }

  const active = schedules.find((s) => s.slug === slug);

  return (
    <div className="flex h-full">
      <div className="flex flex-col w-1/2 min-w-[440px] border-r border-zinc-200 dark:border-zinc-800">
        {/* Which schedule is being edited gets its own row — four names plus the
            action buttons crowd each other onto one line. */}
        <div className="flex items-center gap-1 px-3 pt-2.5 pb-1 flex-wrap">
          {schedules.map((s) => (
            <button
              key={s.slug}
              type="button"
              onClick={() => selectSchedule(s.slug)}
              className={`px-2.5 py-1 text-xs rounded-md whitespace-nowrap cursor-pointer ${
                s.slug === slug
                  ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                  : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800'
              }`}
            >
              {s.name.replace(/ Fee Schedule$/, '')}
            </button>
          ))}
        </div>
        <div className="flex items-center justify-between gap-2 px-4 pb-2.5 border-b border-zinc-200 dark:border-zinc-800">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">{content.name}</span>
            {dirty && <span className="text-xs text-amber-600 dark:text-amber-500 shrink-0">• unsaved</span>}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button type="button" onClick={resetToTemplate} title="Load the starter structure"
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-md border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer">
              <RotateCcw className="w-3.5 h-3.5" /> Template
            </button>
            {canEdit && (
              <button type="button" onClick={save} disabled={saving}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-gold-500 text-white hover:bg-gold-600 dark:bg-gold-600 dark:hover:bg-gold-500 cursor-pointer disabled:opacity-50">
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Save
              </button>
            )}
          </div>
        </div>

        {active?.isTemplate && (
          <p className="px-4 py-2 text-xs text-amber-700 dark:text-amber-500 bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-900">
            Showing the blank starter structure — it carries no rates. Fill it in and Save to
            publish it. Until then, proposals and annexes have no schedule to quote.
          </p>
        )}

        <div className="flex items-center gap-1 px-3 py-2 border-b border-zinc-200 dark:border-zinc-800">
          {TABS.map((t) => (
            <button key={t.id} type="button" onClick={() => setTab(t.id)}
              className={`px-2.5 py-1 text-xs rounded-md cursor-pointer ${
                tab === t.id
                  ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                  : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800'
              }`}>
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {tab === 'cover' && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Schedule name (internal)" value={content.name} onChange={(v) => set((d) => { d.name = v; })} />
                <Field label="Year" value={content.year} onChange={(v) => set((d) => { d.year = v; })} />
              </div>
              <Field label="Running header (top right of every page)" value={content.runningTitle}
                onChange={(v) => set((d) => { d.runningTitle = v; })} />
              <Field label="Cover title" value={content.cover.title} onChange={(v) => set((d) => { d.cover.title = v; })} />
              <Field label="Cover subtitle" value={content.cover.subtitle} onChange={(v) => set((d) => { d.cover.subtitle = v; })} />
              <div className="grid grid-cols-2 gap-3">
                <Field label="Edition" value={content.cover.edition} onChange={(v) => set((d) => { d.cover.edition = v; })} />
                <Field label="Confidentiality line" value={content.cover.footnote} onChange={(v) => set((d) => { d.cover.footnote = v; })} />
              </div>
              <div>
                <span className={labelCls}>Address lines</span>
                <StringList items={content.cover.addressLines} addLabel="Add line"
                  onChange={(next) => set((d) => { d.cover.addressLines = next; })} />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <Field label="Email" value={content.cover.email} onChange={(v) => set((d) => { d.cover.email = v; })} />
                <Field label="Website" value={content.cover.website} onChange={(v) => set((d) => { d.cover.website = v; })} />
                <Field label="Phone" value={content.cover.phone} onChange={(v) => set((d) => { d.cover.phone = v; })} />
              </div>
            </>
          )}

          {tab === 'body' && (
            content.body.kind === 'professional'
              ? <ProfessionalEditor body={content.body} set={set} />
              : <TableEditor body={content.body} set={set} />
          )}

          {tab === 'notes' && (
            <>
              <Field label="Notes heading" value={content.notesHeading} onChange={(v) => set((d) => { d.notesHeading = v; })} />
              {content.notes.map((n, i) => (
                <Card key={i} title={n.label || `Note ${i + 1}`} onRemove={() => set((d) => { d.notes.splice(i, 1); })}>
                  <Field label="Bold lead-in" value={n.label} onChange={(v) => set((d) => { d.notes[i].label = v; })} />
                  <label className="block">
                    <span className={labelCls}>Text</span>
                    <textarea className={`${inputCls} leading-relaxed`} rows={3} value={n.text}
                      onChange={(e) => set((d) => { d.notes[i].text = e.target.value; })} />
                  </label>
                </Card>
              ))}
              <AddBtn label="Add note" onClick={() => set((d) => { d.notes.push({ label: '', text: '' }); })} />
              <div>
                <span className={labelCls}>Closing italic lines</span>
                <StringList items={content.footnotes} multiline addLabel="Add line"
                  onChange={(next) => set((d) => { d.footnotes = next; })} />
              </div>
            </>
          )}
        </div>
      </div>

      <div className="flex flex-col flex-1 min-w-0">
        <div className="flex items-center justify-end gap-1.5 px-4 py-2.5 border-b border-zinc-200 dark:border-zinc-800">
          <button type="button" onClick={refreshPreview} disabled={previewing}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-md border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer disabled:opacity-50">
            {previewing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} Preview
          </button>
          <button type="button" onClick={() => window.open(`/api/fee-schedule/export?slug=${encodeURIComponent(content.slug)}`, '_blank')}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-md border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer">
            <Download className="w-3.5 h-3.5" /> Download saved
          </button>
        </div>
        <div className="flex-1 bg-zinc-100 dark:bg-zinc-900">
          {previewUrl ? (
            <iframe src={previewUrl} title="Fee schedule preview" className="w-full h-full border-0" />
          ) : (
            <div className="flex items-center justify-center h-full text-sm text-zinc-400">
              {previewing ? 'Rendering…' : 'Preview will appear here'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
