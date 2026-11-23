'use client';

import { useState, useCallback, useEffect } from 'react';
import { X, Plus, Loader2, Check, FileCheck } from 'lucide-react';
import { commitUpload, uploadToSignedUrl } from '@/lib/upload';

interface Props {
  open: boolean;
  onClose: () => void;
  deliverableId: string;
  deliverableName: string;
  status: string;
  /** True if the deliverable already has a filed copy. */
  hasExisting?: boolean;
  onSuccess?: () => void;
}

const FILED_VERSION_ACTION = 'Filed version';

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Modal entry point for uploading the filed/sent-out copy of a deliverable
 * directly from the admin data table. Mirrors the flow in FiledVersionCard
 * but as a popover so admins don't need to drill into the detail page first.
 */
export default function FiledVersionUploadModal({
  open, onClose, deliverableId, deliverableName, status, hasExisting, onSuccess,
}: Props) {
  const [files, setFiles] = useState<File[]>([]);
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset state whenever the modal closes
  useEffect(() => {
    if (!open) {
      setFiles([]);
      setNote('');
      setError(null);
      setLoading(false);
    }
  }, [open]);

  const handleUpload = useCallback(async () => {
    if (files.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      const actionLabel = note.trim()
        ? `${FILED_VERSION_ACTION} — ${note.trim()}`
        : FILED_VERSION_ACTION;

      // Phase 1: signed upload URLs (new version)
      const urlRes = await fetch('/api/deliverable-file/upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deliverableId,
          action: actionLabel,
          files: files.map((f) => ({ name: f.name, size: f.size, type: f.type })),
        }),
      });
      if (!urlRes.ok) {
        const err = await urlRes.json().catch(() => ({ error: 'Upload failed' }));
        throw new Error(err.error || 'Failed to get upload URLs');
      }
      const { uploads, version: committedVersion } = await urlRes.json();

      // Phase 2: PUT each file to Supabase Storage
      for (let i = 0; i < files.length; i++) {
        await uploadToSignedUrl(uploads[i].signedUrl, files[i], {
          name: files[i].name,
          size: files[i].size,
          type: files[i].type,
        });
      }

      // Phase 3: commit rows (keepalive + retry so a dropped commit can't
      // strand the uploaded object without a row)
      await commitUpload('/api/deliverable-file/upload-url', {
        confirm: true,
        deliverableId,
        action: actionLabel,
        version: committedVersion,
        uploads: files.map((f, i) => ({
          storagePath: uploads[i].storagePath,
          name: f.name,
          size: f.size,
        })),
      });

      // Best-effort activity log
      await fetch('/api/deliverable-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          notionId: deliverableId,
          action: actionLabel,
          oldStatus: status,
          newStatus: status,
          fileUrl: uploads[0].storagePath,
          fileName: files[0].name,
        }),
      }).catch(() => { /* non-fatal */ });

      onSuccess?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setLoading(false);
    }
  }, [files, note, deliverableId, status, onSuccess, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-md bg-[var(--card-bg)] rounded-2xl shadow-2xl border border-[var(--border-color)] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-[var(--border-color)] bg-emerald-50/60 dark:bg-emerald-500/5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            <h2 className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">
              {hasExisting ? 'Replace Filed Version' : 'Upload Filed Version'}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-[var(--text-muted)] hover:bg-[var(--subtle-bg)] cursor-pointer"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-0.5">Deliverable</p>
            <p className="text-sm font-medium text-[var(--text-primary)] truncate" title={deliverableName}>
              {deliverableName}
            </p>
          </div>

          <p className="text-[11px] text-[var(--text-secondary)]">
            {hasExisting
              ? 'A filed copy already exists. Uploading will add a new version — the previous copy will be preserved in the version history.'
              : `Upload the stamped, received, or sent-out copy. It will be saved as a new version and tagged "${FILED_VERSION_ACTION}" in the version history.`}
          </p>

          <div>
            <label className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1 block">
              File(s)
            </label>
            <label className="relative flex items-center gap-2 px-3 py-2 text-xs text-[var(--text-secondary)] bg-white dark:bg-[var(--card-bg)] border border-dashed border-[var(--border-color)] rounded-lg cursor-pointer hover:border-emerald-400 transition-colors">
              <Plus className="w-3.5 h-3.5 text-[var(--text-muted)]" />
              {files.length > 0
                ? `${files.length} file${files.length > 1 ? 's' : ''} selected`
                : 'Choose files...'}
              <input
                type="file"
                multiple
                className="absolute inset-0 opacity-0 cursor-pointer"
                onChange={(e) => {
                  if (e.target.files) setFiles(Array.from(e.target.files));
                }}
              />
            </label>
            {files.length > 0 && (
              <div className="mt-1.5 space-y-1">
                {files.map((f, i) => (
                  <p key={i} className="text-[10px] text-[var(--text-muted)] truncate">
                    {f.name} ({formatFileSize(f.size)})
                  </p>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1 block">
              Note (optional)
            </label>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Court-stamped, Email receipt..."
              className="w-full px-3 py-1.5 text-xs bg-white dark:bg-[var(--card-bg)] border border-[var(--border-color)] rounded-lg outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/20"
            />
          </div>

          {error && (
            <div className="text-[11px] text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-lg px-3 py-2">
              {error}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-[var(--border-color)] flex items-center gap-2 justify-end bg-[var(--subtle-bg)]">
          <button
            onClick={onClose}
            disabled={loading}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-[11px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] bg-white dark:bg-[var(--card-bg)] border border-[var(--border-color)] rounded-lg transition-all cursor-pointer disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleUpload}
            disabled={loading || files.length === 0}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-[11px] font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-all cursor-pointer disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
            Upload
          </button>
        </div>
      </div>
    </div>
  );
}
