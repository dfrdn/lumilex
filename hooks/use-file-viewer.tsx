'use client';

import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import FilePreviewModal from '@/components/FilePreviewModal';
import { downloadFile } from '@/lib/download-file';
import type { FileAttachment } from '@/types/notion';

/**
 * Preview and download for files held as storage paths.
 *
 * Downloads go through `downloadFile` (our same-origin `/api/files/download`),
 * never a Supabase URL signed with `download:` — Storage drops that
 * Content-Disposition, so the old hand-rolled `<a>` click either did nothing
 * or navigated away from the page. A file that can't be opened says so rather
 * than failing silently.
 *
 * Render `viewer` once in the component that calls this.
 */
export function useFileViewer() {
  const [files, setFiles] = useState<FileAttachment[] | null>(null);

  const preview = useCallback(async (name: string, path: string | null | undefined) => {
    if (!path) return;
    try {
      const res = await fetch('/api/file-sign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths: [path] }),
      });
      const data = await res.json().catch(() => null);
      const url: string | undefined = data?.urls?.[path];
      if (!res.ok || !url) {
        toast.error(`Couldn't open ${name}${data?.error ? `: ${data.error}` : ' — the file may be missing from storage.'}`);
        return;
      }
      setFiles([{ name, url, path }]);
    } catch {
      toast.error(`Couldn't open ${name} — check your connection.`);
    }
  }, []);

  const download = useCallback((name: string, path: string | null | undefined) => {
    if (!path) return;
    void downloadFile({ name, url: '', path });
  }, []);

  const viewer = (
    <FilePreviewModal open={files !== null} onClose={() => setFiles(null)} files={files ?? []} />
  );

  return { preview, download, viewer };
}
