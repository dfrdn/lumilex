/**
 * Text out of a PDF. Every pdf-parse call goes through here.
 *
 * pdf-parse wraps a 2018 pdf.js that misreads a Node `Buffer`: handed one, it
 * fails on perfectly valid PDFs with "bad XRef entry", "Invalid number" or
 * "Command token too long" — intermittently, so it looks like bad files. On
 * the demo firm's 44 incoming PDFs, three passes with a Buffer read 39 of 132
 * correctly; the same bytes as a plain `Uint8Array` read 132 of 132. `Buffer`
 * is a `Uint8Array` subclass that differs where old code assumed it wouldn't —
 * most likely `slice()`, which on a Buffer shares memory instead of copying.
 *
 * So the bytes are copied into a plain `Uint8Array` with its own memory first.
 * The failure was silent at three of the four call sites (each fell back to
 * something weaker), which is how it went unnoticed.
 */
export async function extractPdfText(bytes: Uint8Array): Promise<{ text: string; pageCount: number }> {
  // The library file, not the package index: the index runs a self-test when
  // it thinks it is the entry module.
  const pdfParse = (await import('pdf-parse/lib/pdf-parse.js')).default;
  const result = await pdfParse(new Uint8Array(bytes));
  return { text: result.text, pageCount: result.numpages };
}
