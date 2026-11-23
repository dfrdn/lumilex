// ── Content types for stored files ───────────────────────────────────
//
// Storage serves an object with the content type it was uploaded under, and
// browsers refuse to render `application/octet-stream` inline — they download
// it instead, whatever Content-Disposition says. So a wrong type here doesn't
// fail loudly; it quietly turns "Preview" into "Download".

/** Extensions the firm actually exchanges: court PDFs, pleadings, workbooks, scans. */
const BY_EXTENSION: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  txt: 'text/plain',
  csv: 'text/csv',
  zip: 'application/zip',
};

export const FALLBACK_CONTENT_TYPE = 'application/octet-stream';

/** A declared type that tells us nothing — treat it as absent. */
function isUnspecific(declared: string | null | undefined): boolean {
  if (!declared) return true;
  const t = declared.split(';')[0].trim().toLowerCase();
  return t === '' || t === FALLBACK_CONTENT_TYPE || t === 'binary/octet-stream';
}

/**
 * Best content type for a stored file.
 *
 * Prefers what the source declared (Microsoft Graph reports the real type for
 * most mail attachments) and falls back to the extension when the sender left
 * it generic — which roughly one attachment in ten does.
 */
export function contentTypeFor(fileName: string, declared?: string | null): string {
  if (!isUnspecific(declared)) return declared!.trim();

  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  return BY_EXTENSION[ext] ?? FALLBACK_CONTENT_TYPE;
}
