/**
 * The letterhead chrome shared by every document a firm sends out under one
 * cover: the engagement proposal letter, the fee schedules bound as Annex "A",
 * and the annex dividers between them.
 *
 * Keeping the running header, footer, section bands, and body typography in one
 * place is what makes a merged proposal package read as a single bound document
 * rather than several separately typeset PDFs stapled together. The layout here
 * is shared by every tenant; the colours, marks, typefaces and the firm name
 * stamped into the running header come off `doc.brand`.
 */

import {
  PAGE, M, CONTENT_W, FONT,
  paintSurfacePage, drawMark, drawCoverLockup,
  type BrandedDoc, type FontSet,
} from './brand';

export const BODY_TOP = 122;      // first baseline under the running header
export const BODY_BOTTOM = 756;   // last baseline above the footer rule

/**
 * Paint an interior page in the firm-profile idiom — tinted field, accent
 * keyline with deco corners, faint monogram watermark — then lay the running
 * header on top. Call after `doc.addPage()`; returns the y to begin the body at.
 *
 * The letter, the fee schedules bound behind it, and the firm profile at the
 * back all share this treatment so the merged package reads as one document.
 */
export function paintLetterPage(doc: BrandedDoc, runningTitle: string): number {
  paintSurfacePage(doc);
  runningHeader(doc, doc.brand.documentName, runningTitle);
  return BODY_TOP;
}

/**
 * Currency in the firm's own typeface. Most of the curated sets are
 * WinAnsi-encoded core PDF faces with no ₱ (U+20B1) — printing it would drop a
 * notdef box into a fee schedule — so the set declares what it can render and
 * the symbol comes from there rather than from a house rule baked into this file.
 */
