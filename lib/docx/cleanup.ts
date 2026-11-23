// ── DOCX Cleanup: accept tracked changes + remove comments ──────
// Uses JSZip to manipulate OOXML directly (same pattern as template-updater.ts)

import JSZip from 'jszip';

/**
 * Accept all tracked changes and remove all comments from a DOCX buffer.
 * Returns a clean DOCX buffer.
 */
export async function cleanDocx(buffer: Buffer): Promise<Buffer> {
  const zip = await JSZip.loadAsync(buffer);

  await acceptTrackedChanges(zip);
  await removeComments(zip);

  const output = await zip.generateAsync({ type: 'nodebuffer' });
  return Buffer.from(output);
}

// ── Accept Tracked Changes ───────────────────────────────────────

// Every story part that can carry tracked changes or comment anchors. Footnotes
// matter most here: a pleading's citations live in them.
function storyParts(zip: JSZip): string[] {
  return Object.keys(zip.files).filter(
    (name) =>
      name === 'word/document.xml' ||
      name === 'word/footnotes.xml' ||
      name === 'word/endnotes.xml' ||
      /^word\/header\d+\.xml$/.test(name) ||
      /^word\/footer\d+\.xml$/.test(name),
  );
}

/**
 * Process the body, footnotes, endnotes, headers, and footers to accept all
 * tracked changes.
 */
async function acceptTrackedChanges(zip: JSZip): Promise<void> {
  const xmlFiles = storyParts(zip);

  for (const fileName of xmlFiles) {
    const file = zip.files[fileName];
    if (!file) continue;

    let xml = await file.async('string');
    xml = acceptChangesInXml(xml);
    zip.file(fileName, xml);
  }
}

/**
 * Every `<w:p>` in document order, nesting-aware: a paragraph can contain
 * another one inside a text box, so a non-greedy match would end at the wrong
 * `</w:p>`.
 */
function paragraphSpans(xml: string): { start: number; end: number; open: string; inner: string }[] {
  const token = /<w:p\b([^>]*)>|<\/w:p>/g;
  const stack: { start: number; open: string }[] = [];
  const spans: { start: number; end: number; open: string; inner: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = token.exec(xml)) !== null) {
    if (m[0] === '</w:p>') {
      const open = stack.pop();
      if (open) {
        spans.push({
          start: open.start,
          end: m.index + m[0].length,
          open: open.open,
          inner: xml.slice(open.start + open.open.length, m.index),
        });
      }
    } else if (!m[1].endsWith('/')) {
      stack.push({ start: m.index, open: m[0] });
    }
  }
  return spans.sort((a, b) => a.start - b.start);
}

/**
 * A paragraph's own `<w:pPr>` and the runs after it. `<w:pPrChange>` keeps a
 * copy of the superseded properties inside the live element, so the first
 * `</w:pPr>` is not necessarily the one that closes it.
 */
function splitParagraph(inner: string): { pPr: string; runs: string } {
  if (!inner.startsWith('<w:pPr')) return { pPr: '', runs: inner };
  const empty = /^<w:pPr\b[^>]*\/>/.exec(inner);
  if (empty) return { pPr: empty[0], runs: inner.slice(empty[0].length) };

  const token = /<w:pPr\b[^>]*>|<\/w:pPr>/g;
  let depth = 0;
  let m: RegExpExecArray | null;
  while ((m = token.exec(inner)) !== null) {
    if (m[0] === '</w:pPr>') {
      if (--depth === 0) {
        const end = m.index + m[0].length;
        return { pPr: inner.slice(0, end), runs: inner.slice(end) };
      }
    } else if (!m[0].endsWith('/>')) {
      depth++;
    }
  }
  return { pPr: '', runs: inner };
}

/**
 * A deleted paragraph mark is a self-closing `<w:del/>` in the paragraph's own
 * run properties — the author joined this paragraph to the next one. Accepting
 * that merges the two: the mark that survives is the next paragraph's, so its
 * properties win and this paragraph's runs move to the front of it.
 *
 * Only a paragraph that sits immediately before its neighbour is merged. When
 * anything separates them (a cell or row boundary, say) they are not siblings
 * and the mark is simply dropped, leaving the break in place.
 */
function mergeParagraphsWithDeletedMark(xml: string): string {
  const markGone = /<w:(?:del|moveFrom)\b[^>]*\/>/;
  for (;;) {
    const spans = paragraphSpans(xml);
    const at = spans.findIndex((p, i) => {
      const next = spans[i + 1];
      if (!next || next.start !== p.end) return false;
      return markGone.test(splitParagraph(p.inner).pPr);
    });
    if (at === -1) return xml;

    const para = spans[at];
    const next = spans[at + 1];
    const runs = splitParagraph(para.inner).runs;
    const tail = splitParagraph(next.inner);
    xml =
      xml.slice(0, para.start) +
      next.open + tail.pPr + runs + tail.runs + '</w:p>' +
      xml.slice(next.end);
  }
}

/**
 * Accept tracked changes in an XML string.
 * Handles: insertions, deletions, formatting changes, moves.
 */
