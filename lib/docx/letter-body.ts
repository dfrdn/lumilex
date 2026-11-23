// Body XML for documents injected into the firm letterhead template
// (lib/docx/template.docx). The template already defines what Word needs:
// Heading 1/2 bound to a I./A. multilevel list, a decimal "1./a./i." list, and a
// footnotes part. Blocks here only name those — Word draws the numbers, so a
// lawyer inserting a paragraph in Word gets the rest renumbered.

export interface LetterParagraph {
  text: string;
  /** "heading" (Word numbers I., A.), "item" (Word numbers 1., a., i.), or plain "text" (default). */
  type?: 'text' | 'heading' | 'item' | 'fields';
  /** heading: 1 or 2. item: 0, 1, or 2. */
  level?: number;
  bold?: boolean;
  italic?: boolean;
  alignment?: 'left' | 'center' | 'right' | 'justified';
  size?: number; // font size in half-points (24 = 12pt)
  spacing_after?: number; // spacing after paragraph in twips
  indent?: number; // left indent in twips
  /** First-line indent in twips — the firm's filings start each body paragraph half an inch in. */
  firstLine?: number;
  underline?: boolean;
  allCaps?: boolean;
  /** Small capitals — the Style Guide's setting for a name in a letter. */
  smallCaps?: boolean;
  /**
   * A paragraph style the template defines (e.g. "BodyText", "Title", "Quote").
   * Its alignment applies unless `alignment` is given. Ignored on headings and
   * list items, which have their own styles.
   */
  style?: string;
  /**
   * A label and its value — "TO:<tab>name". The \t moves to this stop (twips),
   * and a value too long for the line wraps under itself, not under the label.
   */
  tabStop?: number;
  /** Keep on the same page as the paragraph after it — for a closing and signature block. */
  keepNext?: boolean;
  /** spacing before paragraph in twips */
  spacing_before?: number;
  /**
   * type "fields": a borderless table of label, colon and value — "Attention"
   * set right, then ":", then the name — each value one or more lines. A label
   * is given without its colon; the table draws it. `text`
   * is ignored in the document; set it to the rows read as plain lines.
   */
  fields?: { label: string; lines: string[] }[];
  /** type "fields": a rule across the page under the table. */
  ruleBelow?: boolean;
  /** type "fields": the label column's width in twips, for labels longer than "Attention". The table's width stays the same. */
  labelWidth?: number;
}

const SIZE_FN = 20;

export function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

interface RunOpts { bold?: boolean; italic?: boolean; underline?: boolean; allCaps?: boolean; smallCaps?: boolean }

// Runs name no typeface: they take the firm's from the template's styles, which
// lib/docx/template-updater.ts sets from the firm's font set.
function runRpr(size: number, opts: RunOpts, extra = ''): string {
  const parts = [
    opts.bold ? '<w:b/><w:bCs/>' : '',
    opts.italic ? '<w:i/><w:iCs/>' : '',
    opts.allCaps ? '<w:caps/>' : '',
    opts.smallCaps ? '<w:smallCaps/>' : '',
    `<w:sz w:val="${size}"/><w:szCs w:val="${size}"/>`,
    opts.underline ? '<w:u w:val="single"/>' : '',
    extra,
  ];
  return `<w:rPr>${parts.join('')}</w:rPr>`;
}

