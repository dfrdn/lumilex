'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import useSWR from 'swr';
import { toast } from 'sonner';
import {
  Loader2,
  Plus,
  Trash2,
  Download,
  RefreshCw,
  Save,
  RotateCcw,
  ArrowUp,
  ArrowDown,
  ImagePlus,
  X,
} from 'lucide-react';
import type {
  FirmProfileContent,
  TeamGroup,
  TeamMember,
} from '@/lib/firm-profile/types';
import HeadshotCropper from './HeadshotCropper';
import { confirmAction } from '@/components/ui/confirm';

const TABS = [
  { id: 'cover', label: 'Cover' },
  { id: 'about', label: 'About' },
  { id: 'practiceAreas', label: 'Practice Areas' },
  { id: 'team', label: 'Team' },
  { id: 'glance', label: 'At a Glance' },
  { id: 'contact', label: 'Contact' },
] as const;
type TabId = (typeof TABS)[number]['id'];

// ── Small styled primitives ─────────────────────────────────────────
const inputCls =
  'w-full px-2.5 py-1.5 text-sm rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-gold-500';
const labelCls = 'block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1';

function Field({ label, value, onChange, placeholder }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className={labelCls}>{label}</span>
      <input className={inputCls} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function TextArea({ label, value, onChange, rows = 4 }: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
}) {
  return (
    <label className="block">
      {label && <span className={labelCls}>{label}</span>}
      <textarea className={`${inputCls} leading-relaxed`} rows={rows} value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mt-2">{children}</h3>;
}

function SmallBtn({ onClick, children, title }: { onClick: () => void; children: React.ReactNode; title?: string }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="inline-flex items-center justify-center w-7 h-7 rounded-md border border-zinc-300 dark:border-zinc-700 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
    >
      {children}
    </button>
  );
}

// Editor for an ordered list of plain strings (paragraphs, tags, lines…).
function StringList({ items, onChange, multiline, addLabel }: {
  items: string[];
  onChange: (next: string[]) => void;
  multiline?: boolean;
  addLabel: string;
}) {
  const upd = (i: number, v: string) => onChange(items.map((it, idx) => (idx === i ? v : it)));
  const remove = (i: number) => onChange(items.filter((_, idx) => idx !== i));
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
              <textarea className={`${inputCls} leading-relaxed`} rows={3} value={it} onChange={(e) => upd(i, e.target.value)} />
            ) : (
              <input className={inputCls} value={it} onChange={(e) => upd(i, e.target.value)} />
            )}
          </div>
          <div className="flex flex-col gap-1 pt-0.5">
            <SmallBtn onClick={() => move(i, -1)} title="Move up"><ArrowUp className="w-3.5 h-3.5" /></SmallBtn>
            <SmallBtn onClick={() => move(i, 1)} title="Move down"><ArrowDown className="w-3.5 h-3.5" /></SmallBtn>
            <SmallBtn onClick={() => remove(i)} title="Remove"><Trash2 className="w-3.5 h-3.5" /></SmallBtn>
          </div>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...items, ''])}
        className="inline-flex items-center gap-1.5 text-sm text-gold-600 dark:text-gold-500 hover:underline cursor-pointer"
      >
        <Plus className="w-3.5 h-3.5" /> {addLabel}
      </button>
    </div>
  );
}

// A stale session redirects the POST to the HTML login page, and an oversized
// body gets a plain-text 413 — both make res.json() throw a browser-specific
// parse error that ends up in the toast.
async function readJson(res: Response): Promise<{ url?: string; error?: string } | null> {
  const text = await res.text();
  try {
    return JSON.parse(text) as { url?: string; error?: string };
  } catch {
    return null;
  }
}

