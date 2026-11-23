'use client';

import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  Upload,
  Loader2,
  Check,
  FileText,
  Trash2,
  ChevronDown,
  AlertCircle,
} from 'lucide-react';

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

interface MatterOption {
  notion_id: string;
  name: string;
  matter_code?: string | null;
  case_title?: string | null;
}

interface PendingFile {
  file: File;
  status: 'pending' | 'uploading' | 'uploaded' | 'failed';
  error?: string;
}

function deriveRowName(originalName: string): string {
  const stem = originalName.replace(/\.[^./\\]+$/, '') || originalName;
  return stem.replace(/_+/g, ' ').replace(/\s+/g, ' ').trim() || 'Untitled';
}

export default function BulkFilesUploadModal({ open, onClose, onSuccess }: Props) {
  const [matters, setMatters] = useState<MatterOption[]>([]);
  const [mattersLoading, setMattersLoading] = useState(false);
  const [selectedMatterId, setSelectedMatterId] = useState<string>('');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [matterSearch, setMatterSearch] = useState('');

  const [files, setFiles] = useState<PendingFile[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Reset on open
  useEffect(() => {
    if (!open) return;
    setSelectedMatterId('');
    setMatterSearch('');
    setFiles([]);
    setError(null);
    setDone(false);
    setDropdownOpen(false);
  }, [open]);

  // Load matters when modal opens (cached afterwards)
  useEffect(() => {
    if (!open || matters.length > 0 || mattersLoading) return;
    setMattersLoading(true);
    fetch('/api/admin/matters?pageSize=500&sortBy=name&sortDir=asc')
      .then((r) => r.json())
      .then((data) => {
        setMatters(Array.isArray(data?.data) ? data.data : []);
      })
      .catch((err) => {
        console.error('[bulk-upload] failed to load matters', err);
        setError('Failed to load matters. Refresh and try again.');
      })
      .finally(() => setMattersLoading(false));
  }, [open, matters.length, mattersLoading]);

  // Click-outside closes dropdown
  useEffect(() => {
    if (!dropdownOpen) return;
    const onClick = (e: MouseEvent) => {
      if (!dropdownRef.current?.contains(e.target as Node)) setDropdownOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [dropdownOpen]);

  const selectedMatter = useMemo(
    () => matters.find((m) => m.notion_id === selectedMatterId) ?? null,
    [matters, selectedMatterId],
  );

  const filteredMatters = useMemo(() => {
    const q = matterSearch.trim().toLowerCase();
    if (!q) return matters;
    return matters.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        (m.case_title ?? '').toLowerCase().includes(q) ||
        (m.matter_code ?? '').toLowerCase().includes(q),
    );
  }, [matters, matterSearch]);

  const addFiles = useCallback((picked: FileList | File[]) => {
    const arr = Array.from(picked);
    if (arr.length === 0) return;
    setFiles((prev) => {
      // Dedupe by name+size (within this batch only)
      const seen = new Set(prev.map((p) => `${p.file.name}::${p.file.size}`));
      const additions: PendingFile[] = [];
      for (const f of arr) {
        const key = `${f.name}::${f.size}`;
        if (seen.has(key)) continue;
        seen.add(key);
        additions.push({ file: f, status: 'pending' });
      }
      const next = [...prev, ...additions];
      if (next.length > 50) {
        setError('Max 50 files per batch — extras were dropped.');
        return next.slice(0, 50);
      }
      setError(null);
      return next;
    });
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      if (e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files);
    },
    [addFiles],
  );

  const removeFile = useCallback((index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const canUpload = !!selectedMatterId && files.length > 0 && !uploading;

  const startUpload = useCallback(async () => {
    if (!canUpload) return;
    setUploading(true);
    setError(null);
    setDone(false);

    try {
      // Phase 1: signed upload URLs
      const phase1 = await fetch('/api/admin/file-bulk-create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          matterId: selectedMatterId,
          files: files.map((p) => ({ name: p.file.name, type: p.file.type })),
        }),
      });
      if (!phase1.ok) {
        const data = await phase1.json().catch(() => ({}));
        throw new Error(data?.error || 'Failed to prepare uploads');
      }
      const { uploads } = (await phase1.json()) as {
        uploads: {
          notionId: string;
          name: string;
          storagePath: string;
          signedUrl: string;
          token: string;
        }[];
      };

      // Phase 2: PUT each file in parallel, tracking per-file status
      setFiles((prev) => prev.map((p) => ({ ...p, status: 'uploading' })));

      const results = await Promise.allSettled(
        uploads.map(async (u, i) => {
          const file = files[i].file;
          const res = await fetch(u.signedUrl, {
            method: 'PUT',
            headers: { 'Content-Type': file.type || 'application/octet-stream' },
            body: file,
          });
          if (!res.ok) throw new Error(`Upload failed (${res.status})`);
          return u;
        }),
      );

      // Derive the success set synchronously from `results` — do NOT read it
      // out of the setFiles updater below, which React runs on a later render.
      const successfulUploads = uploads.filter((_, i) => results[i].status === 'fulfilled');

      setFiles((prev) =>
        prev.map((p, i) => {
          const r = results[i];
          if (r.status === 'fulfilled') {
            return { ...p, status: 'uploaded' as const };
          }
          return {
            ...p,
            status: 'failed' as const,
            error: r.reason instanceof Error ? r.reason.message : 'Upload failed',
          };
        }),
      );

      if (successfulUploads.length === 0) {
        throw new Error('All uploads failed');
      }

      // Phase 3: confirm — insert N files rows for the uploads that succeeded
      const confirm = await fetch('/api/admin/file-bulk-create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          confirm: true,
          matterId: selectedMatterId,
          rows: successfulUploads.map((u) => ({
            notionId: u.notionId,
            name: deriveRowName(u.name),
            storagePath: u.storagePath,
            originalName: u.name,
          })),
        }),
      });
      if (!confirm.ok) {
        const data = await confirm.json().catch(() => ({}));
        throw new Error(data?.error || 'Failed to record uploaded files');
      }

      setDone(true);
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }, [canUpload, files, selectedMatterId, onSuccess]);

  if (!open) return null;

  const matterLabel = (m: MatterOption) =>
    m.matter_code ? `${m.name} · ${m.matter_code}` : m.name;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={uploading ? undefined : onClose}
    >
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-lg bg-card rounded-xl shadow-[var(--shadow-elevated)] border border-[var(--border-color)] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--border-color)]">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Bulk upload files</h3>
            <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
              Creates one file row per uploaded file. Edit metadata afterwards.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={uploading}
            className="p-1 rounded-md text-[var(--text-muted)] hover:text-foreground hover:bg-card-hover transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Matter picker */}
        <div className="px-5 pt-4">
          <label className="text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-wider">
            Matter
          </label>
          <div className="relative mt-1.5" ref={dropdownRef}>
            <div
              className={`flex items-center w-full bg-[var(--subtle-bg)] border rounded-lg transition-all duration-150 ${
                dropdownOpen
                  ? 'border-gold-400 ring-2 ring-gold-400/20'
                  : 'border-[var(--border-color)]'
              }`}
            >
              <input
                type="text"
                value={
                  dropdownOpen
                    ? matterSearch
                    : selectedMatter
                      ? matterLabel(selectedMatter)
                      : ''
                }
                onChange={(e) => {
                  setMatterSearch(e.target.value);
                  if (!dropdownOpen) setDropdownOpen(true);
                }}
                onFocus={() => {
                  setDropdownOpen(true);
                  setMatterSearch('');
                }}
                disabled={uploading}
                placeholder={mattersLoading ? 'Loading matters…' : 'Select matter'}
                className="flex-1 bg-transparent px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)]/50 focus:outline-none disabled:cursor-not-allowed"
              />
              <button
                type="button"
                disabled={uploading}
                onClick={() => setDropdownOpen((o) => !o)}
                className="px-2 py-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
              >
                <ChevronDown
                  className={`w-4 h-4 transition-transform ${dropdownOpen ? 'rotate-180' : ''}`}
                />
              </button>
            </div>
            {dropdownOpen && (
              <div className="absolute z-20 mt-1 w-full max-h-56 overflow-y-auto bg-[var(--card-bg)] border border-[var(--border-color)] rounded-lg shadow-lg">
                {filteredMatters.length === 0 ? (
                  <div className="px-3 py-2 text-xs text-[var(--text-secondary)]">
                    {mattersLoading ? 'Loading…' : 'No matches'}
                  </div>
                ) : (
                  filteredMatters.map((m) => (
                    <button
                      key={m.notion_id}
                      type="button"
                      onClick={() => {
                        setSelectedMatterId(m.notion_id);
                        setDropdownOpen(false);
                        setMatterSearch('');
                      }}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-card-hover cursor-pointer flex items-center justify-between gap-2"
                    >
                      <span className="truncate text-[var(--text-primary)]">{m.name}</span>
                      {m.matter_code && (
                        <span className="font-mono text-[10px] text-[var(--text-muted)] shrink-0">
                          {m.matter_code}
                        </span>
                      )}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        </div>

        {/* File picker / drop zone */}
        <div className="p-5">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              if (!uploading) setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={uploading ? undefined : handleDrop}
            onClick={() => !uploading && inputRef.current?.click()}
            className={`flex flex-col items-center justify-center gap-2 p-6 border-2 border-dashed rounded-lg transition-colors ${
              uploading
                ? 'border-[var(--border-color)] cursor-not-allowed opacity-60'
                : dragOver
                  ? 'border-navy-400 bg-navy-50/50 dark:bg-navy-500/10 cursor-pointer'
                  : 'border-[var(--border-color)] hover:border-navy-300 dark:hover:border-navy-400/40 hover:bg-[var(--subtle-bg)] cursor-pointer'
            }`}
          >
            <Upload className="w-6 h-6 text-[var(--text-muted)]" />
            <p className="text-sm text-[var(--text-muted)]">
              Drop files here or{' '}
              <span className="text-navy-600 dark:text-navy-400 font-medium">browse</span>
            </p>
            <p className="text-[11px] text-[var(--text-muted)]">
              Up to 50 files. Each becomes its own row.
            </p>
          </div>
          <input
            ref={inputRef}
            type="file"
            multiple
            className="sr-only"
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files);
              if (inputRef.current) inputRef.current.value = '';
            }}
          />

          {/* Selected files list */}
          {files.length > 0 && (
            <div className="mt-4 max-h-52 overflow-y-auto rounded-lg border border-[var(--border-color)] divide-y divide-[var(--border-color)]">
              {files.map((p, i) => (
                <div
                  key={`${p.file.name}-${i}`}
                  className="flex items-center gap-2 px-3 py-2 group"
                >
                  <FileText className="w-3.5 h-3.5 text-[var(--text-muted)] shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-foreground truncate">
                      {deriveRowName(p.file.name)}
                    </p>
                    <p className="text-[11px] text-[var(--text-muted)] truncate">
                      {p.file.name}
                    </p>
                  </div>
                  {p.status === 'uploading' && (
                    <Loader2 className="w-3.5 h-3.5 text-navy-500 animate-spin shrink-0" />
                  )}
                  {p.status === 'uploaded' && (
                    <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0 dark:text-emerald-400" />
                  )}
                  {p.status === 'failed' && (
                    <span title={p.error} className="shrink-0">
                      <AlertCircle className="w-3.5 h-3.5 text-red-500 dark:text-red-400" />
                    </span>
                  )}
                  {p.status === 'pending' && !uploading && (
                    <button
                      type="button"
                      onClick={() => removeFile(i)}
                      className="p-0.5 rounded text-[var(--text-muted)] opacity-0 group-hover:opacity-100 hover:text-red-500 transition-all cursor-pointer dark:hover:text-red-400"
                      title="Remove"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {error && (
            <p className="mt-3 text-sm text-red-600 dark:text-red-400 flex items-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5" />
              {error}
            </p>
          )}

          {done && !error && (
            <p className="mt-3 text-sm text-emerald-600 flex items-center gap-1.5 dark:text-emerald-400">
              <Check className="w-3.5 h-3.5" />
              Created {files.filter((p) => p.status === 'uploaded').length} file{' '}
              {files.filter((p) => p.status === 'uploaded').length === 1 ? 'row' : 'rows'}.
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-[var(--border-color)] bg-[var(--subtle-bg)]/40">
          <button
            type="button"
            onClick={onClose}
            disabled={uploading}
            className="px-3 py-1.5 text-xs font-medium rounded-lg text-[var(--text-secondary)] hover:text-foreground hover:bg-[var(--border-color)] transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {done ? 'Close' : 'Cancel'}
          </button>
          <button
            type="button"
            onClick={startUpload}
            disabled={!canUpload}
            className="inline-flex items-center gap-1.5 bg-gold-500 hover:bg-gold-600 text-white px-4 py-1.5 rounded-lg text-xs font-medium transition-colors duration-150 cursor-pointer shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {uploading ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Uploading…
              </>
            ) : (
              <>
                <Upload className="w-3.5 h-3.5" />
                Upload {files.length > 0 ? `${files.length} file${files.length === 1 ? '' : 's'}` : ''}
              </>
            )}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
