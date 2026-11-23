/**
 * Client-side helper for uploading a file to a Supabase Storage signed upload URL.
 *
 * Wraps the native fetch PUT so every deliverable-submission upload gets the same
 * rich error surface:
 *   - On HTTP 4xx/5xx: reads the response body and throws a descriptive error.
 *   - On fetch rejection (Safari "Load failed", CORS, DNS, offline):
 *     catches the opaque error and re-throws with file context plus the most
 *     likely causes so the user can act on it.
 *   - Transient failures (network drops, 408/429/5xx) are retried with backoff
 *     and a visible sonner toast so a momentary Wi-Fi blip doesn't abort the
 *     whole submission. Non-retryable 4xx failures throw immediately.
 *
 * Used by:
 *   - components/DeliverableActionButtons.tsx         (action submit)
 *   - components/detail/LatestSubmissionCard.tsx      (quick submission)
 *   - components/detail/DeliverableVersionHistory.tsx (replace / add)
 *
 * `commitUpload` covers the second hop — the Phase-2 "confirm" POST that records
 * the deliverable_files rows. It is sent with keepalive (so a tab navigating
 * away mid-submit still delivers the commit) and retried on transient failures,
 * because a dropped commit leaves the just-uploaded object orphaned: present in
 * Storage but with no row, so it's invisible *and* un-replaceable. The server
 * commit is idempotent (unique index on deliverable_id+version+file_url), so a
 * resend can never duplicate a row.
 */

import { toast } from 'sonner';

export interface UploadableFile {
  name: string;
  size: number;
  type: string;
}

export class UploadError extends Error {
  fileName: string;
  fileType: string;
  fileSize: number;
  httpStatus?: number;
  responseBody?: string;
  isNetworkFailure: boolean;

