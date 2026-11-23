'use client';

import { useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, ExternalLink, Download, FileText, Image as ImageIcon, FileSpreadsheet, Loader2, ChevronLeft, ChevronRight, AlertTriangle } from 'lucide-react';
import type { FileAttachment } from '@/types/notion';
import { downloadFile, extractStoragePath, needsReupload } from '@/lib/download-file';

type FileType = 'pdf' | 'image' | 'docx' | 'office' | 'unknown';

function getFileType(name: string): FileType {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'pdf') return 'pdf';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'].includes(ext)) return 'image';
  if (ext === 'docx') return 'docx';
  if (['doc', 'xls', 'xlsx', 'ppt', 'pptx'].includes(ext)) return 'office';
  return 'unknown';
}

function getFileIcon(type: FileType) {
  switch (type) {
    case 'pdf': return <FileText className="w-4 h-4" />;
    case 'image': return <ImageIcon className="w-4 h-4" />;
    case 'office': return <FileSpreadsheet className="w-4 h-4" />;
    default: return <FileText className="w-4 h-4" />;
  }
}

function getTypeLabel(type: FileType) {
  switch (type) {
    case 'pdf': return 'PDF';
    case 'image': return 'Image';
    case 'docx': return 'Document';
    case 'office': return 'Document';
    default: return 'File';
  }
}

interface Props {
  open: boolean;
  onClose: () => void;
  files?: FileAttachment[];
  /** @deprecated Use `files` instead */
  file?: FileAttachment | null;
  /** Index of the file to show initially when the modal opens */
  initialIndex?: number;
  /**
   * Endpoint that mints fresh signed URLs. Defaults to `/api/file-sign`
   * (firm-side auth). Set to `/api/portal/file-sign` when mounted from
   * a client portal surface.
   */
  signEndpoint?: string;
}

