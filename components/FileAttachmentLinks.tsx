'use client';

import { useState } from 'react';
import { Eye, Download } from 'lucide-react';
import type { FileAttachment } from '@/types/notion';
import FilePreviewModal from './FilePreviewModal';
import { downloadFile } from '@/lib/download-file';

interface Props {
  files: FileAttachment[];
  onPreview?: () => void;
}

export default function FileAttachmentLinks({ files, onPreview }: Props) {
  const [previewOpen, setPreviewOpen] = useState(false);

  if (!files || files.length === 0) return null;

  const previewLabel = files.length === 1 ? files[0].name : `Preview ${files.length} files`;
  const downloadLabel = files.length === 1 ? `Download ${files[0].name}` : `Download ${files.length} files`;

  return (
    <>
      <span className="inline-flex items-center gap-1">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            setPreviewOpen(true);
            onPreview?.();
          }}
          className="action-lift inline-flex items-center gap-1 text-[11px] font-medium text-[var(--text-muted)] hover:text-gold-600 dark:hover:text-gold-400 rounded-md px-1.5 py-0.5 max-sm:min-h-9 max-sm:min-w-9 max-sm:justify-center border border-[var(--border-color)] hover:border-gold-300 dark:hover:border-gold-500/30 hover:bg-gold-50/50 dark:hover:bg-gold-500/5 cursor-pointer"
          title={previewLabel}
        >
          <Eye className="w-3 h-3 shrink-0" />
          {files.length > 1 && (
            <span className="tabular-nums">{files.length}</span>
          )}
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            for (const f of files) {
              void downloadFile(f);
            }
          }}
          className="action-lift inline-flex items-center justify-center text-[var(--text-muted)] hover:text-gold-600 dark:hover:text-gold-400 rounded-md px-1.5 py-0.5 max-sm:min-h-9 max-sm:min-w-9 max-sm:justify-center border border-[var(--border-color)] hover:border-gold-300 dark:hover:border-gold-500/30 hover:bg-gold-50/50 dark:hover:bg-gold-500/5 cursor-pointer"
          title={downloadLabel}
        >
          <Download className="w-3 h-3 shrink-0" />
        </button>
      </span>
      <FilePreviewModal
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        files={files}
      />
    </>
  );
}