  constructor(opts: {
    message: string;
    fileName: string;
    fileType: string;
    fileSize: number;
    httpStatus?: number;
    responseBody?: string;
    isNetworkFailure?: boolean;
  }) {
    super(opts.message);
    this.name = 'UploadError';
    this.fileName = opts.fileName;
    this.fileType = opts.fileType;
    this.fileSize = opts.fileSize;
    this.httpStatus = opts.httpStatus;
    this.responseBody = opts.responseBody;
    this.isNetworkFailure = opts.isNetworkFailure ?? false;
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const MAX_ATTEMPTS = 3;
const RETRY_BASE_MS = 1000;
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

function backoffDelay(attempt: number): number {
  const base = RETRY_BASE_MS * 2 ** (attempt - 1);
  const jitter = base * (Math.random() * 0.6 - 0.3);
  return Math.max(250, Math.round(base + jitter));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function attemptUpload(
  signedUrl: string,
  file: File | Blob,
  meta: UploadableFile,
  contentType: string,
): Promise<UploadError | null> {
  let res: Response;
  try {
    res = await fetch(signedUrl, {
      method: 'PUT',
      headers: { 'Content-Type': contentType },
      body: file,
    });
  } catch (netErr) {
    // fetch() rejected before getting a response — Safari surfaces this as "Load failed".
    // Most common causes: CORS preflight rejected by Storage, bucket MIME allowlist
    // mismatch (response lacks CORS headers so the browser treats it as a network error),
    // offline/DNS, or the tab was backgrounded long enough to drop the connection.
    const base = netErr instanceof Error ? netErr.message : String(netErr);
    const hint =
      `Upload of "${meta.name}" (${formatSize(meta.size)}, ${contentType || 'no MIME type'}) ` +
      `could not reach the storage server. This is usually caused by:\n` +
      `  • The file's MIME type not being on the bucket allowlist\n` +
      `  • A CORS preflight being rejected\n` +
      `  • Network loss or VPN interference\n` +
      `Underlying error: ${base}`;
    console.error('[upload] Network failure', {
      fileName: meta.name,
      fileType: contentType,
      fileSize: meta.size,
      signedUrl: signedUrl.slice(0, 120) + '…',
      error: netErr,
    });
    return new UploadError({
      message: hint,
      fileName: meta.name,
      fileType: contentType,
      fileSize: meta.size,
      isNetworkFailure: true,
    });
  }

  if (!res.ok) {
    // Read the response body so we can see Supabase Storage's actual error
    // (e.g. mime type not supported, payload too large, object already exists).
    let bodyText = '';
    try {
      bodyText = await res.text();
    } catch {
      /* ignore */
    }
    const snippet = bodyText.slice(0, 500);
    const message =
      `Upload of "${meta.name}" (${formatSize(meta.size)}, ${contentType}) ` +
      `rejected by storage with HTTP ${res.status}${snippet ? `: ${snippet}` : ''}`;
    console.error('[upload] HTTP failure', {
      fileName: meta.name,
      fileType: contentType,
      fileSize: meta.size,
      httpStatus: res.status,
      responseBody: snippet,
    });
    return new UploadError({
      message,
      fileName: meta.name,
      fileType: contentType,
      fileSize: meta.size,
      httpStatus: res.status,
      responseBody: snippet,
    });
  }

  return null;
}

function isRetryable(err: UploadError): boolean {
  if (err.isNetworkFailure) return true;
  if (err.httpStatus !== undefined && RETRYABLE_STATUS.has(err.httpStatus)) return true;
  return false;
}

/**
 * PUT `file` to `signedUrl`. Retries transient failures with backoff and shows
 * a sonner toast while retrying. Throws an `UploadError` with full context if
 * every attempt fails or on non-retryable errors.
 */
export async function uploadToSignedUrl(
  signedUrl: string,
  file: File | Blob,
  meta: UploadableFile,
): Promise<void> {
  const contentType = meta.type || 'application/octet-stream';
  const toastId = `upload-retry-${meta.name}-${meta.size}`;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const err = await attemptUpload(signedUrl, file, meta, contentType);
    if (!err) {
      toast.dismiss(toastId);
      return;
    }

    const canRetry = attempt < MAX_ATTEMPTS && isRetryable(err);
    if (!canRetry) {
      toast.dismiss(toastId);
      throw err;
    }

    const delay = backoffDelay(attempt);
    const nextAttempt = attempt + 1;
    toast.loading(
      `Network hiccup uploading "${meta.name}" — retrying (${nextAttempt}/${MAX_ATTEMPTS})…`,
      { id: toastId, duration: delay + 5000 },
    );
    console.warn('[upload] Retrying after transient failure', {
      fileName: meta.name,
      attempt,
      nextAttempt,
      delayMs: delay,
      reason: err.isNetworkFailure ? 'network' : `http_${err.httpStatus}`,
    });
    await sleep(delay);
  }
}

const COMMIT_MAX_ATTEMPTS = 4;
const COMMIT_RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

/**
 * POST the Phase-2 "confirm" payload that commits deliverable_files rows after a
 * direct-to-storage upload. Retries transient failures (network rejection,
 * 408/429/5xx) with backoff and rides keepalive so an in-flight commit survives
 * the page being torn down. Throws on a terminal 4xx (auth, validation) or once
 * all attempts are exhausted; the message is the server's `error` when present.
 *
 * Bodies are small JSON (a list of {storagePath,name,size}), well under the 64KB
 * keepalive cap; the guard downgrades keepalive only for the rare oversized case.
 */
export async function commitUpload<T = unknown>(url: string, body: unknown): Promise<T> {
  const payload = JSON.stringify(body);
  const useKeepalive = payload.length < 60_000;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= COMMIT_MAX_ATTEMPTS; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        keepalive: useKeepalive,
      });
    } catch (netErr) {
      // fetch() rejected before a response (offline, connection dropped as the
      // tab tore down) — always retryable.
      lastError = netErr instanceof Error ? netErr : new Error(String(netErr));
      if (attempt < COMMIT_MAX_ATTEMPTS) {
        await sleep(backoffDelay(attempt));
        continue;
      }
      break;
    }

    if (res.ok) {
      return (await res.json().catch(() => ({}))) as T;
    }

    const errData = await res.json().catch(() => ({} as { error?: string }));
    lastError = new Error(errData.error || `Commit failed (HTTP ${res.status})`);

    const retryable = COMMIT_RETRYABLE_STATUS.has(res.status);
    if (!retryable || attempt === COMMIT_MAX_ATTEMPTS) {
      throw lastError;
    }
    console.warn('[upload] Retrying commit after transient failure', {
      url,
      attempt,
      nextAttempt: attempt + 1,
      httpStatus: res.status,
    });
    await sleep(backoffDelay(attempt));
  }

  throw lastError ?? new Error('Commit failed');
}