/** **bold**, *italic*, ***both***, __underline__ → runs. */
function emphasisRuns(text: string, size: number, base: RunOpts): string {
  const pattern = /(\*\*\*(.+?)\*\*\*|\*\*(.+?)\*\*|__(.+?)__|(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*))/g;
  const out: string[] = [];
  const push = (t: string, o: RunOpts) => {
    const rPr = runRpr(size, { ...base, ...o, bold: base.bold || o.bold, italic: base.italic || o.italic, underline: base.underline || o.underline });
    // A tab character inside <w:t> is only whitespace to Word; a real tab is its own element.
    t.split('\t').forEach((piece, i) => {
      if (i > 0) out.push(`<w:r>${rPr}<w:tab/></w:r>`);
      if (piece) out.push(`<w:r>${rPr}<w:t xml:space="preserve">${escapeXml(piece)}</w:t></w:r>`);
    });
  };
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(text)) !== null) {
    if (m.index > last) push(text.slice(last, m.index), {});
    if (m[2]) push(m[2], { bold: true, italic: true });
    else if (m[3]) push(m[3], { bold: true });
    else if (m[4]) push(m[4], { underline: true });
    else if (m[5]) push(m[5], { italic: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) push(text.slice(last), {});
  return out.join('');
}

export interface LetterBodyResult {
  bodyXml: string;
  numberingXml: string;
  footnotesXml: string;
}

/**
 * The num instance for a fresh "1." list. Each run of consecutive items gets its
 * own instance restarting at 1 — a second list further down the letter starts
 * over instead of continuing from the first.
 */
function findDecimalListAbstract(numberingXml: string): string | null {
  for (const abs of numberingXml.matchAll(/<w:abstractNum\b[^>]*w:abstractNumId="(\d+)"[^>]*>([\s\S]*?)<\/w:abstractNum>/g)) {
    const lvl0 = /<w:lvl\b[^>]*w:ilvl="0"[^>]*>([\s\S]*?)<\/w:lvl>/.exec(abs[2])?.[1] ?? '';
    if (/<w:pStyle\b/.test(abs[2])) continue; // the heading list
    if (/<w:numFmt w:val="decimal"\/>/.test(lvl0) && /<w:lvlText w:val="%1\."\/>/.test(lvl0)) return abs[1];
  }
  return null;
}

export function buildLetterBody(
  paragraphs: LetterParagraph[],
  parts: { numberingXml: string; footnotesXml: string },
): LetterBodyResult {
  let numberingXml = parts.numberingXml;
  let footnotesXml = parts.footnotesXml;

  const listAbstract = findDecimalListAbstract(numberingXml);
  let nextNumId = Math.max(0, ...[...numberingXml.matchAll(/<w:num\b[^>]*w:numId="(\d+)"/g)].map((m) => Number(m[1]))) + 1;
  let nextFootnoteId = Math.max(0, ...[...footnotesXml.matchAll(/<w:footnote\b[^>]*w:id="(-?\d+)"/g)].map((m) => Number(m[1]))) + 1;
  const newNums: string[] = [];
  const newNotes: string[] = [];
  let currentList: number | null = null;

  const paragraphXml = (p: LetterParagraph): string => {
    const type = p.type ?? 'text';
    const size = p.size ?? 24;
    const base: RunOpts = { bold: p.bold, italic: p.italic, underline: p.underline, allCaps: p.allCaps, smallCaps: p.smallCaps };

    // CT_PPrBase order: pStyle, keepNext, numPr, tabs, spacing, ind, jc, rPr.
    const ppr: string[] = [];
    if (type === 'heading') {
      ppr.push(`<w:pStyle w:val="Heading${(p.level ?? 1) >= 2 ? 2 : 1}"/>`);
      currentList = null;
    } else if (type === 'item' && listAbstract) {
      if (currentList === null) {
        currentList = nextNumId++;
        newNums.push(`<w:num w:numId="${currentList}"><w:abstractNumId w:val="${listAbstract}"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>`);
      }
      ppr.push(`<w:numPr><w:ilvl w:val="${Math.max(0, Math.min(2, p.level ?? 0))}"/><w:numId w:val="${currentList}"/></w:numPr>`);
    } else {
      currentList = null;
      if (p.style) ppr.push(`<w:pStyle w:val="${p.style}"/>`);
    }
    if (p.keepNext) ppr.splice(ppr[0]?.startsWith('<w:pStyle') ? 1 : 0, 0, '<w:keepNext/>');
    if (p.tabStop) ppr.push(`<w:tabs><w:tab w:val="left" w:pos="${p.tabStop}"/></w:tabs>`);
    if (p.spacing_after !== undefined) ppr.push(`<w:spacing w:after="${p.spacing_after}"/>`);
    // A list's indent comes from its numbering level; an explicit one would fight it.
    if (p.tabStop) ppr.push(`<w:ind w:left="${p.tabStop}" w:hanging="${p.tabStop}"/>`);
    else if ((p.indent || p.firstLine) && type !== 'item') {
      ppr.push(`<w:ind w:left="${p.indent ?? 0}"${p.firstLine ? ` w:firstLine="${p.firstLine}"` : ''}/>`);
    }
    const jc = { left: 'start', center: 'center', right: 'end', justified: 'both' } as const;
    // Justification stretches every line of a paragraph except its last, so a
    // paragraph broken with \n — an address block, a closing, a signature block —
    // comes out with its words pushed to both margins. It also splits the
    // printed name into separate runs, which is what finalization looks for
    // when it places a signature. Only run-on prose gets justified.
    const hasLineBreaks = (p.text ?? '').includes('\n');
    if (p.alignment) ppr.push(`<w:jc w:val="${jc[p.alignment] ?? 'start'}"/>`);
    else if (type !== 'heading' && !p.style && !hasLineBreaks) ppr.push('<w:jc w:val="both"/>');
    ppr.push(runRpr(size, base));

    const runs: string[] = [];
    const lines = (p.text ?? '').split('\n');
    lines.forEach((line, i) => {
      const fnRe = /\[\[fn:([\s\S]+?)\]\]/g;
      let last = 0;
      let m: RegExpExecArray | null;
      while ((m = fnRe.exec(line)) !== null) {
        runs.push(emphasisRuns(line.slice(last, m.index), size, base));
        const id = nextFootnoteId++;
        runs.push(`<w:r>${runRpr(size, {}, '<w:vertAlign w:val="superscript"/>')}<w:footnoteReference w:id="${id}"/></w:r>`);
        newNotes.push(
          `<w:footnote w:id="${id}"><w:p><w:pPr><w:spacing w:after="0"/><w:jc w:val="both"/></w:pPr>` +
          `<w:r>${runRpr(SIZE_FN, {}, '<w:vertAlign w:val="superscript"/>')}<w:footnoteRef/></w:r>` +
          `<w:r>${runRpr(SIZE_FN, {})}<w:t xml:space="preserve"> </w:t></w:r>` +
          `${emphasisRuns(m[1].trim(), SIZE_FN, {})}</w:p></w:footnote>`,
        );
        last = m.index + m[0].length;
      }
      runs.push(emphasisRuns(line.slice(last), size, base));
      if (i < lines.length - 1) runs.push(`<w:r>${runRpr(size, base)}<w:br/></w:r>`);
    });

    return `<w:p><w:pPr>${ppr.join('')}</w:pPr>${runs.join('')}</w:p>`;
  };

  // Three columns: the label set right, its colon, and the value. The label
  // column is wide enough for "Attention" in 12pt; the table is a fixed width,
  // narrower than any letterhead design's text block, so the values line up
  // from row to row whatever the design. The cells' left margin is zero so the
  // labels sit on the margin with the paragraphs above them.
  const DEFAULT_LABEL_WIDTH = 1150;
  const COLON_WIDTH = 240;
  const TABLE_WIDTH = 6560;
  const fieldsXml = (p: LetterParagraph): string => {
    currentList = null;
    const labelWidth = p.labelWidth ?? DEFAULT_LABEL_WIDTH;
    const valueWidth = TABLE_WIDTH - labelWidth - COLON_WIDTH;
    const size = p.size ?? 24;
    const rows = p.fields ?? [];
    const cellText = (text: string, after: number, align: 'start' | 'end' = 'start') =>
      `<w:p><w:pPr><w:spacing w:before="0" w:after="${after}"/><w:jc w:val="${align}"/>${runRpr(size, {})}</w:pPr>${emphasisRuns(text, size, {})}</w:p>`;
    const rowXml = rows.map((r, i) => {
      const last = i === rows.length - 1;
      const lines = r.lines.length ? r.lines : [''];
      const gap = last ? 0 : 120;
      const valueParas = lines.map((l, j) => cellText(l, j === lines.length - 1 ? gap : 0)).join('');
      const tcMar = last && p.ruleBelow ? '<w:tcMar><w:bottom w:w="160" w:type="dxa"/></w:tcMar>' : '';
      return `<w:tr><w:trPr><w:cantSplit/></w:trPr>` +
        `<w:tc><w:tcPr><w:tcW w:w="${labelWidth}" w:type="dxa"/>${tcMar}</w:tcPr>${cellText(r.label, gap, 'end')}</w:tc>` +
        `<w:tc><w:tcPr><w:tcW w:w="${COLON_WIDTH}" w:type="dxa"/>${tcMar}</w:tcPr>${cellText(r.label ? ':' : '', gap)}</w:tc>` +
        `<w:tc><w:tcPr><w:tcW w:w="${valueWidth}" w:type="dxa"/>${tcMar}</w:tcPr>${valueParas}</w:tc></w:tr>`;
    }).join('');
    const rule = p.ruleBelow ? '<w:bottom w:val="single" w:sz="6" w:space="0" w:color="auto"/>' : '<w:bottom w:val="nil"/>';
    const tblPr =
      `<w:tblPr><w:tblW w:w="${TABLE_WIDTH}" w:type="dxa"/><w:tblInd w:w="0" w:type="dxa"/>` +
      `<w:tblBorders><w:top w:val="nil"/><w:left w:val="nil"/>${rule}<w:right w:val="nil"/><w:insideH w:val="nil"/><w:insideV w:val="nil"/></w:tblBorders>` +
      '<w:tblLayout w:type="fixed"/>' +
      '<w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="0" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="115" w:type="dxa"/></w:tblCellMar>' +
      '<w:tblLook w:val="0000" w:firstRow="0" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="1" w:noVBand="1"/></w:tblPr>';
    return `<w:tbl>${tblPr}<w:tblGrid><w:gridCol w:w="${labelWidth}"/><w:gridCol w:w="${COLON_WIDTH}"/><w:gridCol w:w="${valueWidth}"/></w:tblGrid>${rowXml}</w:tbl>`;
  };

  const bodyXml = paragraphs.map((p) => (p.type === 'fields' ? fieldsXml(p) : paragraphXml(p))).join('');
  if (newNums.length) numberingXml = numberingXml.replace('</w:numbering>', `${newNums.join('')}</w:numbering>`);
  if (newNotes.length) footnotesXml = footnotesXml.replace('</w:footnotes>', `${newNotes.join('')}</w:footnotes>`);
  return { bodyXml, numberingXml, footnotesXml };
}