function PhotoField({ value, slug, name, onChange }: { value?: string; slug: string; name: string; onChange: (url: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<File | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  const upload = async (photo: File) => {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', photo);
      fd.append('slug', slug);
      const r = await fetch('/api/firm-profile/photo', { method: 'POST', body: fd });
      const j = await readJson(r);
      if (!r.ok) {
        throw new Error(
          j?.error ??
            (r.status === 413
              ? 'Photo is too large to upload.'
              : `Upload failed (${r.status}). Reload the page and sign in again if this repeats.`),
        );
      }
      if (!j?.url) throw new Error('Upload failed — reload the page and sign in again, then try once more.');
      onChange(j.url);
      toast.success('Photo uploaded');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex items-center gap-2">
      <div className="w-12 h-14 rounded border border-zinc-300 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 overflow-hidden shrink-0 flex items-center justify-center">
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={value} alt="" className="w-full h-full object-cover" />
        ) : (
          <ImagePlus className="w-4 h-4 text-zinc-400" />
        )}
      </div>
      <input ref={ref} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={(e) => {
        const f = e.target.files?.[0];
        if (f) setPicked(f);
        e.target.value = '';
      }} />
      <button type="button" onClick={() => ref.current?.click()} disabled={busy} className="text-xs px-2 py-1 rounded border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer disabled:opacity-50">
        {busy ? 'Uploading…' : value ? 'Replace' : 'Upload photo'}
      </button>
      {value && (
        <button type="button" onClick={() => onChange('')} className="text-xs text-zinc-500 hover:text-red-500 cursor-pointer">
          Remove
        </button>
      )}
      {picked && (
        <HeadshotCropper
          file={picked}
          name={name}
          onCancel={() => setPicked(null)}
          onCropped={(cropped) => {
            setPicked(null);
            upload(cropped);
          }}
        />
      )}
    </div>
  );
}

