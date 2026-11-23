'use client';

import { useState, useCallback } from 'react';
import {
  FileText, Clock, Eye, Download, X, Check, Loader2, Plus,
} from 'lucide-react';
import FilePreviewModal from '@/components/FilePreviewModal';
import NeedsReuploadBadge from './NeedsReuploadBadge';
import { commitUpload, uploadToSignedUrl } from '@/lib/upload';
import { downloadFile } from '@/lib/download-file';
import type { DeliverableFileVersion } from '@/types/notion';
import { toast } from 'sonner';

interface Props {
  files: DeliverableFileVersion[];
  carriedOverFiles: DeliverableFileVersion[];
  version: number;
  uploaderInitials: string;
  uploadedBy: string;
  currentUserId: string;
  createdAt: string;
  action: string | null;
  /** The initial submission comment posted with this version, if any. */
  initialComment?: string | null;
  deliverableId: string;
  status: string;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function LatestSubmissionCard({
  files, carriedOverFiles, version, uploaderInitials,
  uploadedBy, currentUserId, createdAt, action,
  initialComment,
  deliverableId, status,
}: Props) {
  const [previewFile, setPreviewFile] = useState<{ name: string; url: string } | null>(null);

  // Update submission state
  const [isUpdating, setIsUpdating] = useState(false);
  const [updateAction, setUpdateAction] = useState('');
  const [updateFiles, setUpdateFiles] = useState<File[]>([]);
  const [updateLoading, setUpdateLoading] = useState(false);
  const [updateMode, setUpdateMode] = useState<'add' | 'new'>('new');

  const primaryFile = files[0];
  const totalFiles = files.length + carriedOverFiles.length;

  const handleUpdateSubmission = useCallback(async () => {
    if (updateFiles.length === 0) return;
    setUpdateLoading(true);
    try {
      // 1. Get signed upload URLs — pass current version to add to it, or omit for new version
      const body: Record<string, unknown> = {
        deliverableId,
        action: updateAction || null,
        files: updateFiles.map((f) => ({ name: f.name, size: f.size, type: f.type })),
      };
      if (updateMode === 'add') {
        body.version = version; // add files to current version
      }

      const urlRes = await fetch('/api/deliverable-file/upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!urlRes.ok) {
        const err = await urlRes.json().catch(() => ({ error: 'Upload failed' }));
        throw new Error(err.error);
      }
      const { uploads, version: committedVersion } = await urlRes.json();

      // 2. Upload files directly to Supabase Storage
      for (let i = 0; i < updateFiles.length; i++) {
        const file = updateFiles[i];
        const upload = uploads[i];
        await uploadToSignedUrl(upload.signedUrl, file, {
          name: file.name,
          size: file.size,
          type: file.type,
        });
      }

      // 3. Commit — insert deliverable_files rows only after every PUT succeeded.
      const actionLabel = updateMode === 'add'
        ? `Added files to v${version}`
        : 'Updated submission';

      // keepalive + retry so a dropped commit can't strand the uploaded object
      await commitUpload('/api/deliverable-file/upload-url', {
        confirm: true,
        deliverableId,
        action: updateAction || actionLabel,
        version: committedVersion,
        uploads: updateFiles.map((f, i) => ({
          storagePath: uploads[i].storagePath,
          name: f.name,
          size: f.size,
        })),
      });

      await fetch('/api/deliverable-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          notionId: deliverableId,
          action: actionLabel,
          oldStatus: status,
          newStatus: status,
          fileUrl: uploads[0].storagePath,
          fileName: updateFiles[0].name,
        }),
      });

      setIsUpdating(false);
      setUpdateAction('');
      setUpdateFiles([]);
      setUpdateMode('new');
      // Sibling DeliverableVersionHistory mirrors the versions prop locally —
      // its list won't reflect this new upload until the next navigation.
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setUpdateLoading(false);
    }
  }, [updateFiles, updateAction, updateMode, version, deliverableId, status]);

  const cancelUpdate = useCallback(() => {
    setIsUpdating(false);
    setUpdateAction('');
    setUpdateFiles([]);
    setUpdateMode('new');
  }, []);

  if (!primaryFile) return null;

  return (
    <>
      <div className="rounded-2xl border border-stone-200 dark:border-white/10 bg-white dark:bg-card overflow-hidden animate-fade-up">
        <div className="px-5 pt-4 pb-3 border-b border-stone-100 dark:border-white/[0.06] flex items-center justify-between">
          <h2 className="text-[13px] font-semibold text-stone-800 dark:text-stone-100">Latest Submission</h2>
          {!isUpdating && (
            <button
              onClick={() => setIsUpdating(true)}
              className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-[var(--text-muted)] hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 rounded-md transition-all cursor-pointer"
              title="Upload a new version"
            >
              <Plus className="w-3 h-3" />
              Update
            </button>
          )}
        </div>
        <div className="p-5">
          {isUpdating ? (
            <div className="space-y-3">
              {/* Current files in this version */}
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1.5 block">Current Files (v{version})</label>
                <div className="space-y-1">
                  {files.map((f) => (
                    <div key={f.id} className="flex items-center gap-2 px-2.5 py-1.5 bg-[var(--subtle-bg)] rounded-lg text-xs text-[var(--text-secondary)]">
                      <FileText className="w-3 h-3 text-gold-600 dark:text-gold-400 shrink-0" />
                      <span className="truncate flex-1">{f.fileName}</span>
                      {f.fileSize && <span className="text-[10px] text-[var(--text-muted)] shrink-0">{formatFileSize(f.fileSize)}</span>}
                    </div>
                  ))}
                  {carriedOverFiles.map((f) => (
                    <div key={`co-${f.id}`} className="flex items-center gap-2 px-2.5 py-1.5 bg-[var(--subtle-bg)] rounded-lg text-xs text-[var(--text-secondary)]">
                      <FileText className="w-3 h-3 text-[var(--text-muted)] shrink-0" />
                      <span className="truncate flex-1">{f.fileName}</span>
                      <span className="text-[10px] text-[var(--text-muted)] shrink-0">from v{f.version}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Mode toggle: new version vs add to current */}
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1.5 block">Upload Mode</label>
                <div className="flex rounded-lg border border-[var(--border-color)] overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setUpdateMode('new')}
                    className={`flex-1 px-3 py-1.5 text-[11px] font-medium transition-colors cursor-pointer ${
                      updateMode === 'new'
                        ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400'
                        : 'bg-white dark:bg-[var(--card-bg)] text-[var(--text-secondary)] hover:bg-[var(--subtle-bg)]'
                    }`}
                  >
                    New version (v{version + 1})
                  </button>
                  <button
                    type="button"
                    onClick={() => setUpdateMode('add')}
                    className={`flex-1 px-3 py-1.5 text-[11px] font-medium border-l border-[var(--border-color)] transition-colors cursor-pointer ${
                      updateMode === 'add'
                        ? 'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400'
                        : 'bg-white dark:bg-[var(--card-bg)] text-[var(--text-secondary)] hover:bg-[var(--subtle-bg)]'
                    }`}
                  >
                    Add to v{version}
                  </button>
                </div>
              </div>

              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1 block">Files to upload</label>
                <label className="relative flex items-center gap-2 px-3 py-2 text-xs text-[var(--text-secondary)] bg-white dark:bg-[var(--card-bg)] border border-dashed border-[var(--border-color)] rounded-lg cursor-pointer hover:border-emerald-400 transition-colors">
                  <Plus className="w-3.5 h-3.5 text-[var(--text-muted)]" />
                  {updateFiles.length > 0
                    ? `${updateFiles.length} file${updateFiles.length > 1 ? 's' : ''} selected`
                    : 'Choose files...'}
                  <input
                    type="file"
                    multiple
                    className="absolute inset-0 opacity-0 cursor-pointer"
                    onChange={(e) => {
                      if (e.target.files) setUpdateFiles(Array.from(e.target.files));
                    }}
                  />
                </label>
                {updateFiles.length > 0 && (
                  <div className="mt-1.5 space-y-1">
                    {updateFiles.map((f, i) => (
                      <p key={i} className="text-[10px] text-[var(--text-muted)] truncate">
                        {f.name} ({formatFileSize(f.size)})
                      </p>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1 block">Action Label (optional)</label>
                <input
                  type="text"
                  value={updateAction}
                  onChange={(e) => setUpdateAction(e.target.value)}
                  placeholder="e.g. Added exhibits, Updated draft..."
                  className="w-full px-3 py-1.5 text-xs bg-white dark:bg-[var(--card-bg)] border border-[var(--border-color)] rounded-lg outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/20"
                />
              </div>

              <div className="flex items-center gap-2 justify-end">
                <button
                  onClick={cancelUpdate}
                  disabled={updateLoading}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-[11px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] bg-white dark:bg-[var(--card-bg)] border border-[var(--border-color)] rounded-lg transition-all cursor-pointer"
                >
                  <X className="w-3 h-3" />
                  Cancel
                </button>
                <button
                  onClick={handleUpdateSubmission}
                  disabled={updateLoading || updateFiles.length === 0}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-[11px] font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-all cursor-pointer disabled:opacity-50"
                >
                  {updateLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                  Upload
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {/* Version header */}
              <div className="flex items-center gap-2 flex-wrap">
                <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-gold-100 text-gold-800 dark:bg-gold-500/15 dark:text-gold-300 rounded-md">
                  v{version}
                </span>
                <span className="text-xs font-medium text-[var(--text-primary)]">
                  {totalFiles} file{totalFiles !== 1 ? 's' : ''}
                </span>
              </div>

              {/* Initial submission comment (primary) */}
              {initialComment && (
                <div className="pl-3 ml-1 border-l-2 border-[var(--border-color)] py-1">
                  <p className="text-[12.5px] text-[var(--text-primary)] leading-relaxed whitespace-pre-wrap">
                    {initialComment}
                  </p>
                </div>
              )}

              {/* Meta info — placed below the comment for consistency with the version history */}
              <div className="flex items-center gap-2 text-[10px] text-[var(--text-muted)] flex-wrap">
                <span className="inline-flex items-center gap-1">
                  <span className="w-3.5 h-3.5 rounded-full bg-blue-100 dark:bg-blue-500/15 text-blue-700 dark:text-blue-300 flex items-center justify-center text-[7px] font-bold">
                    {uploaderInitials.charAt(0)}
                  </span>
                  <span className="font-medium text-[var(--text-secondary)]">{uploaderInitials}</span>
                </span>
                <span>&middot;</span>
                <span className="inline-flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {new Date(createdAt).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}
                </span>
                {action && (
                  <>
                    <span>&middot;</span>
                    <span className="italic">{action}</span>
                  </>
                )}
              </div>

              {/* File list */}
              <div className="space-y-1.5">
                {files.map((f) => (
                  <div
                    key={f.id}
                    className="flex items-center gap-2.5 px-3 py-2 bg-[var(--subtle-bg)] rounded-lg border border-[var(--border-color)]"
                  >
                    <FileText className="w-3.5 h-3.5 text-gold-600 dark:text-gold-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-[var(--text-primary)] truncate">{f.fileName}</p>
                      {f.fileSize && (
                        <p className="text-[10px] text-[var(--text-muted)]">{formatFileSize(f.fileSize)}</p>
                      )}
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
                ))}

                {/* Carried-over files from previous versions */}
                {carriedOverFiles.map((f) => (
                  <div
                    key={`co-${f.id}`}
                    className="flex items-center gap-2.5 px-3 py-2 bg-[var(--subtle-bg)] rounded-lg border border-[var(--border-color)]"
                  >
                    <FileText className="w-3.5 h-3.5 text-[var(--text-muted)] shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-[var(--text-primary)] truncate">{f.fileName}</p>
                      <p className="text-[10px] text-[var(--text-muted)]">
                        {f.fileSize ? formatFileSize(f.fileSize) : ''}
                        {f.fileSize ? ' · ' : ''}from v{f.version}
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
                ))}
              </div>
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
