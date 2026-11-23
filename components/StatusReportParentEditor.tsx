'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { toast } from 'sonner';
import { Check, File as FileIcon, FolderOpen, Gavel, Loader2, Pencil, Search, X } from 'lucide-react';
import { formatManila } from '@/lib/dates';

type ParentKind = 'hearing' | 'filing' | 'file' | null;

interface Props {
  statusReportId: string;
  matterId: string | null;
  parentKind: ParentKind;
  parentId: string | null;
  parentName: string | null;
  onSaved?: () => void;
}

interface Option {
  kind: 'hearing' | 'filing' | 'file';
  id: string;
  name: string;
  subtitle?: string;
}

const POPOVER_WIDTH = 320;
const POPOVER_MAX_HEIGHT = 380;

export default function StatusReportParentEditor({
  statusReportId,
  matterId,
  parentKind: initialKind,
  parentId: initialId,
  parentName: initialName,
  onSaved,
}: Props) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<Option[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);

  const [parentKind, setParentKind] = useState<ParentKind>(initialKind);
  const [parentId, setParentId] = useState<string | null>(initialId);
  const [parentName, setParentName] = useState<string | null>(initialName);

  useEffect(() => { setParentKind(initialKind); }, [initialKind]);
  useEffect(() => { setParentId(initialId); }, [initialId]);
  useEffect(() => { setParentName(initialName); }, [initialName]);

  useEffect(() => { setMounted(true); }, []);

  const anchorRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open || !anchorRef.current) return;
    function place() {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const viewH = window.innerHeight;
      const viewW = window.innerWidth;
      const spaceBelow = viewH - rect.bottom;
      const top = spaceBelow > POPOVER_MAX_HEIGHT
        ? rect.bottom + 4
        : Math.max(8, rect.top - POPOVER_MAX_HEIGHT - 4);
      const left = Math.max(8, Math.min(rect.left, viewW - POPOVER_WIDTH - 8));
      setPosition({ top, left });
    }
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      const t = e.target as Node;
      if (popoverRef.current?.contains(t)) return;
      if (anchorRef.current?.contains(t)) return;
      setOpen(false);
    }
    document.addEventListener('mousedown', handleClick, true);
    return () => document.removeEventListener('mousedown', handleClick, true);
  }, [open]);

  useEffect(() => {
    if (!open || !matterId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/status-report/parent-options?matterId=${encodeURIComponent(matterId)}&excludeId=${encodeURIComponent(statusReportId)}`)
      .then((r) => r.json())
      .then((data: {
        hearings?: { id: string; name: string; date?: string | null }[];
        deliverables?: { id: string; name: string; type?: string; date?: string | null }[];
        files?: { id: string; name: string; origin?: string; date?: string | null }[];
      }) => {
        if (cancelled) return;
        const opts: Option[] = [];
        for (const h of data.hearings ?? []) {
          opts.push({
            kind: 'hearing',
            id: h.id,
            name: h.name,
            subtitle: h.date ? formatManila(h.date) : undefined,
          });
        }
        for (const d of data.deliverables ?? []) {
          opts.push({
            kind: 'filing',
            id: d.id,
            name: d.name,
            subtitle: d.type || undefined,
          });
        }
        for (const f of data.files ?? []) {
          const parts = [f.origin, f.date ? new Date(f.date).toLocaleDateString() : null].filter(Boolean);
          opts.push({
            kind: 'file',
            id: f.id,
            name: f.name,
            subtitle: parts.length ? parts.join(' · ') : undefined,
          });
        }
        setOptions(opts);
      })
      .catch(() => {
        if (!cancelled) setError('Failed to load options');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, matterId, statusReportId]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  const filtered = useMemo(() => {
    if (!query) return options;
    const q = query.toLowerCase();
    return options.filter((o) => o.name.toLowerCase().includes(q));
  }, [options, query]);

  async function save(kind: ParentKind, newId: string | null, newName: string | null) {
    const previous = { kind: parentKind, id: parentId, name: parentName };
    setSaving(true);
    setError(null);
    setParentKind(kind);
    setParentId(newId);
    setParentName(newName);
    setOpen(false);
    setQuery('');
    try {
      const res = await fetch('/api/status-report/parent', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ statusReportId, kind, parentId: newId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Update failed');
      }
      onSaved?.();
    } catch (e) {
      setParentKind(previous.kind);
      setParentId(previous.id);
      setParentName(previous.name);
      toast.error(e instanceof Error ? e.message : 'Update failed');
    } finally {
      setSaving(false);
    }
  }

  const href =
    parentKind === 'hearing' && parentId
      ? `/dashboard/hearings/${parentId}`
      : parentKind === 'filing' && parentId
        ? `/dashboard/deliverables/${parentId}`
        : parentKind === 'file' && parentId
          ? `/dashboard/files/${parentId}`
          : null;
  const Icon = parentKind === 'hearing' ? Gavel : parentKind === 'file' ? FileIcon : FolderOpen;

  return (
    <div className="inline-block" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center gap-1 group">
        {href && parentName ? (
          <Link
            href={href}
            className="inline-flex items-center gap-1.5 text-xs text-stone-600 hover:text-stone-900 dark:text-stone-300 dark:hover:text-stone-100 hover:underline max-w-[180px]"
          >
            <Icon className="w-3.5 h-3.5 text-stone-400 dark:text-stone-500 shrink-0" />
            <span className="truncate">{parentName}</span>
          </Link>
        ) : (
          <span className="text-stone-400 dark:text-stone-500 text-xs">—</span>
        )}
        <button
          ref={anchorRef}
          type="button"
          onClick={() => setOpen((v) => !v)}
          disabled={!matterId}
          title={matterId ? 'Change parent' : 'No matter assigned'}
          className="p-1 rounded text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 hover:bg-stone-100 dark:hover:bg-stone-800 opacity-0 group-hover:opacity-100 focus:opacity-100 transition cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Pencil className="w-3 h-3" />
        </button>
      </div>

      {mounted && open && position && createPortal(
        <div
          ref={popoverRef}
          style={{ position: 'fixed', top: position.top, left: position.left, width: POPOVER_WIDTH }}
          className="bg-card rounded-xl shadow-[var(--shadow-elevated)] border border-[var(--border-color)] z-[1000] overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border-color)]">
            <Search className="w-3.5 h-3.5 text-[var(--text-muted)] shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search hearings & deliverables..."
              className="flex-1 bg-transparent text-sm text-foreground placeholder:text-[var(--text-muted)] outline-none min-w-0"
              autoComplete="off"
            />
            {query && (
              <button
                type="button"
                onClick={() => { setQuery(''); inputRef.current?.focus(); }}
                className="p-0.5 rounded text-[var(--text-muted)] hover:text-foreground"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="max-h-[280px] overflow-y-auto overscroll-contain py-1">
            <button
              type="button"
              onClick={() => save(null, null, null)}
              disabled={saving}
              className="w-full text-left flex items-center gap-2 px-3 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--subtle-bg)] hover:text-foreground transition cursor-pointer disabled:opacity-50"
            >
              <Check className={`w-3.5 h-3.5 shrink-0 ${!parentKind ? 'text-gold-500 dark:text-gold-400' : 'invisible'}`} />
              <span className="italic text-[var(--text-muted)]">No parent</span>
            </button>

            {loading && (
              <div className="px-3 py-6 flex items-center justify-center text-[var(--text-muted)]">
                <Loader2 className="w-4 h-4 animate-spin" />
              </div>
            )}

            {!loading && filtered.length === 0 && (
              <div className="px-3 py-6 text-center text-sm text-[var(--text-muted)]">
                {options.length === 0 ? 'No hearings or deliverables in this matter' : 'No matches'}
              </div>
            )}

            {!loading && filtered.map((opt) => {
              const selected = opt.kind === parentKind && opt.id === parentId;
              const OptIcon = opt.kind === 'hearing' ? Gavel : opt.kind === 'file' ? FileIcon : FolderOpen;
              return (
                <button
                  key={`${opt.kind}-${opt.id}`}
                  type="button"
                  onClick={() => save(opt.kind, opt.id, opt.name)}
                  disabled={saving}
                  className={`w-full text-left flex items-start gap-2 px-3 py-2 text-sm transition cursor-pointer disabled:opacity-50 ${
                    selected
                      ? 'bg-[var(--subtle-bg)] text-foreground'
                      : 'text-[var(--text-secondary)] hover:bg-[var(--subtle-bg)] hover:text-foreground'
                  }`}
                >
                  <Check className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${selected ? 'text-gold-500 dark:text-gold-400' : 'invisible'}`} />
                  <OptIcon className="w-3.5 h-3.5 text-stone-400 dark:text-stone-500 shrink-0 mt-0.5" />
                  <span className="flex-1 min-w-0">
                    <span className="block truncate">{opt.name || '(Untitled)'}</span>
                    {opt.subtitle && (
                      <span className="block text-[10px] text-[var(--text-muted)] truncate">{opt.subtitle}</span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>

          {error && (
            <div className="px-3 py-2 text-xs text-red-600 dark:text-red-400 border-t border-[var(--border-color)] bg-red-50/50 dark:bg-red-500/5">
              {error}
            </div>
          )}
          <div className="flex items-center justify-between px-3 py-1.5 border-t border-[var(--border-color)] bg-[var(--subtle-bg)]">
            <span className="text-[10px] text-[var(--text-muted)]">Same matter only</span>
            {saving && <Loader2 className="w-3 h-3 animate-spin text-[var(--text-muted)]" />}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
