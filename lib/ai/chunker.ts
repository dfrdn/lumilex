// ── Text Chunker for Embeddings ──────────────────────────────────────
// Splits text into ~500-token chunks on natural boundaries

const DEFAULT_MAX_CHARS = 2000; // ~500 tokens for English/legal text
const OVERLAP_CHARS = 100; // overlap between consecutive chunks

export interface TextChunk {
  index: number;
  text: string;
}

/**
 * Split text into chunks suitable for embedding.
 *
 * Strategy:
 * 1. Split on paragraph boundaries (\n\n)
 * 2. If a paragraph exceeds maxChars, split on sentence boundaries
 * 3. Merge small consecutive paragraphs into a single chunk
 * 4. Add overlap between chunks for context continuity
 */
export function chunkText(
  text: string,
  maxChars: number = DEFAULT_MAX_CHARS,
): TextChunk[] {
  if (!text || text.trim().length === 0) return [];

  const cleaned = text.replace(/\r\n/g, '\n').trim();

  // If text is short enough, return as single chunk
  if (cleaned.length <= maxChars) {
    return [{ index: 0, text: cleaned }];
  }

  // Split into paragraphs
  const paragraphs = cleaned
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  // Split oversized paragraphs into sentences
  const segments: string[] = [];
  for (const para of paragraphs) {
    if (para.length <= maxChars) {
      segments.push(para);
    } else {
      // Split on sentence boundaries
      const sentences = splitIntoSentences(para);
      segments.push(...sentences);
    }
  }

  // Merge segments into chunks up to maxChars
  const chunks: TextChunk[] = [];
  let currentText = '';
  let chunkIndex = 0;

  for (const segment of segments) {
    const separator = currentText ? '\n\n' : '';
    const combined = currentText + separator + segment;

    if (combined.length > maxChars && currentText.length > 0) {
      // Flush current chunk
      chunks.push({ index: chunkIndex++, text: currentText.trim() });

      // Start new chunk with overlap from end of previous
      const overlapText = getOverlapFromEnd(currentText, OVERLAP_CHARS);
      currentText = overlapText ? overlapText + '\n\n' + segment : segment;
    } else {
      currentText = combined;
    }
  }

  // Flush remaining text
  if (currentText.trim().length > 0) {
    chunks.push({ index: chunkIndex, text: currentText.trim() });
  }

  return chunks;
}

/**
 * Split a long paragraph into sentences.
 */
function splitIntoSentences(text: string): string[] {
  // Match sentence-ending punctuation followed by space or end
  const sentenceBreaks = text.split(/(?<=[.!?])\s+/);
  const sentences: string[] = [];
  let current = '';

  for (const piece of sentenceBreaks) {
    if (current.length + piece.length + 1 > DEFAULT_MAX_CHARS && current.length > 0) {
      sentences.push(current.trim());
      current = piece;
    } else {
      current = current ? current + ' ' + piece : piece;
    }
  }

  if (current.trim().length > 0) {
    sentences.push(current.trim());
  }

  return sentences;
}

/**
 * Get the last N characters from text, breaking on a word boundary.
 */
function getOverlapFromEnd(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;

  const tail = text.slice(-maxChars);
  const firstSpace = tail.indexOf(' ');
  if (firstSpace > 0 && firstSpace < maxChars / 2) {
    return tail.slice(firstSpace + 1);
  }
  return tail;
}
