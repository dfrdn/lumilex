'use client';

import { useState, useCallback } from 'react';
import { confirmAction } from '@/components/ui/confirm';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import { FileCheck, Upload, X, Loader2, Check, FileText, Eye, Download, Plus, Sparkles } from 'lucide-react';
// useRouter is kept only for the AI Status Report draft navigation flow; the
// file-upload path no longer triggers router.refresh().
import FilePreviewModal from '@/components/FilePreviewModal';
import NeedsReuploadBadge from './NeedsReuploadBadge';
import { commitUpload, uploadToSignedUrl } from '@/lib/upload';
import { downloadFile } from '@/lib/download-file';
import type { DeliverableFileVersion } from '@/types/notion';

interface Props {
  deliverableId: string;
  versions: DeliverableFileVersion[];
  status: string;
  /** When false, the card renders read-only (no upload affordance). */
  canUpload?: boolean;
}

export const FILED_VERSION_ACTION = 'Filed version';

function isFiledVersion(v: DeliverableFileVersion): boolean {
  return !!v.action && v.action.toLowerCase().startsWith('filed version');
}

/** Pulls the optional note out of an action label like "Filed version — <note>". */
function extractFiledNote(action: string | null | undefined): string | null {
  if (!action) return null;
  const match = action.match(/^filed version\s*[—-]\s*(.+)$/i);
  return match ? match[1].trim() : null;
}

function formatFileSize(bytes: number | null): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Admin-only upload slot for the actual "filed version" of a deliverable —
 * i.e., the stamped, court-received, or sent-out copy that is preserved as
 * the authoritative record once a deliverable transitions to
 * "Filed or Sent out". Each upload creates a new deliverable_files row
 * tagged with action = "Filed version" so it's distinguishable from
 * regular drafts in the version history.
 */
export default function FiledVersionCard({ deliverableId, versions, status, canUpload = false }: Props) {
  const router = useRouter();

  const filedFiles = versions.filter(isFiledVersion);
  const latestVersionNum = versions.length > 0 ? Math.max(...versions.map((v) => v.version)) : 0;

  const [isUploading, setIsUploading] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [draftingReport, setDraftingReport] = useState(false);
  const [previewFile, setPreviewFile] = useState<{ name: string; url: string } | null>(null);

  const handleDraftStatusReport = useCallback(async () => {
    if (filedFiles.length === 0) return;
    if (!(await confirmAction({ title: 'Generate a Status Report drafting from this filed version?', confirmLabel: 'Generate' }))) return;
    setDraftingReport(true);
    try {
      const res = await fetch('/api/status-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deliverableId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to draft');
      router.push(`/dashboard/deliverables/${data.deliverableId}`);
    } catch (err) {
      toast.error(`Failed to draft status report: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setDraftingReport(false);
    }
  }, [deliverableId, filedFiles.length, router]);

  const reset = useCallback(() => {
    setIsUploading(false);
    setFiles([]);
    setNote('');
  }, []);

  const handleUpload = useCallback(async () => {
    if (files.length === 0) return;
    setLoading(true);
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

      // Log to deliverable_actions so it appears in the activity feed
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

      reset();
      // Sibling DeliverableVersionHistory mirrors the versions prop locally —
      // its list won't show this filed-version row until the next navigation.
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setLoading(false);
    }
  }, [files, note, deliverableId, status, reset]);

  return (
    <>
      <div className="rounded-2xl border border-emerald-200 dark:border-emerald-500/25 bg-white dark:bg-card overflow-hidden animate-fade-up">
        <div className="px-5 pt-4 pb-3 border-b border-stone-100 dark:border-white/[0.06] flex items-center justify-between bg-emerald-50/60 dark:bg-emerald-500/5">
          <div className="flex items-center gap-2">
            <FileCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            <h2 className="text-[13px] font-semibold text-emerald-800 dark:text-emerald-200">
              Filed Version
            </h2>
          </div>
          <div className="flex items-center gap-1">
            {!isUploading && filedFiles.length > 0 && (
              <button
                onClick={handleDraftStatusReport}
                disabled={draftingReport}
                className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-500/20 rounded-md transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                title="AI-draft a Status Report based on this filed version"
              >
                {draftingReport ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Sparkles className="w-3 h-3" />
                )}
                {draftingReport ? 'Drafting…' : 'Draft Status Report'}
              </button>
            )}
            {!isUploading && canUpload && (
              <button
                onClick={() => setIsUploading(true)}
                className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-500/20 rounded-md transition-all cursor-pointer"
                title="Upload the filed/sent-out copy"
              >
                <Upload className="w-3 h-3" />
                Upload
              </button>
            )}
          </div>
        </div>

        <div className="p-5">
          {isUploading && canUpload ? (
            <div className="space-y-3">
              <p className="text-[11px] text-[var(--text-secondary)]">
                Upload the stamped, received, or sent-out copy. It will be saved as
                v{latestVersionNum + 1} and tagged &quot;{FILED_VERSION_ACTION}&quot; in the version history.
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

              <div className="flex items-center gap-2 justify-end">
                <button
                  onClick={reset}
                  disabled={loading}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-[11px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] bg-white dark:bg-[var(--card-bg)] border border-[var(--border-color)] rounded-lg transition-all cursor-pointer"
                >
                  <X className="w-3 h-3" />
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
          ) : filedFiles.length === 0 ? (
            <div className="text-center py-4">
              <p className="text-xs text-[var(--text-muted)]">
                {canUpload
                  ? 'No filed copy uploaded yet. Upload the stamped or received version to preserve it as the authoritative record.'
                  : 'No filed copy uploaded yet.'}
              </p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {filedFiles.map((f) => {
                const filedNote = extractFiledNote(f.action);
                return (
                <div key={f.id} className="space-y-1.5">
                  <div className="flex items-center gap-2.5 px-3 py-2 bg-emerald-50/40 dark:bg-emerald-500/5 rounded-lg border border-emerald-200/50 dark:border-emerald-500/20">
                    <FileText className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-[var(--text-primary)] truncate">{f.fileName}</p>
                      <p className="text-[10px] text-[var(--text-muted)]">
                        v{f.version}
                        {f.fileSize ? ` · ${formatFileSize(f.fileSize)}` : ''}
                        {' · '}
                        {new Date(f.createdAt).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </p>
                    </div>
                    {f.needsReupload ? (
                      <NeedsReuploadBadge />
                    ) : (
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => setPreviewFile({ name: f.fileName, url: f.fileUrl })}
                        className="inline-flex items-center gap-1 px-2 py-1.5 text-[11px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] bg-[var(--card-bg)] hover:bg-[var(--card-bg-hover)] border border-[var(--border-color)] rounded-lg transition-all cursor-pointer"
                        title="Preview"
                      >
                        <Eye className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void downloadFile({ name: f.fileName, url: f.fileUrl })}
                        className="inline-flex items-center justify-center w-7 h-7 text-[var(--text-muted)] hover:text-[var(--text-primary)] bg-[var(--card-bg)] hover:bg-[var(--card-bg-hover)] border border-[var(--border-color)] rounded-lg transition-all cursor-pointer"
                        title="Download"
                      >
                        <Download className="w-3 h-3" />
                      </button>
                    </div>
                    )}
                  </div>
                  {filedNote && (
                    <p className="text-[11px] text-emerald-700 dark:text-emerald-300 italic leading-relaxed whitespace-pre-wrap break-words px-1">
                      {filedNote}
                    </p>
                  )}
                </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <FilePreviewModal
        open={!!previewFile}
        onClose={() => setPreviewFile(null)}
        file={previewFile}
      />
    </>
  );
}