export default function FilePreviewModal({
  open,
  onClose,
  files: filesProp,
  file: fileProp,
  initialIndex = 0,
  signEndpoint = '/api/file-sign',
}: Props) {
  // Support both old single-file and new multi-file API
  const rawFiles = filesProp?.length ? filesProp : fileProp ? [fileProp] : [];

  const [mounted, setMounted] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [freshUrls, setFreshUrls] = useState<Record<string, string>>({});

  useEffect(() => { setMounted(true); }, []);
  const [signingUrls, setSigningUrls] = useState(false);

  // Reset state and refresh signed URLs when modal opens
  useEffect(() => {
    if (open) {
      setActiveIndex(initialIndex);
      setLoading(true);
      setFreshUrls({});

      // Collect storage paths — prefer explicit path, fall back to extracting from URL
      const paths: string[] = [];
      for (const f of rawFiles) {
        const p = f.path || extractStoragePath(f.url);
        if (p) paths.push(p);
      }

      if (paths.length > 0) {
        setSigningUrls(true);
        fetch(signEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ paths }),
        })
          .then((res) => res.json())
          .then((data) => { if (data.urls) setFreshUrls(data.urls); })
          .catch(() => {})
          .finally(() => setSigningUrls(false));
      } else {
        setSigningUrls(false);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Apply fresh URLs over stale ones
  const files = rawFiles.map((f) => {
    const storagePath = f.path || extractStoragePath(f.url);
    return {
      ...f,
      url: (storagePath && freshUrls[storagePath]) || f.url,
    };
  });

  // Reset loading when switching files
  useEffect(() => {
    setLoading(true);
  }, [activeIndex]);

  // Close on Escape, navigate with arrow keys
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
      if (files.length > 1) {
        if (e.key === 'ArrowLeft') setActiveIndex((i) => (i > 0 ? i - 1 : files.length - 1));
        if (e.key === 'ArrowRight') setActiveIndex((i) => (i < files.length - 1 ? i + 1 : 0));
      }
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onClose, files.length]);

  // Prevent body scroll when open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = ''; };
    }
  }, [open]);

  // Derive current file info (needed by hooks below, so must be before early return)
  const file = files.length > 0 ? files[activeIndex] ?? files[0] : null;
  const fileType = file ? getFileType(file.name) : 'unknown';
  const fileUrl = file?.url ?? '';
  const isLegacy = file ? needsReupload(file) : false;

  // Ref callback: renders DOCX when the container DOM node mounts
  const docxRefCallback = useCallback(
    (node: HTMLDivElement | null) => {
      if (!node || fileType !== 'docx' || !fileUrl) return;
      setLoading(true);
      (async () => {
        try {
          const response = await fetch(fileUrl);
          if (!response.ok) throw new Error(`Failed to download: ${response.status}`);
          const blob = await response.blob();
          const { renderAsync } = await import('docx-preview');
          node.innerHTML = '';
          await renderAsync(blob, node, undefined, {
            className: 'docx-preview-wrapper',
            inWrapper: true,
            ignoreWidth: false,
            ignoreHeight: false,
          });
          setLoading(false);
        } catch {
          setLoading(false);
        }
      })();
    },
    [fileType, fileUrl],
  );

  if (!open || !file || !mounted) return null;

  const hasMultiple = files.length > 1;

  function renderContent(): React.ReactNode {
    if (!file) return null;
    const f = file; // TS narrowing for closure
    if (needsReupload(f)) {
      return (
        <div className="flex flex-col items-center justify-center w-full h-full gap-4 p-8 text-center">
          <div className="w-16 h-16 rounded-2xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 flex items-center justify-center">
            <AlertTriangle className="w-8 h-8 text-amber-500" />
          </div>
          <div className="max-w-sm">
            <p className="text-sm font-medium text-foreground">{f.name}</p>
            <p className="text-xs text-[var(--text-muted)] mt-1">Legacy Notion file — this attachment was never migrated to storage and needs to be re-uploaded before it can be previewed or downloaded.</p>
          </div>
        </div>
      );
    }
    switch (fileType) {
      case 'pdf':
        return (
          <iframe
            src={f.url + '#toolbar=1'}
            className="w-full h-full rounded-b-2xl"
            onLoad={() => setLoading(false)}
            title={f.name}
          />
        );
      case 'docx':
        return (
          <div
            ref={docxRefCallback}
            className="w-full h-full overflow-auto bg-[var(--bg-subtle)] rounded-b-2xl docx-container"
          />
        );
      case 'office':
        return (
          <iframe
            src={`https://docs.google.com/gview?url=${encodeURIComponent(f.url)}&embedded=true`}
            className="w-full h-full rounded-b-2xl"
            onLoad={() => setLoading(false)}
            title={f.name}
          />
        );
      case 'image':
        return (
          <div className="flex items-center justify-center w-full h-full p-6 bg-[var(--bg-subtle)]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={f.url}
              alt={f.name}
              className="max-w-full max-h-full object-contain rounded-lg shadow-lg"
              onLoad={() => setLoading(false)}
            />
          </div>
        );
      default:
        return (
          <div className="flex flex-col items-center justify-center w-full h-full gap-4 p-8 text-center">
            <div className="w-16 h-16 rounded-2xl bg-[var(--bg-subtle)] border border-[var(--border-color)] flex items-center justify-center">
              <FileText className="w-8 h-8 text-[var(--text-muted)]" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">{f.name}</p>
              <p className="text-xs text-[var(--text-muted)] mt-1">Preview not available for this file type</p>
            </div>
            <button
              type="button"
              onClick={() => window.open(f.url, '_blank', 'noopener,noreferrer')}
              className="mt-2 inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-navy-600 hover:bg-navy-700 rounded-xl transition-colors cursor-pointer"
            >
              <ExternalLink className="w-4 h-4" />
              Open in new tab
            </button>
          </div>
        );
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm animate-overlay"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-5xl h-[85vh] flex flex-col bg-card rounded-2xl shadow-[var(--shadow-elevated)] border border-[var(--border-color)] animate-dialog overflow-hidden">

        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-3.5 border-b border-[var(--border-color)] bg-[var(--bg-subtle)] shrink-0">
          {/* File type badge */}
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider rounded-lg bg-navy-100 text-navy-700 dark:bg-navy-500/15 dark:text-navy-300">
            {getFileIcon(fileType)}
            {getTypeLabel(fileType)}
          </span>

          {/* File selector / name */}
          {hasMultiple ? (
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <button
                type="button"
                onClick={() => setActiveIndex((i) => (i > 0 ? i - 1 : files.length - 1))}
                className="p-1 rounded-md text-[var(--text-muted)] hover:text-foreground hover:bg-card-hover transition-colors cursor-pointer shrink-0"
                title="Previous file"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <div className="flex items-center gap-1.5 flex-1 min-w-0 overflow-x-auto scrollbar-hide">
                {files.map((f, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setActiveIndex(i)}
                    className={`shrink-0 px-2.5 py-1 text-xs font-medium rounded-md transition-all duration-150 cursor-pointer truncate max-w-[200px] ${
                      i === activeIndex
                        ? 'bg-card text-foreground shadow-sm border border-[var(--border-color)]'
                        : 'text-[var(--text-muted)] hover:text-foreground hover:bg-card-hover'
                    }`}
                    title={f.name}
                  >
                    {f.name || `File ${i + 1}`}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setActiveIndex((i) => (i < files.length - 1 ? i + 1 : 0))}
                className="p-1 rounded-md text-[var(--text-muted)] hover:text-foreground hover:bg-card-hover transition-colors cursor-pointer shrink-0"
                title="Next file"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <h3 className="flex-1 text-sm font-medium text-foreground truncate" title={file.name}>
              {file.name}
            </h3>
          )}

          {/* Actions */}
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              disabled={isLegacy}
              onClick={(e) => {
                e.stopPropagation();
                void downloadFile(file, { signEndpoint });
              }}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-all duration-150 ${
                isLegacy
                  ? 'text-[var(--text-muted)] bg-card border border-[var(--border-color)] opacity-50 cursor-not-allowed'
                  : 'text-white bg-navy-600 hover:bg-navy-700 border border-navy-700 cursor-pointer'
              }`}
              title={isLegacy ? 'Legacy Notion file — needs to be re-uploaded' : 'Download file'}
            >
              <Download className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Download</span>
            </button>
            <button
              type="button"
              disabled={isLegacy}
              onClick={() => window.open(file.url, '_blank', 'noopener,noreferrer')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-[var(--border-color)] rounded-lg transition-all duration-150 ${
                isLegacy
                  ? 'text-[var(--text-muted)] bg-card opacity-50 cursor-not-allowed'
                  : 'text-[var(--text-secondary)] hover:text-foreground bg-card hover:bg-card-hover cursor-pointer'
              }`}
              title={isLegacy ? 'Legacy Notion file — needs to be re-uploaded' : 'Open in new tab'}
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">New tab</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center justify-center w-8 h-8 text-[var(--text-muted)] hover:text-foreground hover:bg-card-hover rounded-lg transition-all duration-150 cursor-pointer"
              title="Close preview"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="relative flex-1 min-h-0">
          {/* Loading spinner */}
          {(loading || signingUrls) && fileType !== 'unknown' && !isLegacy && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-card">
              <Loader2 className="w-8 h-8 text-navy-500 animate-spin" />
              <p className="text-sm text-[var(--text-muted)]">{signingUrls ? 'Preparing file...' : 'Loading preview...'}</p>
            </div>
          )}

          {!signingUrls && renderContent()}
        </div>
      </div>
    </div>,
    document.body,
  );
}
