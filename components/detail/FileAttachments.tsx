'use client';

import { useState } from 'react';
import { Paperclip, Eye, Download, AlertTriangle } from 'lucide-react';
import type { FileAttachment } from '@/types/notion';
import FilePreviewModal from '@/components/FilePreviewModal';
import { downloadFile, needsReupload } from '@/lib/download-file';

interface Props {
  files: FileAttachment[];
}

export default function FileAttachments({ files }: Props) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  if (!files || files.length === 0) return null;

  return (
    <>
      <div className="bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] shadow-[var(--shadow-card)] overflow-hidden animate-fade-up">
        <div className="px-6 py-4 border-b border-[var(--border-color)] flex items-center justify-between">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">Attachments</h2>
          <span className="text-[11px] font-semibold text-[var(--text-muted)] bg-[var(--subtle-bg)] rounded-full px-2 py-0.5">
            {files.length}
          </span>
        </div>
        <div className="p-6">
          <div className="space-y-2">
            {files.map((file, i) => {
              const legacy = needsReupload(file);
              return (
                <div
                  key={i}
                  className={`flex items-center gap-3 px-4 py-3 rounded-lg border transition-all duration-200 group ${
                    legacy
                      ? 'border-amber-200/70 bg-amber-50/40 dark:border-amber-500/20 dark:bg-amber-500/5'
                      : 'border-[var(--border-color)] hover:border-gold-300 dark:hover:border-gold-500/30 hover:bg-gold-50/50 dark:hover:bg-gold-500/5'
                  }`}
                >
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 transition-colors ${
                    legacy
                      ? 'bg-amber-100 dark:bg-amber-500/10'
                      : 'bg-gold-50 dark:bg-gold-500/10 group-hover:bg-gold-100 dark:group-hover:bg-gold-500/20'
                  }`}>
                    {legacy
                      ? <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                      : <Paperclip className="w-4 h-4 text-gold-600 dark:text-gold-400" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[var(--text-primary)] truncate">{file.name || 'Untitled File'}</p>
                    {legacy && (
                      <p className="text-[11px] text-amber-700 dark:text-amber-400 mt-0.5">Legacy Notion file — needs to be re-uploaded</p>
                    )}
                  </div>
                  {legacy ? (
                    <span className="shrink-0 inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 ring-1 ring-inset ring-amber-300/60 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/30">
                      <AlertTriangle className="w-3 h-3" />
                      Needs re-upload
                    </span>
                  ) : (
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => { setActiveIndex(i); setPreviewOpen(true); }}
                        className="inline-flex items-center gap-1 px-2 py-1.5 text-[11px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] bg-[var(--card-bg)] hover:bg-[var(--card-bg-hover)] border border-[var(--border-color)] rounded-lg transition-all cursor-pointer"
                        title="Preview"
                      >
                        <Eye className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void downloadFile(file)}
                        className="inline-flex items-center justify-center w-7 h-7 text-[var(--text-muted)] hover:text-[var(--text-primary)] bg-[var(--card-bg)] hover:bg-[var(--card-bg-hover)] border border-[var(--border-color)] rounded-lg transition-all cursor-pointer"
                        title="Download"
                      >
                        <Download className="w-3 h-3" />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <FilePreviewModal
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        files={files}
        initialIndex={activeIndex}
      />
    </>
  );
}
