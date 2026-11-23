import { extractPdfText } from '@/lib/ai/pdf-text';

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB
const MAX_TEXT_LENGTH = 80_000; // ~25-30k tokens

const SUPPORTED_EXTENSIONS = new Set(['pdf', 'doc', 'docx']);

export interface ExtractedDocument {
  text: string;
  pageCount: number;
  fileType: string;
  /** Raw PDF buffer — available when text extraction fails on scanned PDFs */
  pdfBuffer?: Buffer;
}

function getExtension(url: string): string {
  // Strip query params, then get extension
  const path = url.split('?')[0];
  return path.split('.').pop()?.toLowerCase() ?? '';
}

export function isSupportedFileType(url: string): boolean {
  return SUPPORTED_EXTENSIONS.has(getExtension(url));
}

export function getFileTypeLabel(url: string): string {
  const ext = getExtension(url);
  if (ext === 'pdf') return 'PDF';
  if (ext === 'doc' || ext === 'docx') return 'Word Document';
  return ext.toUpperCase();
}

export async function fetchAndExtract(url: string): Promise<ExtractedDocument> {
  const ext = getExtension(url);

  if (!SUPPORTED_EXTENSIONS.has(ext)) {
    throw new Error(
      `Unsupported file type: .${ext}. Only PDF and Word documents (.pdf, .doc, .docx) can be analyzed.`,
    );
  }

  // Fetch the file
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download file: ${response.status} ${response.statusText}`);
  }

  // Check file size
  const contentLength = response.headers.get('content-length');
  if (contentLength && parseInt(contentLength) > MAX_FILE_SIZE) {
    throw new Error(
      `File too large (${Math.round(parseInt(contentLength) / 1024 / 1024)}MB). Maximum size is 25MB.`,
    );
  }

  const buffer = Buffer.from(await response.arrayBuffer());

  if (buffer.length > MAX_FILE_SIZE) {
    throw new Error(
      `File too large (${Math.round(buffer.length / 1024 / 1024)}MB). Maximum size is 25MB.`,
    );
  }

  let text = '';
  let pageCount = 0;

  if (ext === 'pdf') {
    const result = await extractPdfText(buffer);
    text = result.text;
    pageCount = result.pageCount;
  } else if (ext === 'doc' || ext === 'docx') {
    const mammoth = await import('mammoth');
    const result = await mammoth.extractRawText({ buffer });
    text = result.value;
    pageCount = 0; // mammoth doesn't provide page count
  }

  // Clean up text
  text = text
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (!text || text.length < 10) {
    if (ext === 'pdf') {
      // Scanned PDF — return buffer so Claude vision can read it directly
      return { text: '', pageCount, fileType: ext, pdfBuffer: buffer };
    }
    throw new Error(
      'Could not extract text from this document. It may be a scanned image without OCR.',
    );
  }

  // Truncate if too long
  if (text.length > MAX_TEXT_LENGTH) {
    text = text.slice(0, MAX_TEXT_LENGTH) + '\n\n[Document truncated — showing first ~80,000 characters]';
  }

  return { text, pageCount, fileType: ext };
}
