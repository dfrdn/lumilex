'use client';

import { useState, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, Upload, Loader2, Check, FileText, Trash2 } from 'lucide-react';

interface FileEntry {
  name: string;
  url: string;
  path?: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  notionId: string;
  existingFiles: FileEntry[];
  onSuccess: () => void;
}

export default function FileUploadModal({ open, onClose, notionId, existingFiles, onSuccess }: Props) {
  const [uploading, setUploading] = useState(false);
  const [uploadedNames, setUploadedNames] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [localFiles, setLocalFiles] = useState<FileEntry[]>(existingFiles);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(async (files: FileList | File[]) => {
    if (files.length === 0) return;
    setUploading(true);
    setError(null);
    setUploadedNames([]);

    try {
      const fileList = Array.from(files);

      // Phase 1: Get signed upload URLs
      const urlRes = await fetch('/api/admin/file-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          notionId,
          files: fileList.map((f) => ({ name: f.name, type: f.type })),
        }),
      });

      if (!urlRes.ok) {
        const data = await urlRes.json();
        throw new Error(data.error || 'Failed to get upload URLs');
      }

      const { uploads } = await urlRes.json() as {
        uploads: { name: string; storagePath: string; signedUrl: string; token: string }[];
      };

      // Upload files directly to Supabase Storage
      await Promise.all(
        uploads.map(async (upload, i) => {
          const file = fileList[i];
          const uploadRes = await fetch(upload.signedUrl, {
            method: 'PUT',
            headers: {
              'Content-Type': file.type || 'application/octet-stream',
            },
            body: file,
          });
          if (!uploadRes.ok) {
            throw new Error(`Upload failed for ${file.name}`);
          }
        }),
      );

      // Phase 2: Confirm uploads and update DB
      const confirmRes = await fetch('/api/admin/file-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          notionId,
          confirm: true,
          uploads: uploads.map((u) => ({ name: u.name, storagePath: u.storagePath })),
        }),
      });

      if (!confirmRes.ok) {
        const data = await confirmRes.json();
        throw new Error(data.error || 'Failed to confirm uploads');
      }

      const names = fileList.map((f) => f.name);
      setUploadedNames(names);
      setLocalFiles((prev) => {
        const merged = [...prev];
        for (const upload of uploads) {
          const entry = { name: upload.name, url: '', path: upload.storagePath };
          const idx = merged.findIndex((f) => f.name === entry.name);
          if (idx >= 0) merged[idx] = entry;
          else merged.push(entry);
        }
        return merged;
      });
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }, [notionId, onSuccess]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files);
    }
  }, [handleFiles]);

  const handleDelete = useCallback(async (fileName: string) => {
    setDeleting(fileName);
    try {
      const res = await fetch('/api/admin/file-upload', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notionId, fileName }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Delete failed');
      }
      setLocalFiles((prev) => prev.filter((f) => f.name !== fileName));
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setDeleting(null);
    }
  }, [notionId, onSuccess]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-md bg-card rounded-xl shadow-[var(--shadow-elevated)] border border-[var(--border-color)] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--border-color)]">
          <h3 className="text-sm font-semibold text-foreground">Files</h3>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-md text-[var(--text-muted)] hover:text-foreground hover:bg-card-hover transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Existing files list */}
        {localFiles.length > 0 && (
          <div className="px-5 py-3 border-b border-[var(--border-color)] max-h-48 overflow-y-auto">
            <p className="text-[11px] font-medium text-[var(--text-muted)] uppercase tracking-wider mb-2">
              Attached ({localFiles.length})
            </p>
            <div className="space-y-1">
              {localFiles.map((f, i) => (
                <div key={i} className="flex items-center gap-2 py-1 group">
                  <FileText className="w-3.5 h-3.5 text-[var(--text-muted)] shrink-0" />
                  <span className="text-sm text-foreground truncate flex-1">{f.name}</span>
                  {uploadedNames.includes(f.name) && (
                    <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0 dark:text-emerald-400" />
                  )}
                  <button
                    type="button"
                    onClick={() => handleDelete(f.name)}
                    disabled={deleting === f.name}
                    className="p-0.5 rounded text-[var(--text-muted)] opacity-0 group-hover:opacity-100 hover:text-red-500 transition-all cursor-pointer disabled:opacity-50 dark:hover:text-red-400"
                    title="Remove file"
                  >
                    {deleting === f.name ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Upload area */}
        <div className="p-5">
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => !uploading && inputRef.current?.click()}
            className={`flex flex-col items-center justify-center gap-2 p-6 border-2 border-dashed rounded-lg cursor-pointer transition-colors ${
              dragOver
                ? 'border-navy-400 bg-navy-50/50 dark:bg-navy-500/10'
                : 'border-[var(--border-color)] hover:border-navy-300 dark:hover:border-navy-400/40 hover:bg-[var(--subtle-bg)]'
            }`}
          >
            {uploading ? (
              <>
                <Loader2 className="w-6 h-6 text-navy-500 animate-spin" />
                <p className="text-sm text-[var(--text-muted)]">Uploading...</p>
              </>
            ) : (
              <>
                <Upload className="w-6 h-6 text-[var(--text-muted)]" />
                <p className="text-sm text-[var(--text-muted)]">
                  Drop files here or <span className="text-navy-600 dark:text-navy-400 font-medium">browse</span>
                </p>
              </>
            )}
          </div>
          <input
            ref={inputRef}
            type="file"
            multiple
            className="sr-only"
            onChange={(e) => e.target.files && handleFiles(e.target.files)}
          />

          {error && (
            <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>
          )}

          {uploadedNames.length > 0 && !error && (
            <p className="mt-3 text-sm text-emerald-600 flex items-center gap-1.5 dark:text-emerald-400">
              <Check className="w-3.5 h-3.5" />
              {uploadedNames.length} file{uploadedNames.length > 1 ? 's' : ''} uploaded
            </p>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
