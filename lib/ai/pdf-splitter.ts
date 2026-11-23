// ── PDF Splitter ────────────────────────────────────────────────
// Splits a large PDF into chunks under a given byte limit so each
// chunk fits under Claude Files API's 32MB cap.
//
// Used by auto-analyze for files >32MB: each chunk gets uploaded to
// Claude separately, analyzed, and the results are merged.

import { PDFDocument } from 'pdf-lib';

/** Target chunk size — stays under the 32MB Claude Files API cap. */
const DEFAULT_MAX_CHUNK_BYTES = 25 * 1024 * 1024; // 25MB

/** Max pages per chunk — Claude Files API rejects PDFs with >100 pages. */
const DEFAULT_MAX_CHUNK_PAGES = 90;

export interface PdfChunk {
  /** 1-indexed page range covered by this chunk (inclusive). */
  firstPage: number;
  lastPage: number;
  /** The chunk's serialized PDF bytes. */
  buffer: Buffer;
}

/**
 * Split a PDF buffer into chunks each under `maxBytes`.
 *
 * Strategy: estimate a conservative pages-per-chunk from the PDF's
 * average page size, then verify by serializing. If a chunk overshoots,
 * halve and retry. Single-page PDFs larger than maxBytes are returned
 * as-is (callers should treat that as a permanent failure).
 */
export async function splitPdfIntoChunks(
  buffer: Buffer,
  maxBytes: number = DEFAULT_MAX_CHUNK_BYTES,
  maxPages: number = DEFAULT_MAX_CHUNK_PAGES,
): Promise<PdfChunk[]> {
  const src = await PDFDocument.load(buffer, { ignoreEncryption: true });
  const totalPages = src.getPageCount();

  if (totalPages === 0) return [];

  // Rough starting guess: assume uniform page size. Cap at maxPages so we
  // never overshoot Claude Files API's 100-page limit.
  const avgPageBytes = buffer.length / totalPages;
  const guessPagesPerChunk = Math.min(
    maxPages,
    Math.max(1, Math.floor(maxBytes / avgPageBytes)),
  );

  const chunks: PdfChunk[] = [];
  let cursor = 0;

  while (cursor < totalPages) {
    let take = Math.min(guessPagesPerChunk, totalPages - cursor);
    let chunkBuffer: Buffer | null = null;

    // Try the guess; if it overshoots maxBytes, halve until it fits
    // or until we're down to a single page.
    while (take >= 1) {
      const chunk = await PDFDocument.create();
      const indices = Array.from({ length: take }, (_, i) => cursor + i);
      const copied = await chunk.copyPages(src, indices);
      for (const page of copied) chunk.addPage(page);

      const bytes = Buffer.from(await chunk.save());

      if (bytes.length <= maxBytes || take === 1) {
        chunkBuffer = bytes;
        break;
      }

      take = Math.max(1, Math.floor(take / 2));
    }

    if (!chunkBuffer) {
      throw new Error('splitPdfIntoChunks: failed to produce a valid chunk');
    }

    chunks.push({
      firstPage: cursor + 1,
      lastPage: cursor + take,
      buffer: chunkBuffer,
    });

    cursor += take;
  }

  return chunks;
}
