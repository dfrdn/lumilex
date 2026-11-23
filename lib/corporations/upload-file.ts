import { uploadToSignedUrl, commitUpload } from '@/lib/upload';
import type { CorporationFile, CorporationFileCategory } from '@/types/corporations';
import type { DocumentExtraction } from '@/lib/ai/corporation-doc-extract';

export interface CorRegistrationOutcome {
  result: 'applied' | 'needs_review' | 'unreadable';
  reason?: string;
  extraction?: DocumentExtraction;
  // Typed loosely here so this module stays importable from anywhere without
  // dragging the Corporation shape through every caller.
  corporation?: unknown;
}

export interface CorporationUploadResult {
  file: CorporationFile;
  registration?: CorRegistrationOutcome;
}

/**
 * Upload a file against a corporation, browser-to-storage.
 *
 * Phase 1 mints a signed URL, the browser PUTs the bytes straight to Supabase
 * Storage, phase 2 records the row. The bytes never traverse the API route,
 * which is what lifts the 4.5MB Vercel request-body cap that was failing
 * scanned CORs, permits and BIR certificates.
 *
 * Throws on failure with the server's message where there is one — callers
 * surface it rather than showing a bare "Upload failed".
 */
export async function uploadCorporationFile(
  corporationId: string,
  category: CorporationFileCategory,
  file: File,
  personId?: number | null,
  filingYear?: number | null,
): Promise<CorporationUploadResult> {
  const endpoint = `/api/corporation/${corporationId}/files`;

  const prepRes = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: file.name, category, personId: personId ?? null }),
  });
  const prep = await prepRes.json().catch(() => ({}));
  if (!prepRes.ok || !prep?.signedUrl) {
    throw new Error(prep?.error || 'Could not start the upload.');
  }

  await uploadToSignedUrl(prep.signedUrl, file, {
    name: file.name,
    size: file.size,
    type: file.type,
  });

  return commitUpload<CorporationUploadResult>(endpoint, {
    commit: true,
    category,
    personId: personId ?? null,
    storagePath: prep.storagePath,
    name: file.name,
    sizeBytes: file.size,
    mimeType: file.type || null,
    filingYear: filingYear ?? null,
  });
}

export type MeetingFileSlot = 'notice' | 'waiver' | 'proxy' | 'attendance' | 'recording' | 'minutes';

/**
 * Upload a meeting-scoped file, browser-to-storage. Same two-phase shape as
 * uploadCorporationFile — attendance sheets and recordings are exactly the
 * files that used to blow past Vercel's 4.5MB request-body cap.
 *
 * Returns the updated meeting row.
 */
export async function uploadMeetingFile<T = unknown>(
  corporationId: string,
  meetingId: string | number,
  slot: MeetingFileSlot,
  file: File,
): Promise<T> {
  const endpoint = `/api/corporation/${corporationId}/meetings/${meetingId}/files`;

  const prepRes = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: file.name, slot }),
  });
  const prep = await prepRes.json().catch(() => ({}));
  if (!prepRes.ok || !prep?.signedUrl) {
    throw new Error(prep?.error || 'Could not start the upload.');
  }

  await uploadToSignedUrl(prep.signedUrl, file, {
    name: file.name,
    size: file.size,
    type: file.type,
  });

  return commitUpload<T>(endpoint, {
    commit: true,
    slot,
    storagePath: prep.storagePath,
    name: file.name,
  });
}

/**
 * Upload a trademark file, browser-to-storage. Same two-phase shape; the route
 * declares a 25MB ceiling that only became reachable once the bytes stopped
 * going through the serverless function.
 */
export async function uploadTrademarkFile<T = unknown>(trademarkId: string, file: File): Promise<T> {
  const endpoint = `/api/trademark/${trademarkId}/files`;

  const prepRes = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: file.name, size: file.size }),
  });
  const prep = await prepRes.json().catch(() => ({}));
  if (!prepRes.ok || !prep?.signedUrl) {
    throw new Error(prep?.error || 'Could not start the upload.');
  }

  await uploadToSignedUrl(prep.signedUrl, file, {
    name: file.name,
    size: file.size,
    type: file.type,
  });

  return commitUpload<T>(endpoint, {
    commit: true,
    storagePath: prep.storagePath,
    name: file.name,
    size: file.size,
    mimeType: file.type || null,
  });
}

/**
 * Generic two-phase upload for routes that mint a signed URL from a JSON
 * metadata payload and commit with `{ commit: true, storagePath }`.
 *
 * `extra` is merged into both phases — routes that key the storage path off
 * something other than the file (a template id, a trademark) need it in phase 1
 * to build the path and in phase 2 to re-derive and verify it.
 */
export async function uploadViaSignedUrl<T = unknown>(
  endpoint: string,
  file: File,
  extra: Record<string, unknown> = {},
): Promise<T> {
  const prepRes = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...extra, name: file.name, size: file.size }),
  });
  const prep = await prepRes.json().catch(() => ({}));
  if (!prepRes.ok || !prep?.signedUrl) {
    throw new Error(prep?.error || 'Could not start the upload.');
  }

  await uploadToSignedUrl(prep.signedUrl, file, {
    name: file.name,
    size: file.size,
    type: file.type,
  });

  return commitUpload<T>(endpoint, {
    ...extra,
    commit: true,
    storagePath: prep.storagePath,
    name: file.name,
    size: file.size,
    mimeType: file.type || null,
  });
}
