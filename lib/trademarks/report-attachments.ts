import { firmStoragePath } from '@/lib/tenancy/service-db';
import { checkPathUnder } from '@/lib/storage/upload-path';

/**
 * A sent report's attachment as people know it: the letter is stored as
 * `<timestamp>-<file name>` so two sends never collide, and the stamp is not
 * part of its name.
 */
export function attachmentName(path: string): string {
  const base = path.split('/').pop() ?? 'attachment';
  return base.replace(/^\d{10,}-/, '');
}

/**
 * Where a mark's report files live — sent letters and the files the team
 * uploads for a report — under the firm's own prefix.
 */
export function reportFolder(firmId: string, trademarkId: string): string {
  return firmStoragePath(firmId, `trademarks/${trademarkId}/reports`);
}

/** The storage path for a report file the team uploads, stamped so two uploads of one name never collide. */
export function reportUploadPath(firmId: string, trademarkId: string, name: string, stamp = Date.now()): string {
  const safe = name.replace(/[^\w.\- ]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 120) || 'file';
  return `${reportFolder(firmId, trademarkId)}/${stamp}-${safe}`;
}

/**
 * True when `path` is a file directly in this mark's report folder, under the
 * firm's prefix — never another firm's or mark's, never a step's paper.
 */
export function isReportUpload(firmId: string, trademarkId: string, path: string): boolean {
  const checked = checkPathUnder(path, reportFolder(firmId, trademarkId));
  return checked.ok && !checked.path.slice(reportFolder(firmId, trademarkId).length + 1).includes('/');
}
