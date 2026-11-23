import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabase } from '@/lib/supabase';
import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { isSupportedFileType } from '@/lib/ai/document-parser';
import { uploadToClaudeFiles, deleteClaudeFile, analyzeDocumentWithFile, analyzeDocument } from '@/lib/ai/claude';
import { splitPdfIntoChunks } from '@/lib/ai/pdf-splitter';
import type { AnalysisResult } from '@/lib/ai/claude';
import { markMatterArtifactsStale } from '@/lib/ai/matter-brief-refresh';
import { generateEmbeddingsForFileAnalysis } from '@/lib/ai/embeddings';
import { fetchAndExtract } from '@/lib/ai/document-parser';
import { ensureIncomingFileText } from '@/lib/ai/document-text';
import { resolveCitations } from '@/lib/juris';
import { FINALIZED_STATUSES } from '@/lib/deliverable-status';

/** Threshold above which we split PDFs before sending to Claude Files API. */
const CLAUDE_FILES_SIZE_LIMIT = 30 * 1024 * 1024; // 30MB (Claude cap is 32MB)

/** Staleness threshold: analyses stuck in 'processing' or 'pending' for longer than this are zombies. */
const STALE_THRESHOLD_MINUTES = 30;

/**
 * Clean up zombie file_analyses entries — rows stuck in 'processing' or 'pending'
 * for longer than STALE_THRESHOLD_MINUTES. These block new analyses due to the
 * partial unique index on (file_id, attachment_name) WHERE status IN ('completed', 'processing').
 *
 * Returns the number of rows cleaned up.
 */
export async function cleanupZombieAnalyses(firmId: string): Promise<number> {
  const supabase = getServiceDbForFirm(firmId);
  const cutoff = new Date(Date.now() - STALE_THRESHOLD_MINUTES * 60_000).toISOString();

  // Delete stale processing entries (stuck due to crash/timeout)
  const { data: staleProcessing } = await supabase
    .from('file_analyses')
    .delete()
    .eq('status', 'processing')
    .lt('created_at', cutoff)
    .select('id');

  // Delete stale pending entries (fire-and-forget that never started)
  const { data: stalePending } = await supabase
    .from('file_analyses')
    .delete()
    .eq('status', 'pending')
    .lt('created_at', cutoff)
    .select('id');

  const count = (staleProcessing?.length ?? 0) + (stalePending?.length ?? 0);
  if (count > 0) {
    console.log(`[auto-analyze] Cleaned up ${count} zombie analyses (${staleProcessing?.length ?? 0} processing, ${stalePending?.length ?? 0} pending)`);
  }
  return count;
}

/**
 * Fire-and-forget auto-analysis for a synced file.
 * Checks each attachment for supported types, creates pending rows, and processes in background.
 * Safe to call multiple times — skips attachments that already have an analysis.
 */
export function triggerAutoAnalysis(
  fileId: string,
  fileUrls: { name: string; url: string; path?: string }[],
  matterName: string,
  firmId: string,
): void {
  // Fire-and-forget — don't await, don't block the caller
  runAutoAnalysis(fileId, fileUrls, matterName, firmId).catch((err) => {
    console.error(`[auto-analyze] Error for file ${fileId}:`, err?.message ?? err);
  });
}

