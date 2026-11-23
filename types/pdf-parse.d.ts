declare module 'pdf-parse/lib/pdf-parse.js' {
  interface PdfParseResult {
    numpages: number;
    numrender: number;
    info: Record<string, unknown>;
    metadata: Record<string, unknown> | null;
    text: string;
    version: string;
  }

  /** Call through `extractPdfText` (lib/ai/pdf-text.ts), never with a Buffer directly. */
  function pdfParse(dataBuffer: Uint8Array): Promise<PdfParseResult>;
  export default pdfParse;
}
