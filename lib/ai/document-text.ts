import { getServiceDbForFirm } from '@/lib/tenancy/service-db';
import { isFeatureAvailable } from '@/lib/firm/features';
import { fetchAndExtract } from '@/lib/ai/document-parser';
import { uploadToClaudeFiles, transcribeDocumentWithFile } from '@/lib/ai/claude';
import { generateEmbeddingsForFileAnalysis } from '@/lib/ai/embeddings';

/**
 * Text recovery for incoming files.
 *
 * Analysis reads a PDF through the Claude Files API, so the model sees the
 * document but nothing writes its text back to `file_analyses.extracted_text`.
 * Keyword search and text-based embeddings read that column, so this fills
 * it: the local parser first (free, and no content leaves the firm), then
 * Claude transcribing the scan when the parser finds no text layer — under
 * the firm's `ai_analysis` consent, like the analysis itself.
 */

/** Below this many characters the text isn't worth indexing (a cover page, a stamp). */
export const MIN_USABLE_TEXT = 200;
const MAX_TEXT_LENGTH = 80_000;

export type TextOutcome = 'skipped' | 'parsed' | 'transcribed' | 'empty' | 'error';

export interface StoredFileUrl {
  name?: string;
  url?: string;
  path?: string;
}

/**
 * Find the attachment an analysis row refers to inside `files.file_urls`.
 * Exact name first, then a case-insensitive basename match, then the only
 * attachment when there is just one.
 */
export function pickAttachment(fileUrls: unknown, attachmentName: string): StoredFileUrl | null {
  if (!Array.isArray(fileUrls)) return null;
  const list = fileUrls.filter((u): u is StoredFileUrl => !!u && typeof u === 'object');
  if (list.length === 0) return null;

  const exact = list.find((u) => u.name === attachmentName);
  if (exact) return exact;

  const base = (s: string) => s.split('/').pop()?.toLowerCase() ?? '';
  const want = base(attachmentName);
  const loose = list.find((u) => base(u.name ?? '') === want || base(u.path ?? '') === want);
  if (loose) return loose;

  return list.length === 1 ? list[0] : null;
}

function isPdf(name: string): boolean {
  return name.split('?')[0].toLowerCase().endsWith('.pdf');
}

export interface EnsureTextResult {
  outcome: TextOutcome;
  chars: number;
  error?: string;
  /** Claude usage when the text came from transcription. */
  tokens?: { input: number; output: number };
}

/**
 * Fill `extracted_text` for one incoming-file analysis. Idempotent: a row
 * that already has usable text is skipped. Transcription needs the firm's
 * `ai_analysis`; re-embedding runs only when the firm keeps vectors at all
 * (`ai_search`) — a firm without it has none, so there is nothing to refresh.
 */
export async function ensureIncomingFileText(
  firmId: string,
  analysisId: number,
  opts: { transcribe?: boolean; reembed?: boolean } = {},
): Promise<EnsureTextResult> {
  const transcribe = opts.transcribe ?? true;
  const reembed = opts.reembed ?? true;
  const supabase = getServiceDbForFirm(firmId);

  const { data: row, error: rowErr } = await supabase
    .from('file_analyses')
    .select('id, file_id, attachment_name, claude_file_id, extracted_text')
    .eq('id', analysisId)
    .maybeSingle();
  if (rowErr || !row) return { outcome: 'error', chars: 0, error: rowErr?.message ?? 'analysis not found' };
  if (!row.file_id) return { outcome: 'skipped', chars: 0 };
  if (row.extracted_text && row.extracted_text.trim().length >= MIN_USABLE_TEXT) {
    return { outcome: 'skipped', chars: row.extracted_text.length };
  }

  const { data: file } = await supabase
    .from('files')
    .select('file_urls')
    .eq('notion_id', row.file_id)
    .maybeSingle();
  let raw: unknown = file?.file_urls;
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch { raw = null; }
  }
  const attachment = pickAttachment(raw, row.attachment_name ?? '');
  if (!attachment) return { outcome: 'error', chars: 0, error: 'attachment not found on file' };

  // The path comes from the firm's own files row, as it does for the analysis.
  let url = attachment.url ?? '';
  if (attachment.path) {
    const { data: signed } = await supabase.storage.from('files').createSignedUrl(attachment.path, 60 * 60);
    url = signed?.signedUrl ?? url;
  }
  if (!url) return { outcome: 'error', chars: 0, error: 'no download url' };

  const store = async (text: string, source: 'parser' | 'transcription') => {
    const trimmed = text.length > MAX_TEXT_LENGTH ? text.slice(0, MAX_TEXT_LENGTH) + '\n\n[Document truncated]' : text;
    await supabase
      .from('file_analyses')
      .update({ extracted_text: trimmed, extracted_text_source: source })
      .eq('id', analysisId);
    if (reembed && (await isFeatureAvailable(firmId, 'ai_search'))) {
      await generateEmbeddingsForFileAnalysis(analysisId, firmId).catch((err) => {
        console.error(`[document-text] Re-embed failed for analysis ${analysisId}:`, err?.message ?? err);
      });
    }
    return trimmed.length;
  };

  let extracted;
  try {
    extracted = await fetchAndExtract(url);
  } catch (err) {
    return { outcome: 'error', chars: 0, error: err instanceof Error ? err.message : String(err) };
  }

  const parsed = extracted.text?.trim() ?? '';
  if (parsed.length >= MIN_USABLE_TEXT) {
    return { outcome: 'parsed', chars: await store(parsed, 'parser') };
  }

  const name = attachment.name ?? row.attachment_name ?? 'document.pdf';
  if (!transcribe || !isPdf(name)) return { outcome: 'empty', chars: parsed.length };
  if (!(await isFeatureAvailable(firmId, 'ai_analysis'))) return { outcome: 'empty', chars: parsed.length };

  const ctx = { firmId, feature: 'ai_analysis' as const };
  try {
    let claudeFileId = row.claude_file_id as string | null;
    if (!claudeFileId) {
      if (!extracted.pdfBuffer) return { outcome: 'empty', chars: parsed.length };
      claudeFileId = await uploadToClaudeFiles(ctx, extracted.pdfBuffer, name);
      await supabase.from('file_analyses').update({ claude_file_id: claudeFileId }).eq('id', analysisId);
    }
    const { text, inputTokens, outputTokens } = await transcribeDocumentWithFile(ctx, claudeFileId, name);
    const tokens = { input: inputTokens, output: outputTokens };
    const clean = text.trim();
    if (clean.length < MIN_USABLE_TEXT) return { outcome: 'empty', chars: clean.length, tokens };
    return { outcome: 'transcribed', chars: await store(clean, 'transcription'), tokens };
  } catch (err) {
    return { outcome: 'error', chars: 0, error: err instanceof Error ? err.message : String(err) };
  }
}
