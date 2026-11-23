'use client';

import { useEffect, useRef, useState } from 'react';
import { Upload, X, FileText, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { uploadToSignedUrl } from '@/lib/upload';

interface Props {
  open: boolean;
  matterId: string;
  fileRequestId?: string | null;
  requestDescription?: string | null;
  onClose: () => void;
  onUploaded?: () => void;
}

const MAX_FILES = 20;
const MAX_TOTAL_MB = 200;

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function PortalUploadModal({
  open,
  matterId,
  fileRequestId,
  requestDescription,
  onClose,
  onUploaded,
}: Props) {
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setFiles([]);
      setSubmitting(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !submitting) onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, submitting, onClose]);

  if (!open) return null;

  function addFiles(incoming: FileList | File[]) {
    const arr = Array.from(incoming);
    setFiles((prev) => {
      const merged = [...prev];
      for (const f of arr) {
        if (merged.length >= MAX_FILES) break;
        if (!merged.some((m) => m.name === f.name && m.size === f.size)) {
          merged.push(f);
        }
      }
      return merged;
    });
  }

  function removeAt(idx: number) {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  }

  async function handleSubmit() {
    if (files.length === 0) return;
    const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
    if (totalBytes > MAX_TOTAL_MB * 1024 * 1024) {
      toast.error(`Total upload exceeds ${MAX_TOTAL_MB} MB. Please split into multiple sends.`);
      return;
    }

    setSubmitting(true);
    try {
      const phase1Res = await fetch(
        `/api/portal/matters/${encodeURIComponent(matterId)}/files/upload`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            files: files.map((f) => ({ name: f.name, type: f.type })),
            fileRequestId: fileRequestId || undefined,
          }),
        },
      );
      if (!phase1Res.ok) {
        const err = await phase1Res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to prepare upload');
      }
      const phase1 = (await phase1Res.json()) as {
        fileNotionId: string;
        uploads: { name: string; storagePath: string; signedUrl: string }[];
      };

      await Promise.all(
        phase1.uploads.map(async (u, idx) => {
          const file = files[idx];
          if (!file) return;
          await uploadToSignedUrl(u.signedUrl, file, {
            name: file.name,
            size: file.size,
            type: file.type,
          });
        }),
      );

      const phase2Res = await fetch(
        `/api/portal/matters/${encodeURIComponent(matterId)}/files/upload`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            confirm: true,
            fileNotionId: phase1.fileNotionId,
            uploads: phase1.uploads.map((u) => ({
              name: u.name,
              storagePath: u.storagePath,
            })),
            fileRequestId: fileRequestId || undefined,
          }),
        },
      );
      if (!phase2Res.ok) {
        const err = await phase2Res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to record upload');
      }

      toast.success(
        files.length === 1
          ? `Sent "${files[0].name}" to your legal team.`
          : `Sent ${files.length} files to your legal team.`,
      );
      onUploaded?.();
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Upload failed';
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
    >
      <div className="w-full max-w-lg bg-card border border-[var(--border-color)] rounded-2xl shadow-[var(--shadow-elevated)]">
        <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-[var(--border-color)]">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-foreground">
              {fileRequestId ? 'Fulfill request' : 'Send files'}
            </h2>
            {requestDescription && (
              <p className="text-xs text-[var(--text-secondary)] mt-1 line-clamp-2">
                {requestDescription}
              </p>
            )}
            {!fileRequestId && (
              <p className="text-xs text-[var(--text-secondary)] mt-1">
                Your legal team will be notified when files arrive.
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="p-1.5 rounded-md text-[var(--text-muted)] hover:text-foreground hover:bg-subtle transition-colors disabled:opacity-50"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={submitting || files.length >= MAX_FILES}
            className="w-full border border-dashed border-[var(--border-color)] rounded-xl bg-subtle/40 hover:bg-subtle transition-colors px-4 py-8 flex flex-col items-center gap-2 disabled:opacity-50"
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (submitting) return;
              if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files);
            }}
          >
            <Upload className="w-5 h-5 text-[var(--text-muted)]" />
            <span className="text-sm text-foreground">
              Drop files here or <span className="text-gold-600 dark:text-gold-400 font-medium">browse</span>
            </span>
            <span className="text-[11px] text-[var(--text-muted)]">
              Up to {MAX_FILES} files · {MAX_TOTAL_MB} MB total
            </span>
          </button>
          <input
            ref={inputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files);
              e.target.value = '';
            }}
          />

          {files.length > 0 && (
            <ul className="mt-3 space-y-1.5 max-h-48 overflow-y-auto">
              {files.map((f, idx) => (
                <li
                  key={`${f.name}-${idx}`}
                  className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-subtle/60 border border-[var(--border-color)]"
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <FileText className="w-3.5 h-3.5 text-[var(--text-muted)] shrink-0" />
                    <span className="text-sm text-foreground truncate">{f.name}</span>
                    <span className="text-[11px] text-[var(--text-muted)] shrink-0">
                      {formatSize(f.size)}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeAt(idx)}
                    disabled={submitting}
                    className="p-1 rounded-md text-[var(--text-muted)] hover:text-foreground hover:bg-subtle transition-colors disabled:opacity-50"
                    aria-label={`Remove ${f.name}`}
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-[var(--border-color)]">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="text-sm text-[var(--text-secondary)] hover:text-foreground px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || files.length === 0}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-white bg-navy-600 hover:bg-navy-700 disabled:bg-navy-600/50 disabled:cursor-not-allowed px-4 py-1.5 rounded-lg transition-colors"
          >
            {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {submitting ? 'Sending…' : files.length === 0 ? 'Send' : `Send ${files.length} file${files.length === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </div>
  );
}
