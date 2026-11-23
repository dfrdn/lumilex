/**
 * Trigger a quiet file download without navigating away from the current page.
 *
 * Files live in cross-origin Supabase Storage. Browsers ignore the `<a download>`
 * attribute on cross-origin URLs unless the response carries
 * `Content-Disposition: attachment`. Supabase Storage's own `?download=` query
 * option no longer reliably sets that header (the SDK double-encodes the
 * filename and the upstream server silently drops the disposition), so a plain
 * `<a download>` ends up navigating to the file and rendering it inline
 * (PDFs, images), wiping out the current page.
 *
 * The fix: route the click through our own /api/files/download endpoint, which
 * fetches the file via service-role and re-emits it with a proper
 * `Content-Disposition: attachment; filename=...; filename*=UTF-8''...`. Since
 * the response is same-origin and explicitly attachment, the browser saves it
 * with the exact filename we asked for and never navigates.
 */

import { toast } from 'sonner';

/** Extract the storage path (`files/...`) from a signed Supabase URL. */
export function extractStoragePath(url: string): string | null {
  const match = url.match(/\/storage\/v1\/object\/sign\/files\/([^?]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * A file needs re-uploading only when there's no way to resolve it to a live
 * Supabase Storage object: no storage `path`, the `url` isn't a signable
 * Supabase URL, and what remains is empty or a dead Notion-hosted S3 link (the
 * captured 2026-03 migration URLs that expired an hour later).
 *
 * Files whose location lives in `url` as a Supabase signed URL — deliverable
 * versions, status reports, generated docs (resolveDeliverableUrls) — resolve
 * fine via extractStoragePath and are NOT flagged. A `!path` check alone would
 * wrongly flag all of those, since they never carry a separate `path` field.
 */
export function needsReupload(file: { path?: string; url?: string }): boolean {
  if (file.path) return false;
  const url = file.url ?? '';
  if (extractStoragePath(url)) return false;
  if (!url) return true;
  return /prod-files-secure|amazonaws\.com/i.test(url);
}

export const LEGACY_FILE_MESSAGE =
  'This is a legacy Notion attachment that was never migrated to storage. It needs to be re-uploaded before it can be opened or downloaded.';

interface DownloadableFile {
  /** Display name; also used as the saved filename. */
  name: string;
  /** Signed URL (or storage path). */
  url: string;
  /** Optional explicit storage path; preferred over extracting from `url`. */
  path?: string;
}

/**
 * `signEndpoint` is retained for backwards-compat with portal/firm callers —
 * we use it to pick which download endpoint to hit. Anything portal-ish
 * routes through the portal download endpoint (RLS-scoped); everything else
 * goes through the firm one.
 */
export async function downloadFile(
  file: DownloadableFile,
  opts: { signEndpoint?: string } = {},
): Promise<void> {
  const path = file.path || extractStoragePath(file.url);

  // No resolvable storage path. If it's a dead legacy Notion attachment, say so
  // (opening its long-dead URL just renders an S3 AccessDenied XML page).
  // Otherwise it's a genuine external/direct URL — open it as before.
  if (!path) {
    if (needsReupload(file)) {
      toast.error(LEGACY_FILE_MESSAGE, { id: 'legacy-file' });
    } else if (file.url) {
      window.open(file.url, '_blank', 'noopener,noreferrer');
    }
    return;
  }

  const downloadEndpoint = opts.signEndpoint?.includes('/portal/')
    ? '/api/portal/files/download'
    : '/api/files/download';
  const downloadUrl = `${downloadEndpoint}?path=${encodeURIComponent(path)}&name=${encodeURIComponent(file.name)}`;

  const a = document.createElement('a');
  a.href = downloadUrl;
  a.rel = 'noopener';
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