function acceptChangesInXml(xml: string): string {
  let prev = '';

  // Iterate until stable (handles nested tracked changes)
  while (prev !== xml) {
    prev = xml;

    xml = mergeParagraphsWithDeletedMark(xml);

    // The marker forms of the revision tags, which flag an inserted or deleted
    // paragraph mark rather than wrapping content. They must go before the
    // patterns below: `<w:del …/>` matches an opening `<w:del …>` too, and the
    // deletion pattern would then swallow every paragraph up to the next
    // `</w:del>` — half the document, silently.
    xml = xml.replace(/<w:(?:ins|del|moveFrom|moveTo)\b[^>]*\/>/g, '');

    // Accept insertions: unwrap <w:ins> keeping inner content
    xml = xml.replace(/<w:ins\b[^>]*(?<!\/)>([\s\S]*?)<\/w:ins>/g, '$1');

    // Accept deletions: remove <w:del> and all its content entirely
    xml = xml.replace(/<w:del\b[^>]*(?<!\/)>[\s\S]*?<\/w:del>/g, '');

    // Accept move-to: unwrap <w:moveTo> keeping inner content
    xml = xml.replace(/<w:moveTo\b[^>]*(?<!\/)>([\s\S]*?)<\/w:moveTo>/g, '$1');

    // Remove move-from: delete <w:moveFrom> and content (old location of moved text)
    xml = xml.replace(/<w:moveFrom\b[^>]*(?<!\/)>[\s\S]*?<\/w:moveFrom>/g, '');

    // Remove run property changes: <w:rPrChange>...</w:rPrChange>
    xml = xml.replace(/<w:rPrChange\b[^>]*(?<!\/)>[\s\S]*?<\/w:rPrChange>/g, '');

    // Remove paragraph property changes: <w:pPrChange>...</w:pPrChange>
    xml = xml.replace(/<w:pPrChange\b[^>]*(?<!\/)>[\s\S]*?<\/w:pPrChange>/g, '');

    // Remove section property changes: <w:sectPrChange>...</w:sectPrChange>
    xml = xml.replace(/<w:sectPrChange\b[^>]*(?<!\/)>[\s\S]*?<\/w:sectPrChange>/g, '');

    // Remove table property changes
    xml = xml.replace(/<w:tblPrChange\b[^>]*(?<!\/)>[\s\S]*?<\/w:tblPrChange>/g, '');
    xml = xml.replace(/<w:trPrChange\b[^>]*(?<!\/)>[\s\S]*?<\/w:trPrChange>/g, '');
    xml = xml.replace(/<w:tcPrChange\b[^>]*(?<!\/)>[\s\S]*?<\/w:tcPrChange>/g, '');

    // Remove revision IDs from remaining elements
    xml = xml.replace(/\s+w:rsidR="[^"]*"/g, '');
    xml = xml.replace(/\s+w:rsidRPr="[^"]*"/g, '');
    xml = xml.replace(/\s+w:rsidDel="[^"]*"/g, '');
    xml = xml.replace(/\s+w:rsidP="[^"]*"/g, '');
    xml = xml.replace(/\s+w:rsidTr="[^"]*"/g, '');
  }

  return xml;
}

// ── Remove Comments ──────────────────────────────────────────────

/**
 * Remove all comments from the DOCX.
 */
async function removeComments(zip: JSZip): Promise<void> {
  // Delete comment part files
  delete zip.files['word/comments.xml'];
  delete zip.files['word/commentsExtended.xml'];
  delete zip.files['word/commentsIds.xml'];
  // Its content-type override and relationship go with the others below, so
  // leaving the part behind would orphan it.
  delete zip.files['word/commentsExtensible.xml'];

  // Remove comment markers and references from every story part
  for (const part of storyParts(zip)) {
    let xml = await zip.files[part].async('string');

    // Remove comment range markers
    xml = xml.replace(/<w:commentRangeStart\b[^>]*\/>/g, '');
    xml = xml.replace(/<w:commentRangeEnd\b[^>]*\/>/g, '');

    // Remove runs that contain comment references
    // These are <w:r> elements with <w:commentReference> inside. The run
    // properties must not be allowed to run past `</w:r>`: unbounded, the
    // match reaches the next reference run and takes every paragraph between
    // the two with it.
    xml = xml.replace(
      /<w:r\b[^>]*(?<!\/)>(?:<w:rPr\b[^>]*(?:\/>|>(?:(?!<\/w:r>)[\s\S])*<\/w:rPr>))?\s*<w:commentReference\b[^>]*\/>\s*<\/w:r>/g,
      '',
    );

    zip.file(part, xml);
  }

  // Update [Content_Types].xml to remove comment part entries
  const contentTypesFile = zip.files['[Content_Types].xml'];
  if (contentTypesFile) {
    let ct = await contentTypesFile.async('string');
    ct = ct.replace(/<Override\b[^>]*PartName="\/word\/comments[^"]*"[^>]*\/>/g, '');
    zip.file('[Content_Types].xml', ct);
  }

  // Update document.xml.rels to remove comment relationships
  const relsFile = zip.files['word/_rels/document.xml.rels'];
  if (relsFile) {
    let rels = await relsFile.async('string');
    rels = rels.replace(
      /<Relationship\b[^>]*Type="[^"]*\/comments[^"]*"[^>]*\/>/g,
      '',
    );
    zip.file('word/_rels/document.xml.rels', rels);
  }
}
