// ── Finalized file names ────────────────────────────────────────────
// A finalize run reads the deliverable's latest version, which after an
// earlier run is itself a `_FINAL.docx`. Cancel a signing round, finalize
// again, and the suffix would stack: `…_FINAL_FINAL_FINAL.docx`. The document
// is only ever final once, so the marks are stripped before they are applied.

/** The document's name with any run of finalization marks removed. */
export function baseDocumentName(fileName: string): string {
  return fileName.replace(/\.(?:docx|pdf)$/i, '').replace(/(?:[_-](?:FINAL|SIGNED))+$/i, '');
}

/** The clean DOCX a finalize run writes. Stable no matter how often it reruns. */
export function finalDocxName(sourceFileName: string): string {
  return `${baseDocumentName(sourceFileName)}_FINAL.docx`;
}

/** The PDF rendered from it — marked signed only when signatures were applied. */
export function finalPdfName(docxName: string, signed: boolean): string {
  return `${baseDocumentName(docxName)}_FINAL${signed ? '_SIGNED' : ''}.pdf`;
}