export async function runAutoAnalysis(
  fileId: string,
  fileUrls: { name: string; url: string; path?: string }[],
  matterName: string,
  firmId: string,
): Promise<void> {
  const supabase = getServiceDbForFirm(firmId);

  // Clean up any zombie entries that could block re-analysis
  await cleanupZombieAnalyses(firmId).catch(() => { /* best-effort */ });

  for (const raw of fileUrls) {
    // Resolve the URL for type checking
    const urlForCheck = raw.path
      ? raw.path // storage path has the extension
      : raw.url;

    if (!urlForCheck || !isSupportedFileType(urlForCheck)) continue;

    const attachmentName = raw.name;

    // Check if analysis already exists (completed, in-progress, or permanently failed)
    const { data: existing } = await supabase
      .from('file_analyses')
      .select('id, status, error_message')
      .eq('file_id', fileId)
      .eq('attachment_name', attachmentName)
      .in('status', ['completed', 'processing', 'pending', 'failed'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing) {
      if (existing.status !== 'failed') continue; // Already analyzed or in progress
      // Skip permanently-failed files (too large, unsupported format)
      const err = existing.error_message ?? '';
      // 'too large' is no longer permanent — we split large PDFs now.
      const isPermanent = err.includes('Unsupported file type');
      if (isPermanent) continue;
      // Transient failures — allow retry
    }

    // Resolve storage path to a fresh signed URL (storage: raw client via proxy passthrough)
    let attachmentUrl = raw.url;
    if (raw.path) {
      const { data: signData } = await supabase.storage
        .from('files')
        .createSignedUrl(raw.path, 60 * 60);
      attachmentUrl = signData?.signedUrl ?? raw.url;
    }

    if (!attachmentUrl) continue;

    // Insert pending row (analyzed_by = 'auto' for auto-triggered)
    const { data: row, error: insertError } = await supabase
      .from('file_analyses')
      .insert({
        file_id: fileId,
        attachment_name: attachmentName,
        attachment_url: attachmentUrl,
        status: 'pending',
        analyzed_by: 'auto',
      })
      .select('id')
      .single();

    if (insertError) {
      // Unique constraint violation — already exists
      if (insertError.code === '23505') continue;
      console.error(`[auto-analyze] Insert failed for ${fileId}/${attachmentName}:`, insertError.message);
      continue;
    }

    // Process in background (fire-and-forget per attachment)
    processAnalysisBackground(row.id, fileId, { name: attachmentName, url: attachmentUrl }, attachmentName, matterName, firmId).catch(
      (err) => {
        console.error(`[auto-analyze] Processing failed for ${fileId}/${attachmentName}:`, err?.message ?? err);
      },
    );
  }
}

/**
 * Background analysis processing — shared logic for both manual and auto-triggered analysis.
 * Uses Claude Files API: upload file once → analyze with file_id.
 * Falls back to cached extracted_text if available (from legacy analyses).
 */
export async function processAnalysisBackground(
  analysisId: number,
  fileId: string,
  attachment: { name: string; url: string },
  fileName: string,
  matterName: string,
  firmId: string,
): Promise<void> {
  const result = await runAnalysisOnRow(analysisId, attachment, fileName, matterName, firmId);
  if (!result) return;

  // The Files API path stores no text. Fill extracted_text (parser, then
  // Claude transcription for scans) so keyword search and text embeddings
  // cover this document; re-embeds on success. Best-effort.
  await ensureIncomingFileText(firmId, analysisId, { transcribe: true, reembed: true }).catch((err) => {
    console.error(`[auto-analyze] Text recovery failed for analysis ${analysisId}:`, err?.message ?? err);
  });

  // Side-effect: populate the parties table from extracted entities.
  // Matter is resolved via the files table.
  const supabase = getServiceDbForFirm(firmId);
  const { data: file } = await supabase
    .from('files')
    .select('matter_id')
    .eq('notion_id', fileId)
    .single();
  if (file?.matter_id) {
    extractPartiesToTable(file.matter_id, fileId, result.entities, firmId, 'file_analysis').catch((err) => {
      console.error(`[auto-analyze] Party extraction failed for ${fileId}:`, err?.message ?? err);
    });
    // New document for this matter — both brief and health are out of date.
    markMatterArtifactsStale(file.matter_id, firmId).catch(() => { /* best-effort */ });
  }
}

/**
 * Analyze a filed/sent deliverable version. Mirrors processAnalysisBackground but
 * sources from deliverable_files and resolves matter_id via the deliverable.
 */
export async function processDeliverableVersionAnalysis(
  analysisId: number,
  deliverableFileId: number,
  firmId: string,
): Promise<void> {
  const supabase = getServiceDbForFirm(firmId);

  const { data: dfRow, error: dfErr } = await supabase
    .from('deliverable_files')
    .select('id, deliverable_id, version, file_name, file_url')
    .eq('id', deliverableFileId)
    .single();

  if (dfErr || !dfRow) {
    await supabase
      .from('file_analyses')
      .update({
        status: 'failed',
        error_message: `deliverable_files row ${deliverableFileId} not found`,
        completed_at: new Date().toISOString(),
      })
      .eq('id', analysisId);
    return;
  }

  const { data: deliverable } = await supabase
    .from('deliverables')
    .select('notion_id, name, matter_id, matter_name')
    .eq('notion_id', dfRow.deliverable_id)
    .single();

  const fileName = `${deliverable?.name ?? dfRow.file_name} (v${dfRow.version})`;
  const matterName = deliverable?.matter_name ?? '';

  // `deliverable_files.file_url` has two shapes across our history:
  //  1. Bare storage path, targeting the 'files' bucket (current convention).
  //  2. Full Supabase URL like /storage/v1/object/(public|sign)/<bucket>/<path>
  //     (legacy — typically bucket='deliverable-files').
  // Always re-mint a signed URL so fetch() has a working download URL even for
  // rows written with an old or expired signed URL.
  const attachmentUrl = await resolveDeliverableFileUrl(dfRow.file_url ?? '');
  const attachment = { name: dfRow.file_name, url: attachmentUrl };

  const result = await runAnalysisOnRow(analysisId, attachment, fileName, matterName, firmId);
  if (!result) return;

  // Recover machine-readable text if the analyzed version had none — a scanned
  // PDF filing (Claude read it natively, storing only a summary) usually has a
  // DOCX version of the same document. Pull that text so the Drafting Studio's
  // full-exemplar injection + house-style profiles have the firm's real
  // language, not just a summary. Best-effort; must run BEFORE embedding so the
  // embedding includes the recovered text.
  await recoverTextFromDocxSibling(analysisId, dfRow.deliverable_id, dfRow.file_name, firmId).catch((err) => {
    console.error(`[auto-analyze] DOCX text recovery failed for analysis ${analysisId}:`, err?.message ?? err);
  });

  // Embed the analysis so this finalized filing enters the Drafting Studio's
  // exemplar pool immediately. Analysis alone does NOT create embeddings —
  // deliverable_version embeddings are otherwise only made by the admin
  // backfill — so without this a newly-filed document would never be retrieved
  // as a drafting exemplar. Best-effort: an embedding failure must not fail the
  // analysis (the row is still valid and re-embeddable).
  await generateEmbeddingsForFileAnalysis(analysisId, firmId).catch((err) => {
    console.error(`[auto-analyze] Embedding failed for deliverable_version analysis ${analysisId}:`, err?.message ?? err);
  });

  if (deliverable?.matter_id) {
    extractPartiesToTable(
      deliverable.matter_id,
      `deliverable_file:${deliverableFileId}`,
      result.entities,
      firmId,
      'deliverable_version',
    ).catch((err) => {
      console.error(`[auto-analyze] Party extraction failed for deliverable_file ${deliverableFileId}:`, err?.message ?? err);
    });
    // New outgoing filing analyzed — both brief and health are out of date.
    markMatterArtifactsStale(deliverable.matter_id, firmId).catch(() => { /* best-effort */ });
  }
}

/**
 * If a finalized deliverable's analysis has no usable extracted_text (the
 * analyzed version was a scanned PDF filing), recover text from a DOCX version
 * of the SAME deliverable and store it on the analysis row. No-op when text is
 * already present or no DOCX version exists (truly scanned-only). Mirrors the
 * one-time scripts/backfill-pdf-text.ts, but keeps the live loop self-sustaining
 * so ongoing filings feed the text-based drafting features automatically.
 */
async function recoverTextFromDocxSibling(
  analysisId: number,
  deliverableId: string,
  analyzedFileName: string | null,
  firmId: string,
): Promise<void> {
  const supabase = getServiceDbForFirm(firmId);
  const MIN_TEXT = 400;

  // Already has usable text (e.g. the analyzed version was itself a DOCX)?
  const { data: cur } = await supabase
    .from('file_analyses')
    .select('extracted_text')
    .eq('id', analysisId)
    .maybeSingle<{ extracted_text: string | null }>();
  if (cur?.extracted_text && cur.extracted_text.trim().length >= MIN_TEXT) return;

  // Find a DOCX version of the same deliverable.
  const { data: docxDf } = await supabase
    .from('deliverable_files')
    .select('file_url')
    .eq('deliverable_id', deliverableId)
    .ilike('file_name', '%.docx')
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle<{ file_url: string | null }>();
  if (!docxDf?.file_url) return;

  const url = await resolveDeliverableFileUrl(docxDf.file_url);
  const extracted = await fetchAndExtract(url);
  const text = extracted.text?.trim() ?? '';
  if (text.length < MIN_TEXT) return;

  await supabase.from('file_analyses').update({ extracted_text: text }).eq('id', analysisId);
  console.log(`[auto-analyze] Recovered ${text.length} chars from DOCX sibling for "${analyzedFileName ?? deliverableId}"`);
}

/**
 * Resolve `deliverable_files.file_url` into a working HTTPS download URL.
 * Handles three shapes we see in the column:
 *   - "<deliverable-id>/v<n>/<file>" — bare storage path, 'files' bucket (current).
 *   - "https://…/storage/v1/object/public/<bucket>/<path>" — legacy public URL.
 *   - "https://…/storage/v1/object/sign/<bucket>/<path>?token=…" — old signed URL.
 * In every case we attempt to re-sign via the correct bucket; if that fails, we fall
 * back to the original string so the downstream fetch surfaces a clear error.
 */
async function resolveDeliverableFileUrl(stored: string): Promise<string> {
  if (!stored) return stored;
  const supabase = getSupabase(); // storage-only: raw client for the handle

  // Shape 2 and 3 — extract bucket + path from a supabase storage URL.
  const match = stored.match(/\/storage\/v1\/object\/(?:public|sign)\/([^/]+)\/([^?]+)/);
  if (match) {
    const bucket = decodeURIComponent(match[1]);
    const path = decodeURIComponent(match[2]);
    const { data } = await supabase.storage.from(bucket).createSignedUrl(path, 60 * 60);
    return data?.signedUrl ?? stored;
  }

  // Shape 1 — bare path. Default bucket is 'files'.
  if (!stored.startsWith('http')) {
    const { data } = await supabase.storage.from('files').createSignedUrl(stored, 60 * 60);
    return data?.signedUrl ?? stored;
  }

  // Unknown http URL — leave as-is.
  return stored;
}

/**
 * Fire-and-forget: analyze the latest version of a deliverable iff the deliverable
 * has reached a terminal "produced and out the door" status — 'Filed or Sent out'
 * (external) or 'Acknowledged' (internal memos, which never get filed externally).
 * Idempotent — skips when the latest version already has a completed/processing/
 * pending analysis. Used both on upload (after a new version row is inserted while
 * the parent is already terminal) and on status transition into a terminal status.
 */
export function triggerDeliverableVersionAnalysisIfFinalized(deliverableId: string, firmId: string): void {
  runDeliverableVersionAnalysisIfFinalized(deliverableId, firmId).catch((err) => {
    console.error(`[auto-analyze] Deliverable ${deliverableId} version analysis trigger failed:`, err?.message ?? err);
  });
}

/**
 * Every file of a deliverable's newest version. A version can carry several
 * files — the pleading and its annexes, a DOCX and its PDF — and each one is
 * a separate document to analyse, so picking one row of the version drops the
 * rest silently.
 */
export async function getLatestVersionFiles(
  supabase: SupabaseClient,
  deliverableId: string,
): Promise<{ id: number; version: number; file_name: string; file_url: string | null }[]> {
  const { data: newest } = await supabase
    .from('deliverable_files')
    .select('version')
    .eq('deliverable_id', deliverableId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle<{ version: number }>();
  if (!newest) return [];

  const { data: files } = await supabase
    .from('deliverable_files')
    .select('id, version, file_name, file_url')
    .eq('deliverable_id', deliverableId)
    .eq('version', newest.version)
    .order('id', { ascending: true });
  return files ?? [];
}

async function runDeliverableVersionAnalysisIfFinalized(deliverableId: string, firmId: string): Promise<void> {
  const supabase = getServiceDbForFirm(firmId);

  const { data: deliverable } = await supabase
    .from('deliverables')
    .select('notion_id, status')
    .eq('notion_id', deliverableId)
    .single();

  if (!deliverable || !FINALIZED_STATUSES.includes(deliverable.status)) return;

  for (const file of await getLatestVersionFiles(supabase, deliverableId)) {
    if (!isSupportedFileType(file.file_name)) continue;
    await enqueueDeliverableFileAnalysis(supabase, file, firmId);
  }
}

async function enqueueDeliverableFileAnalysis(
  supabase: SupabaseClient,
  file: { id: number; file_name: string; file_url: string | null },
  firmId: string,
): Promise<void> {
  // Skip if already analyzed / in-flight.
  const { data: existing } = await supabase
    .from('file_analyses')
    .select('id, status, error_message')
    .eq('deliverable_file_id', file.id)
    .in('status', ['completed', 'processing', 'pending', 'failed'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing) {
    if (existing.status !== 'failed') return;
    const err = existing.error_message ?? '';
    // Permanent failures we never retry.
    if (err.includes('Unsupported file type')) return;
    if (err.startsWith('Permanent skip:')) return;
    // Transient failure — allow retry by deleting the failed row first (the partial
    // unique index on (deliverable_file_id) is scoped to completed/processing only,
    // so a 'failed' row doesn't block re-insert, but keeping it tidy avoids clutter).
    await supabase.from('file_analyses').delete().eq('id', existing.id);
  }

  // Resolve a fresh signed URL from the storage path.
  let attachmentUrl = file.file_url;
  if (file.file_url && !file.file_url.startsWith('http')) {
    const { data: signData } = await supabase.storage
      .from('files')
      .createSignedUrl(file.file_url, 60 * 60);
    if (signData?.signedUrl) attachmentUrl = signData.signedUrl;
  }

  const { data: row, error: insertError } = await supabase
    .from('file_analyses')
    .insert({
      deliverable_file_id: file.id,
      attachment_name: file.file_name,
      attachment_url: attachmentUrl,
      status: 'pending',
      analyzed_by: 'auto',
    })
    .select('id')
    .single();

  if (insertError) {
    if (insertError.code === '23505') return; // race: another call already enqueued
    console.error(`[auto-analyze] Insert failed for deliverable_file ${file.id}:`, insertError.message);
    return;
  }

  processDeliverableVersionAnalysis(row.id, file.id, firmId).catch((err) => {
    console.error(`[auto-analyze] Processing failed for deliverable_file ${file.id}:`, err?.message ?? err);
  });
}

/**
 * Core analysis loop: download → Files API / text extract → Claude → persist on the
 * given file_analyses row. Source-agnostic. Returns the AnalysisResult on success so
 * callers can run source-specific side-effects (e.g. party extraction), or null on failure.
 */
export async function runAnalysisOnRow(
  analysisId: number,
  attachment: { name: string; url: string },
  fileName: string,
  matterName: string,
  firmId: string,
): Promise<AnalysisResult | null> {
  const supabase = getServiceDbForFirm(firmId);
  let claudeFileId: string | null = null;

  try {
    // Update to processing
    await supabase
      .from('file_analyses')
      .update({ status: 'processing' })
      .eq('id', analysisId);

    // Check if we have a cached claude_file_id or extracted_text from a previous attempt
    const { data: existingRow } = await supabase
      .from('file_analyses')
      .select('claude_file_id, extracted_text')
      .eq('id', analysisId)
      .single();

    claudeFileId = existingRow?.claude_file_id ?? null;
    const cachedText = existingRow?.extracted_text ?? '';

    let extractedText = cachedText;
    let largePdfBuffer: Buffer | null = null;

    if (!claudeFileId && !extractedText) {
      // Download the file
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 60_000);
      try {
        const response = await fetch(attachment.url, { signal: controller.signal });
        if (!response.ok) throw new Error(`Download failed: ${response.status}`);
        const buffer = Buffer.from(await response.arrayBuffer());

        const ext = attachment.name.split('.').pop()?.toLowerCase() ?? '';

        if (ext === 'doc' || ext === 'docx') {
          // DOCX/DOC: extract text with mammoth, then use text-based analysis.
          // Claude Files API does not support Word documents.
          const mammoth = await import('mammoth');
          const result = await mammoth.extractRawText({ buffer });
          extractedText = (result.value ?? '')
            .replace(/\r\n/g, '\n')
            .replace(/\n{3,}/g, '\n\n')
            .trim();

          if (!extractedText || extractedText.length < 10) {
            throw new Error('Could not extract text from Word document.');
          }

          // Truncate if too long (~80k chars ≈ 25-30k tokens)
          if (extractedText.length > 80_000) {
            extractedText = extractedText.slice(0, 80_000) + '\n\n[Document truncated]';
          }

          // Cache the extracted text for potential retries
          await supabase
            .from('file_analyses')
            .update({ extracted_text: extractedText })
            .eq('id', analysisId);
        } else {
          // PDF path. Check both size (>30MB) and page count (>100) — Claude
          // rejects either. If over, split into chunks and merge results.
          let needsSplitting = buffer.length > CLAUDE_FILES_SIZE_LIMIT;
          if (!needsSplitting) {
            // Peek at page count via pdf-lib (fast — doesn't extract content)
            try {
              const { PDFDocument } = await import('pdf-lib');
              const doc = await PDFDocument.load(buffer, { ignoreEncryption: true });
              if (doc.getPageCount() > 100) needsSplitting = true;
            } catch {
              // If we can't load the PDF to count pages, try direct upload —
              // Claude will reject on its own and we'll fail cleanly.
            }
          }

          if (needsSplitting) {
            largePdfBuffer = buffer;
          } else {
            claudeFileId = await uploadToClaudeFiles({ firmId, feature: 'ai_analysis' }, buffer, attachment.name);
            await supabase
              .from('file_analyses')
              .update({ claude_file_id: claudeFileId })
              .eq('id', analysisId);
          }
        }
      } finally {
        clearTimeout(timer);
      }
    }

    // Analyze with Claude. For large PDFs, split + analyze + merge.
    let result: AnalysisResult;
    if (largePdfBuffer) {
      result = await analyzeLargePdfInChunks(
        firmId,
        largePdfBuffer,
        attachment.name,
        fileName,
        matterName,
      );
    } else if (claudeFileId) {
      result = await analyzeDocumentWithFile({ firmId, feature: 'ai_analysis' }, claudeFileId, fileName, matterName);
    } else {
      result = await analyzeDocument({ firmId, feature: 'ai_analysis' }, extractedText, fileName, matterName);
    }

    // Verify PH citations against juris.ph — adds links for real authorities
    // and flags citations its index doesn't know. Best-effort: an outage
    // resolves to nothing and the analysis completes without it.
    if (result.entities) {
      const citationSource = [
        ...(result.entities.caseReferences ?? []),
        result.summary ?? '',
        extractedText,
      ].join('\n');
      const resolvedCitations = await resolveCitations(citationSource);
      if (resolvedCitations.length) result.entities.resolvedCitations = resolvedCitations;
    }

    // Store results
    await supabase
      .from('file_analyses')
      .update({
        status: 'completed',
        summary: result.summary,
        short_summary: result.shortSummary,
        entities: result.entities,
        token_count_input: result.inputTokens,
        token_count_output: result.outputTokens,
        model_used: result.model,
        completed_at: new Date().toISOString(),
      })
      .eq('id', analysisId);

    // Embeddings are generated automatically via the on_analysis_completed DB trigger.

    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Analysis failed';
    console.error(`[auto-analyze] Error for analysis ${analysisId}:`, message);

    await supabase
      .from('file_analyses')
      .update({
        status: 'failed',
        error_message: message,
        completed_at: new Date().toISOString(),
      })
      .eq('id', analysisId);
    return null;
  }
  // Claude Files API upload is intentionally NOT deleted — claude_file_id
  // is persisted to file_analyses for downstream reuse (e.g. status-report
  // drafting). Deleting it here would orphan the cache and cause future
  // requests to 404. Claude's TTL + the periodic cleanupDuplicateClaudeFiles
  // task handle long-term cleanup.
}

/**
 * Analyze a PDF that exceeds the Claude Files API size limit by splitting
 * it into page-range chunks, analyzing each chunk separately, and merging
 * the results into a single `AnalysisResult`.
 *
 * Merge strategy:
 * - summaries: concatenate with a page-range header
 * - shortSummary: take the first chunk's (it covers the lead pages)
 * - entities: union parties/dates/deadlines/obligations/caseReferences,
 *             deduplicate by a normalized key
 * - documentType/jurisdiction: take first non-empty
 * - tokens: sum across chunks
 */
async function analyzeLargePdfInChunks(
  firmId: string,
  buffer: Buffer,
  attachmentName: string,
  fileName: string,
  matterName: string,
): Promise<AnalysisResult> {
  console.log(
    `[auto-analyze] Splitting large PDF ${attachmentName} (${(buffer.length / 1024 / 1024).toFixed(1)}MB)`,
  );

  const chunks = await splitPdfIntoChunks(buffer);
  if (chunks.length === 0) {
    throw new Error('PDF has no pages to analyze.');
  }

  console.log(`[auto-analyze] Split into ${chunks.length} chunks`);

  const chunkResults: AnalysisResult[] = [];
  const chunkFileIds: string[] = [];

  try {
    for (const [i, chunk] of chunks.entries()) {
      const chunkName = `${attachmentName} [pages ${chunk.firstPage}-${chunk.lastPage}]`;
      const fid = await uploadToClaudeFiles({ firmId, feature: 'ai_analysis' }, chunk.buffer, chunkName);
      chunkFileIds.push(fid);

      const chunkFileName = `${fileName} (pages ${chunk.firstPage}-${chunk.lastPage} of ${chunks[chunks.length - 1].lastPage})`;
      const result = await analyzeDocumentWithFile({ firmId, feature: 'ai_analysis' }, fid, chunkFileName, matterName);
      chunkResults.push(result);
      console.log(`[auto-analyze] Chunk ${i + 1}/${chunks.length} analyzed`);
    }
  } finally {
    // Clean up Claude Files uploads
    for (const fid of chunkFileIds) {
      deleteClaudeFile({ firmId, feature: 'ai_analysis' }, fid).catch(() => { /* ignore */ });
    }
  }

  // ── Merge chunk results ──
  const summary = chunkResults
    .map((r, i) => `[Pages ${chunks[i].firstPage}-${chunks[i].lastPage}]\n${r.summary}`)
    .join('\n\n');

  const shortSummary = chunkResults[0]?.shortSummary ?? '';

  // Union entities, deduplicating by normalized key
  const parties = dedupeBy(
    chunkResults.flatMap((r) => r.entities?.parties ?? []),
    (p) => `${p.name?.toLowerCase().trim()}::${p.role?.toLowerCase().trim()}`,
  );
  const dates = dedupeBy(
    chunkResults.flatMap((r) => r.entities?.dates ?? []),
    (d) => `${d.date}::${d.description?.toLowerCase().trim()}`,
  );
  const deadlines = dedupeBy(
    chunkResults.flatMap((r) => r.entities?.deadlines ?? []),
    (d) => `${d.date}::${d.description?.toLowerCase().trim()}`,
  );
  const obligations = dedupeBy(
    chunkResults.flatMap((r) => r.entities?.obligations ?? []),
    (o) => `${o.party?.toLowerCase().trim()}::${o.description?.toLowerCase().trim()}`,
  );
  const caseReferences = Array.from(
    new Set(chunkResults.flatMap((r) => r.entities?.caseReferences ?? [])),
  );
  const documentType =
    chunkResults.map((r) => r.entities?.documentType).find((t) => !!t) ?? '';
  const jurisdiction =
    chunkResults.map((r) => r.entities?.jurisdiction).find((j) => !!j) ?? '';

  return {
    summary,
    shortSummary,
    entities: {
      parties,
      dates,
      deadlines,
      obligations,
      caseReferences,
      documentType,
      jurisdiction,
    },
    inputTokens: chunkResults.reduce((a, r) => a + (r.inputTokens ?? 0), 0),
    outputTokens: chunkResults.reduce((a, r) => a + (r.outputTokens ?? 0), 0),
    model: chunkResults[0]?.model ?? '',
  };
}

function dedupeBy<T>(items: T[], keyFn: (t: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const key = keyFn(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

/**
 * Extract parties from analysis entities and insert into the parties table.
 * Source-agnostic: caller resolves matter_id and provides a source_ref that
 * identifies where the parties came from (file notion_id, deliverable_file key, etc.).
 * Maps AI-extracted roles to our party_role enum. Deduplicates by name+role per matter.
 */
export async function extractPartiesToTable(
  matterId: string,
  sourceRef: string,
  entities: { parties?: { name: string; role: string }[] },
  firmId: string,
  source: string = 'file_analysis',
): Promise<void> {
  if (!entities?.parties?.length) return;
  if (!matterId) return;

  const supabase = getServiceDbForFirm(firmId);

  // Map AI roles to our party_role enum
  const roleMap: Record<string, string> = {
    plaintiff: 'opposing_party',
    defendant: 'opposing_party',
    petitioner: 'client', // often our client
    respondent: 'opposing_party',
    counsel: 'co-counsel',
    judge: 'interested_party',
    witness: 'witness',
    other: 'interested_party',
  };

  // Get existing parties for this matter to avoid duplicates
  const { data: existingParties } = await supabase
    .from('parties')
    .select('party_name, party_role')
    .eq('matter_id', matterId);

  const existingSet = new Set(
    (existingParties ?? []).map((p) => `${p.party_name.toLowerCase().trim()}::${p.party_role}`),
  );

  // Also get the client name to avoid adding them as opposing party
  const { data: matter } = await supabase
    .from('matters')
    .select('client_name')
    .eq('notion_id', matterId)
    .single();

  const clientNameLower = (matter?.client_name ?? '').toLowerCase().trim();

  const toInsert: {
    matter_id: string;
    party_name: string;
    party_role: string;
    entity_type: string;
    source: string;
    source_ref: string;
  }[] = [];

  for (const party of entities.parties) {
    if (!party.name?.trim()) continue;

    const partyNameTrimmed = party.name.trim();
    const partyRole = roleMap[party.role?.toLowerCase()] ?? 'interested_party';

    // Skip if it's the client themselves (avoid duplicating the auto-created client party)
    if (partyNameTrimmed.toLowerCase() === clientNameLower) continue;

    // Skip if already exists
    const key = `${partyNameTrimmed.toLowerCase()}::${partyRole}`;
    if (existingSet.has(key)) continue;
    existingSet.add(key);

    toInsert.push({
      matter_id: matterId,
      party_name: partyNameTrimmed,
      party_role: partyRole,
      entity_type: 'individual', // default; could be refined with AI
      source,
      source_ref: sourceRef,
    });
  }

  if (toInsert.length > 0) {
    const { error } = await supabase.from('parties').insert(toInsert);
    if (error) {
      console.error(`[auto-analyze] Party insert failed for matter ${matterId}:`, error.message);
    } else {
      console.log(`[auto-analyze] Extracted ${toInsert.length} parties for matter ${matterId}`);
    }
  }
}