export function peso(n: number, fonts: FontSet): string {
  return `${fonts.hasPesoGlyph ? '₱' : 'P'}${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * A currency prefix directly in front of an amount: "P50,000.00", "₱ 1,200".
 *
 * Anchored on both sides so prose survives it. The lookbehind keeps it off a
 * letter mid-word ("GDP2024"), and requiring a digit next keeps it off the
 * citations a Philippine engagement letter is full of — "P.D. No. 1096",
 * "PHP", "Annex P". What is left is the shape an amount is written in.
 */
const CURRENCY_PREFIX = /(?<![\p{L}\p{N}])[P₱](?=\s?\d)/gu;

/**
 * Re-prefix every amount in a string with the symbol the resolved set can
 * print.
 *
 * `peso()` above formats the figures a renderer computes, so those are always
 * right. This is for the figures that arrive as *content* — a proposal's fee
 * table and its scope lines were written when the letter was drafted, and a firm
 * that has changed `branding.fontSet` since would otherwise print the prefix its
 * old set could render: a bare "P" beside a schedule setting ₱, or worse, a ₱
 * in a WinAnsi core face, which is a notdef box in a document going to a client.
 *
 * Substituting the symbol is not the same as correcting a figure — the amount is
 * untouched, and which glyph spells the peso is a property of the typeface
 * rather than something an author decided. See `hasPesoGlyph` in ./fonts.
 */
export function withCurrencyPrefix(text: string, symbol: string): string {
  return text.replace(CURRENCY_PREFIX, symbol);
}

export function runningHeader(doc: BrandedDoc, firmFullName: string, runningTitle: string) {
  const C = doc.brand.palette;
  const y = 58;
  doc.font(FONT.body).fontSize(8.5).fillColor(C.primary)
    .text(firmFullName.toUpperCase(), M.left, y, { characterSpacing: 2, lineBreak: false });
  doc.font(FONT.bodyIt).fontSize(9).fillColor(C.accent)
    .text(runningTitle, M.left, y, { width: CONTENT_W, align: 'right', lineBreak: false });
  const ruleY = y + 16;
  doc.save().lineWidth(1.1).strokeColor(C.accent)
    .moveTo(M.left, ruleY).lineTo(PAGE.w - M.right, ruleY).stroke()
    .lineWidth(0.4)
    .moveTo(M.left, ruleY + 2.6).lineTo(PAGE.w - M.right, ruleY + 2.6).stroke()
    .restore();
}

/**
 * Monogram + letterspaced caps on the left, page number on the right — the same
 * footer the firm profile carries, so the page furniture doesn't change halfway
 * through the bound package.
 */
export function runningFooter(doc: BrandedDoc, leftText: string, pageNum: number) {
  const C = doc.brand.palette;
  const y = PAGE.h - 62;
  doc.save().lineWidth(0.5).strokeColor(C.hairline)
    .moveTo(M.left, y).lineTo(PAGE.w - M.right, y).stroke().restore();
  const markW = drawMark(doc, M.left + 7, y + 7, 13);
  doc.font(FONT.body).fontSize(8.5).fillColor(C.inkMuted)
    .text(leftText.toUpperCase(), M.left + (markW > 0 ? 20 : 0), y + 9, { characterSpacing: 2, lineBreak: false });
  doc.font(FONT.body).fontSize(8.5).fillColor(C.inkMuted)
    .text(String(pageNum), M.left, y + 9, { width: CONTENT_W, align: 'right', lineBreak: false });
}

/**
 * The firm's cover page: a primary panel carrying the monogram lockup, a tinted
 * field holding the title, and an accent contact band at the foot. Shared by the
 * engagement proposal and every fee schedule so they open identically.
 *
 * The panel is the brand primary, not the derived deep step — the documents are
 * bound together and a shade apart reads as a printing inconsistency.
 */
export function renderPanelCover(doc: BrandedDoc, opts: {
  /** Display title, one entry per line, e.g. ['Engagement', 'Proposal']. */
  titleLines: string[];
  /** Small italic accent line above the subject, e.g. "Prepared for". */
  kicker?: string;
  /** Letterspaced caps under the title — the client, or the schedule's scope. */
  subject?: string;
  /** Italic lines under the subject, e.g. the date or the edition. */
  metaLines?: string[];
  /** Left side of the accent band. */
  addressLines?: string[];
  /** Right side of the accent band. */
  contactLines?: string[];
}) {
  const C = doc.brand.palette;
  const navyH = PAGE.h * 0.442;
  const goldTop = PAGE.h * 0.869;

  doc.rect(0, 0, PAGE.w, navyH).fill(C.primary);
  doc.rect(0, navyH, PAGE.w, goldTop - navyH).fill(C.surface);
  doc.rect(0, goldTop, PAGE.w, PAGE.h - goldTop).fill(C.accent);

  drawCoverLockup(doc, { logoY: 74 });

  // The title block advances by fixed leading rather than by reading doc.y
  // back: `lineBreak: false` leaves the cursor where it was, which would stack
  // every line of the block on one baseline.
  const TITLE_SIZE = 44;
  const TITLE_LEAD = 46;
  let y = PAGE.h * 0.545;
  for (const line of opts.titleLines) {
    doc.font(FONT.disp).fontSize(TITLE_SIZE).fillColor(C.primary)
      .text(line.toUpperCase(), M.left, y, { width: CONTENT_W, characterSpacing: 1, lineBreak: false });
    y += TITLE_LEAD;
  }

  y += 14;
  doc.save().lineWidth(1.2).strokeColor(C.accent).moveTo(M.left, y).lineTo(M.left + 175, y).stroke().restore();
  y += 14;

  if (opts.kicker) {
    doc.font(FONT.bodyIt).fontSize(10.5).fillColor(C.accentDeep).text(opts.kicker, M.left, y, { lineBreak: false });
    y += 16;
  }
  if (opts.subject) {
    // Shrink to hold the subject on one line — "Retainer · Hourly · Acceptance
    // Fees" otherwise wraps with a single orphaned word under the title.
    const caps = opts.subject.toUpperCase();
    doc.font(FONT.dispSb);
    let size = 16;
    while (size > 10 && doc.fontSize(size).widthOfString(caps, { characterSpacing: 2.4 }) > CONTENT_W) {
      size -= 0.25;
    }
    doc.fontSize(size).fillColor(C.primary);
    const h = doc.heightOfString(caps, { width: CONTENT_W, characterSpacing: 2.4 });
    doc.text(caps, M.left, y, { width: CONTENT_W, characterSpacing: 2.4 });
    y += h + 8;
  }
  for (const line of opts.metaLines ?? []) {
    doc.font(FONT.bodyIt).fontSize(10.5).fillColor(C.inkSoft).text(line, M.left, y, { lineBreak: false });
    y += 15;
  }

  const bandY = goldTop + 26;
  (opts.addressLines ?? []).forEach((line, i) => {
    doc.font(FONT.body).fontSize(9).fillColor(C.surface).text(line, M.left, bandY + i * 12, { lineBreak: false });
  });
  (opts.contactLines ?? []).forEach((line, i) => {
    doc.font(FONT.body).fontSize(9).fillColor(C.surface)
      .text(line, M.left, bandY + i * 12, { width: CONTENT_W, align: 'right', lineBreak: false });
  });
}

/** Numbered accent section band, e.g. "1  SCOPE OF SERVICES". */
export function sectionBand(doc: BrandedDoc, index: number | null, title: string, y: number): number {
  const C = doc.brand.palette;
  const h = 21;
  doc.rect(M.left, y, CONTENT_W, h).fill(C.accent);
  const label = index == null ? title.toUpperCase() : `${index}    ${title.toUpperCase()}`;
  doc.font(FONT.bodyB).fontSize(11.5).fillColor(C.white)
    .text(label, M.left + 10, y + 5.5, { characterSpacing: 1.6, lineBreak: false });
  return y + h + 12;
}

/**
 * Primary small-caps subheading with an accent hairline under it — the level
 * between a section band and body text ("Retainer Services", "Dispute
 * Resolution").
 */
export function subheading(doc: BrandedDoc, text: string, y: number): number {
  const C = doc.brand.palette;
  doc.font(FONT.bodyB).fontSize(11).fillColor(C.primary)
    .text(text.toUpperCase(), M.left, y, { width: CONTENT_W, characterSpacing: 1.2 });
  const ruleY = doc.y + 3;
  doc.save().lineWidth(1).strokeColor(C.accent)
    .moveTo(M.left, ruleY).lineTo(PAGE.w - M.right, ruleY).stroke().restore();
  return ruleY + 9;
}

/**
 * Split on `**bold**` and hand each fragment's leading whitespace back to the
 * fragment before it. When a justified `continued` run resumes, pdfkit re-splits
 * on whitespace and drops what it finds at the start — a trailing space on the
 * preceding run survives, a leading space (or a non-breaking one) does not.
 * Without this, "**Initial Fee** for" renders as "Initial Feefor".
 */
export function boldRuns(text: string): { text: string; bold: boolean }[] {
  const parts = text.split(/\*\*(.+?)\*\*/g).map((t, i) => ({ text: t, bold: i % 2 === 1 }));
  for (let i = parts.length - 1; i > 0; i--) {
    const lead = parts[i].text.match(/^\s+/)?.[0];
    if (!lead) continue;
    parts[i].text = parts[i].text.slice(lead.length);
    parts[i - 1].text += lead;
  }
  return parts.filter((p) => p.text);
}

export interface ParagraphOpts {
  size?: number;
  /** Left edge and width, for indented blocks like list items. */
  x?: number;
  width?: number;
  /** Trailing gap below the paragraph. */
  gap?: number;
}

/** Justified body paragraph. `**bold**` runs render bold inline. */
export function paragraph(doc: BrandedDoc, text: string, y: number, opts: ParagraphOpts = {}): number {
  const C = doc.brand.palette;
  const size = opts.size ?? 10.5;
  const x = opts.x ?? M.left;
  const width = opts.width ?? CONTENT_W;
  const runs = boldRuns(text);
  runs.forEach((run, i) => {
    doc.font(run.bold ? FONT.bodyB : FONT.body).fontSize(size).fillColor(C.ink);
    const o = { width, align: 'justify' as const, lineGap: 2, continued: i < runs.length - 1 };
    // Only the opening run may be positioned — handing x/y to a continued run
    // resets the flow.
    if (i === 0) doc.text(run.text, x, y, o);
    else doc.text(run.text, o);
  });
  return doc.y + (opts.gap ?? 10);
}

/** Gap between the paragraphs of a multi-paragraph labelled block. */
const LABELLED_PARA_GAP = 8;

/** Paragraphs of a labelled block's body, split on blank lines. */
function labelledParas(text: string): string[] {
  return text.split(/\n+/).map((p) => p.trim()).filter(Boolean);
}

/**
 * The lead-in as it prints. A label is punctuated with a full stop, but authors
 * type it both ways — scope-library lines and model output have both been seen
 * ending in one, and appending unconditionally printed "Priority access..".
 */
export function labelText(label: string): string {
  return /[.:?!]$/.test(label.trimEnd()) ? label.trimEnd() : `${label.trimEnd()}.`;
}

/**
 * Bold lead-in followed by justified body text. Only the opening paragraph is
 * indented — just enough to clear the label sitting on its first line; any
 * succeeding paragraphs run flush to the margin. (pdfkit's `indent` option
 * otherwise indents the first line of *every* newline-separated paragraph, which
 * read as stray tab stops mid-block.)
 */
export function labelledParagraph(
  doc: BrandedDoc,
  label: string,
  text: string,
  y: number,
  opts: { size?: number; italicLabel?: boolean } = {},
): number {
  const C = doc.brand.palette;
  const size = opts.size ?? 10.5;
  const labelFont = opts.italicLabel ? FONT.bodyIt : FONT.bodyB;
  const lead = labelText(label);
  doc.font(labelFont).fontSize(size);
  const indent = doc.widthOfString(lead) + 7;
  doc.fillColor(C.primary).text(lead, M.left, y, { lineBreak: false });

  doc.font(FONT.body).fontSize(size).fillColor(C.ink);
  labelledParas(text).forEach((para, i) => {
    const o = { width: CONTENT_W, align: 'justify' as const, lineGap: 2 };
    if (i === 0) doc.text(para, M.left, y, { ...o, indent });
    else doc.text(para, M.left, doc.y + LABELLED_PARA_GAP, o);
  });
  return doc.y + 8;
}

/** Height a labelled paragraph will occupy, for page-break decisions. */
export function labelledHeight(doc: BrandedDoc, label: string, text: string, size = 10.5): number {
  doc.font(FONT.bodyB).fontSize(size);
  const indent = doc.widthOfString(labelText(label)) + 7;
  doc.font(FONT.body).fontSize(size);
  const paras = labelledParas(text);
  return paras.reduce(
    (h, para, i) =>
      h + doc.heightOfString(para, { width: CONTENT_W, align: 'justify', lineGap: 2, indent: i === 0 ? indent : 0 })
        + (i > 0 ? LABELLED_PARA_GAP : 0),
    8,
  );
}