export default function FirmProfileEditor() {
  const [content, setContent] = useState<FirmProfileContent | null>(null);
  const [name, setName] = useState('Firm Profile');
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [tab, setTab] = useState<TabId>('cover');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const previewUrlRef = useRef<string | null>(null);

  // structuredClone-based immutable updates.
  const set = useCallback((mut: (draft: FirmProfileContent) => void) => {
    setContent((prev) => {
      if (!prev) return prev;
      const next = structuredClone(prev);
      mut(next);
      return next;
    });
    setDirty(true);
  }, []);

  // A cached copy opens the editor at once; it is read once into the draft and
  // not refreshed under someone's edits.
  type ProfileResponse = { profile?: { content?: FirmProfileContent; name?: string } };
  const { data: loaded, error: loadError, mutate } = useSWR<ProfileResponse>('/api/firm-profile', {
    revalidateOnFocus: false,
  });
  const [seeded, setSeeded] = useState(false);
  if (loaded && !seeded) {
    setSeeded(true);
    if (loaded.profile?.content) {
      setContent(loaded.profile.content);
      setName(loaded.profile.name ?? 'Firm Profile');
    }
  }
  const loading = !seeded && !loadError;

  const refreshPreview = useCallback(async () => {
    if (!content) return;
    setPreviewing(true);
    try {
      const r = await fetch('/api/firm-profile/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(content),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error ?? `Export failed (${r.status})`);
      }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = url;
      setPreviewUrl(url);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setPreviewing(false);
    }
  }, [content]);

  // Build the first preview once content loads.
  useEffect(() => {
    if (content && !previewUrl && !previewing) refreshPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content]);

  useEffect(() => () => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
  }, []);

  const save = async () => {
    if (!content) return;
    setSaving(true);
    try {
      const r = await fetch('/api/firm-profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, content }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? 'Save failed');
      setDirty(false);
      mutate((d) => ({ ...d, profile: { ...d?.profile, name, content } }), { revalidate: false });
      toast.success('Firm profile saved');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const resetToTemplate = async () => {
    if (!(await confirmAction({ title: 'Discard current content and reload the blank starter template?', message: 'Unsaved edits will be lost.', confirmLabel: 'Discard', danger: true }))) return;
    const mod = await import('@/lib/firm-profile/default');
    setContent(structuredClone(mod.DEFAULT_FIRM_PROFILE));
    setDirty(true);
    toast.message('Loaded the blank starter template — fill it in and Save.');
  };

  const download = () => {
    window.open('/api/firm-profile/export', '_blank');
  };

  if (loading || !content) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-5 h-5 text-zinc-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex h-full">
      {/* Editor pane */}
      <div className="flex flex-col w-1/2 min-w-[420px] border-r border-zinc-200 dark:border-zinc-800">
        {/* Toolbar */}
        <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-zinc-200 dark:border-zinc-800">
          <div className="flex items-center gap-2 min-w-0">
            <input
              className="px-2 py-1 text-sm font-medium rounded-md border border-transparent hover:border-zinc-300 dark:hover:border-zinc-700 bg-transparent text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-gold-500 w-44"
              value={name}
              onChange={(e) => { setName(e.target.value); setDirty(true); }}
            />
            {dirty && <span className="text-xs text-amber-600 dark:text-amber-500">• unsaved</span>}
          </div>
          <div className="flex items-center gap-1.5">
            <button type="button" onClick={resetToTemplate} title="Load the blank starter template" className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-md border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer">
              <RotateCcw className="w-3.5 h-3.5" /> Template
            </button>
            <button type="button" onClick={save} disabled={saving} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-gold-500 text-white hover:bg-gold-600 dark:bg-gold-600 dark:hover:bg-gold-500 cursor-pointer disabled:opacity-50">
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Save
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 px-3 py-2 border-b border-zinc-200 dark:border-zinc-800 overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`px-2.5 py-1 text-xs rounded-md whitespace-nowrap cursor-pointer ${
                tab === t.id
                  ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                  : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Form body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {tab === 'cover' && (
            <>
              <Field label="Firm name (wordmark)" value={content.cover.firmName} onChange={(v) => set((d) => { d.cover.firmName = v; })} />
              <Field label="Full name (small caps under wordmark)" value={content.cover.fullName} onChange={(v) => set((d) => { d.cover.fullName = v; })} />
              <div className="grid grid-cols-2 gap-3">
                <Field label="Year" value={content.cover.year} onChange={(v) => set((d) => { d.cover.year = v; })} />
                <Field label="Subtitle" value={content.cover.subtitle} onChange={(v) => set((d) => { d.cover.subtitle = v; })} />
              </div>
              <div>
                <span className={labelCls}>Practice tags (cover footer)</span>
                <StringList items={content.cover.practiceTags} addLabel="Add tag" onChange={(next) => set((d) => { d.cover.practiceTags = next; })} />
              </div>
            </>
          )}

          {tab === 'about' && (
            <>
              <Field label="Heading" value={content.about.heading} onChange={(v) => set((d) => { d.about.heading = v; })} />
              <Field label="Tagline (gold italic)" value={content.about.tagline} onChange={(v) => set((d) => { d.about.tagline = v; })} />
              <div>
                <span className={labelCls}>Paragraphs</span>
                <StringList multiline items={content.about.paragraphs} addLabel="Add paragraph" onChange={(next) => set((d) => { d.about.paragraphs = next; })} />
              </div>
            </>
          )}

          {tab === 'practiceAreas' && (
            <>
              <Field label="Heading" value={content.practiceAreas.heading} onChange={(v) => set((d) => { d.practiceAreas.heading = v; })} />
              <div className="space-y-3">
                {content.practiceAreas.items.map((it, i) => (
                  <div key={i} className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-3 space-y-2">
                    <div className="flex items-center gap-1.5">
                      <input className={`${inputCls} font-medium`} value={it.title} placeholder="Practice area title" onChange={(e) => set((d) => { d.practiceAreas.items[i].title = e.target.value; })} />
                      <SmallBtn onClick={() => set((d) => { d.practiceAreas.items.splice(i, 1); })} title="Remove"><Trash2 className="w-3.5 h-3.5" /></SmallBtn>
                    </div>
                    <TextArea value={it.description} rows={3} onChange={(v) => set((d) => { d.practiceAreas.items[i].description = v; })} />
                  </div>
                ))}
                <button type="button" onClick={() => set((d) => { d.practiceAreas.items.push({ title: '', description: '' }); })} className="inline-flex items-center gap-1.5 text-sm text-gold-600 dark:text-gold-500 hover:underline cursor-pointer">
                  <Plus className="w-3.5 h-3.5" /> Add practice area
                </button>
              </div>
            </>
          )}

          {tab === 'team' && (
            <TeamTab content={content} set={set} />
          )}

          {tab === 'glance' && (
            <>
              <Field label="Heading" value={content.glance.heading} onChange={(v) => set((d) => { d.glance.heading = v; })} />
              <SectionTitle>Stats</SectionTitle>
              <div className="space-y-2">
                {content.glance.stats.map((s, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <input className={`${inputCls} w-24`} value={s.value} placeholder="177+" onChange={(e) => set((d) => { d.glance.stats[i].value = e.target.value; })} />
                    <input className={inputCls} value={s.label} placeholder="Clients Served" onChange={(e) => set((d) => { d.glance.stats[i].label = e.target.value; })} />
                    <SmallBtn onClick={() => set((d) => { d.glance.stats.splice(i, 1); })} title="Remove"><Trash2 className="w-3.5 h-3.5" /></SmallBtn>
                  </div>
                ))}
                <button type="button" onClick={() => set((d) => { d.glance.stats.push({ value: '', label: '' }); })} className="inline-flex items-center gap-1.5 text-sm text-gold-600 dark:text-gold-500 hover:underline cursor-pointer">
                  <Plus className="w-3.5 h-3.5" /> Add stat
                </button>
              </div>
              <Field label="Affiliations heading" value={content.glance.affiliationsLabel} onChange={(v) => set((d) => { d.glance.affiliationsLabel = v; })} />
              <div>
                <span className={labelCls}>Affiliations</span>
                <StringList items={content.glance.affiliations} addLabel="Add affiliation" onChange={(next) => set((d) => { d.glance.affiliations = next; })} />
              </div>
            </>
          )}

          {tab === 'contact' && (
            <>
              <Field label="Heading" value={content.contact.heading} onChange={(v) => set((d) => { d.contact.heading = v; })} />
              <Field label="Office label" value={content.contact.officeLabel} onChange={(v) => set((d) => { d.contact.officeLabel = v; })} />
              <div>
                <span className={labelCls}>Address lines</span>
                <StringList items={content.contact.addressLines} addLabel="Add address line" onChange={(next) => set((d) => { d.contact.addressLines = next; })} />
              </div>
              <div className="grid grid-cols-1 gap-3">
                <Field label="Phone" value={content.contact.phone} onChange={(v) => set((d) => { d.contact.phone = v; })} />
                <Field label="Email" value={content.contact.email} onChange={(v) => set((d) => { d.contact.email = v; })} />
                <Field label="Website" value={content.contact.website} onChange={(v) => set((d) => { d.contact.website = v; })} />
              </div>
            </>
          )}
        </div>
      </div>

      {/* Preview pane */}
      <div className="flex flex-col flex-1 bg-zinc-100 dark:bg-zinc-950">
        <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
          <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">PDF preview</span>
          <div className="flex items-center gap-1.5">
            <button type="button" onClick={refreshPreview} disabled={previewing} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-md border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer disabled:opacity-50">
              {previewing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} Update preview
            </button>
            <button type="button" onClick={download} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 hover:opacity-90 cursor-pointer">
              <Download className="w-3.5 h-3.5" /> Download
            </button>
          </div>
        </div>
        <div className="flex-1 relative">
          {previewUrl ? (
            <iframe key={previewUrl} src={previewUrl} className="absolute inset-0 w-full h-full" title="Firm profile preview" />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-zinc-400">
              {previewing ? 'Rendering…' : 'Preview will appear here'}
            </div>
          )}
        </div>
        <p className="px-4 py-2 text-[11px] text-zinc-400 border-t border-zinc-200 dark:border-zinc-800">
          The Download button exports the last <em>saved</em> profile. Use “Update preview” to render current edits, then Save to persist.
        </p>
      </div>
    </div>
  );
}

// ── Team tab (groups of members + support team) ─────────────────────
function TeamTab({ content, set }: { content: FirmProfileContent; set: (mut: (d: FirmProfileContent) => void) => void }) {
  const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'member';
  const blankMember = (): TeamMember => ({ name: '', title: '', bio: '', photoUrl: '' });
  const blankGroup = (): TeamGroup => ({ label: 'NEW GROUP', layout: 'list', members: [blankMember()] });

  return (
    <div className="space-y-4">
      <Field label="Section heading" value={content.team.heading} onChange={(v) => set((d) => { d.team.heading = v; })} />

      {content.team.groups.map((g, gi) => (
        <div key={gi} className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-3 space-y-3">
          <div className="flex items-center gap-1.5">
            <input className={`${inputCls} font-semibold`} value={g.label} placeholder="GROUP LABEL" onChange={(e) => set((d) => { d.team.groups[gi].label = e.target.value; })} />
            <div className="flex rounded-md border border-zinc-300 dark:border-zinc-700 overflow-hidden text-xs shrink-0">
              {(['list', 'grid'] as const).map((lay) => (
                <button
                  key={lay}
                  type="button"
                  onClick={() => set((d) => { d.team.groups[gi].layout = lay; })}
                  className={`px-2 py-1.5 cursor-pointer ${g.layout === lay ? 'bg-gold-500 text-white' : 'text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}
                >
                  {lay === 'list' ? 'List + bio' : 'Photo grid'}
                </button>
              ))}
            </div>
            <SmallBtn onClick={() => set((d) => { d.team.groups.splice(gi, 1); })} title="Remove group"><Trash2 className="w-3.5 h-3.5" /></SmallBtn>
          </div>

          {g.members.map((m, mi) => (
            <div key={mi} className="rounded-md bg-zinc-50 dark:bg-zinc-900/60 border border-zinc-200 dark:border-zinc-800 p-2.5 space-y-2">
              <div className="flex items-center gap-1.5">
                <input className={`${inputCls} font-medium`} value={m.name} placeholder="Full name" onChange={(e) => set((d) => { d.team.groups[gi].members[mi].name = e.target.value; })} />
                <button type="button" onClick={() => set((d) => { d.team.groups[gi].members.splice(mi, 1); })} className="text-zinc-400 hover:text-red-500 cursor-pointer"><X className="w-4 h-4" /></button>
              </div>
              <input className={inputCls} value={m.title} placeholder="Title (e.g. Founding Partner)" onChange={(e) => set((d) => { d.team.groups[gi].members[mi].title = e.target.value; })} />
              {g.layout === 'list' && (
                <TextArea value={m.bio ?? ''} rows={3} onChange={(v) => set((d) => { d.team.groups[gi].members[mi].bio = v; })} />
              )}
              <PhotoField value={m.photoUrl} slug={slugify(m.name)} name={m.name} onChange={(url) => set((d) => { d.team.groups[gi].members[mi].photoUrl = url; })} />
            </div>
          ))}
          <button type="button" onClick={() => set((d) => { d.team.groups[gi].members.push(blankMember()); })} className="inline-flex items-center gap-1.5 text-xs text-gold-600 dark:text-gold-500 hover:underline cursor-pointer">
            <Plus className="w-3.5 h-3.5" /> Add member
          </button>
        </div>
      ))}
      <button type="button" onClick={() => set((d) => { d.team.groups.push(blankGroup()); })} className="inline-flex items-center gap-1.5 text-sm text-gold-600 dark:text-gold-500 hover:underline cursor-pointer">
        <Plus className="w-3.5 h-3.5" /> Add group
      </button>

      <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-3 space-y-2">
        <Field label="Support team heading" value={content.team.supportLabel} onChange={(v) => set((d) => { d.team.supportLabel = v; })} />
        {content.team.support.map((s, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <input className={inputCls} value={s.name} placeholder="Name" onChange={(e) => set((d) => { d.team.support[i].name = e.target.value; })} />
            <input className={inputCls} value={s.role} placeholder="Role" onChange={(e) => set((d) => { d.team.support[i].role = e.target.value; })} />
            <SmallBtn onClick={() => set((d) => { d.team.support.splice(i, 1); })} title="Remove"><Trash2 className="w-3.5 h-3.5" /></SmallBtn>
          </div>
        ))}
        <button type="button" onClick={() => set((d) => { d.team.support.push({ name: '', role: '' }); })} className="inline-flex items-center gap-1.5 text-xs text-gold-600 dark:text-gold-500 hover:underline cursor-pointer">
          <Plus className="w-3.5 h-3.5" /> Add support member
        </button>
      </div>
    </div>
  );
}
