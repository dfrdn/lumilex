/**
 * The PDF brand kit — resolved per firm from `firms.branding`, then carried on
 * the pdfkit document that is being rendered in it.
 *
 * What is per-firm: the palette, the name lines on the cover, the tagline, the
 * typeface set, and the logo/monogram images. What stays shared: the A4
 * geometry, the margins, and every deco primitive below — the keyline, the corner
 * brackets, the deco bars, the section header, the footer. A tenant gets its own
 * colours and marks inside the same typographic system, so the engagement
 * proposal, the fee schedules bound behind it, and the annex dividers between
 * them still read as one bound document.
 *
 * The brand rides on the document rather than being threaded through forty
 * signatures. A pdfkit document is a single-use render context, so "this
 * document is being rendered in this brand" is a true statement about it for its
 * whole life — see {@link brandedDocument}.
 *
 * There is deliberately no packaged fallback mark. A firm with no monogram
 * configured renders clean empty space; the previous single-firm kit drew a
 * vector stand-in of its own logo, which on a whitelabel product would put one
 * firm's mark on another firm's engagement letter.
 */

import PDFKitDocument from 'pdfkit';
import type { FirmBranding } from '@/lib/firm/config';
import { derivePalette, type Palette } from './palette';
import { FONT, registerFonts, resolveFontSet, pesoSymbol, type FontSet } from './fonts';
import { NO_BRAND_ASSETS, type BrandAssets } from './brand-assets';

export { FONT };
export type { Palette, FontSet };

// ── Geometry (A4 portrait, pts) — shared by every firm ──────────────
export const PAGE = { w: 595.28, h: 841.89 };
export const M = { left: 64, right: 64 };
export const CONTENT_W = PAGE.w - M.left - M.right;
export const CONTENT_TOP = 104;
export const CONTENT_BOTTOM = 770;
export const BORDER_INSET = 30; // keyline distance from page edge

export interface Brand {
  palette: Palette;
  fonts: FontSet;
  /** Cover wordmark, one entry per line. */
  nameLines: string[];
  /** Full name stamped in running headers, PDF metadata, signature blocks. */
  documentName: string;
  /** Spread small-caps line under the cover wordmark; '' omits it. */
  tagline: string;
  /** Local paths to the firm's own marks, or null. Never another firm's. */
  assets: BrandAssets;
  /** The currency prefix the resolved faces can actually print. */
  pesoSymbol: string;
}

/**
 * Resolve a firm's branding row into a brand kit.
 *
 * Fail-loud: an unset palette, name or document name throws with the setting to
 * fix. The alternative — a neutral default — would produce a plausible-looking
 * document that is not the firm's, which is worse than an export that refuses.
 * Images are the exception: "no logo" is a legitimate configuration and renders
 * as blank space.
 */
export function brandFromConfig(branding: FirmBranding, assets: BrandAssets = NO_BRAND_ASSETS): Brand {
  const nameLines = branding.nameLines.map((l) => l.trim()).filter(Boolean);
  if (!nameLines.length) {
    throw new Error('Firm branding is incomplete: set branding.nameLines before generating documents.');
  }
  const documentName = branding.documentName.trim();
  if (!documentName) {
    throw new Error('Firm branding is incomplete: set branding.documentName before generating documents.');
  }
  if (!branding.palette.primary.trim() || !branding.palette.accent.trim()) {
    throw new Error(
      'Firm branding is incomplete: set branding.palette.primary and branding.palette.accent before generating documents.',
    );
  }

  const fonts = resolveFontSet(branding.fontSet);
  return {
    palette: derivePalette(branding.palette.primary, branding.palette.accent),
    fonts,
    nameLines,
    documentName,
    tagline: branding.tagline.trim(),
    assets,
    pesoSymbol: pesoSymbol(fonts),
  };
}

// ── Branded document ────────────────────────────────────────────────

/** A pdfkit document that knows which firm's brand it is being rendered in. */
export type BrandedDoc = PDFKit.PDFDocument & { readonly brand: Brand };

type DocOptions = ConstructorParameters<typeof PDFKitDocument>[0];

/**
 * Open an A4 document in a firm's brand: full-bleed margins (the renderers
 * position everything themselves), the brand attached, and its typeface set
 * registered under the stable `FONT.*` aliases.
 */
export function brandedDocument(brand: Brand, options: DocOptions = {}): BrandedDoc {
  const doc = new PDFKitDocument({
    size: 'A4',
    margins: { top: 0, bottom: 0, left: 0, right: 0 },
    autoFirstPage: true,
    ...options,
  }) as BrandedDoc;
  Object.defineProperty(doc, 'brand', { value: brand, enumerable: false });
  registerFonts(doc, brand.fonts);
  return doc;
}

// ── Marks ───────────────────────────────────────────────────────────

/** pdfkit exposes openImage but @types/pdfkit does not declare it. */
interface ImageOpener {
  openImage(src: string): { width: number; height: number };
}

/**
 * Width÷height of an embedded image. pdfkit caches decoded images per document
 * by path, so asking repeatedly costs one decode, not one per page.
 */
export function imageAspect(doc: BrandedDoc, src: string): number | null {
  try {
    const img = (doc as unknown as ImageOpener).openImage(src);
    return img.width > 0 && img.height > 0 ? img.width / img.height : null;
  } catch {
    return null;
  }
}

export type MarkVariant = 'default' | 'light';

function markSrc(brand: Brand, variant: MarkVariant): string | null {
  if (variant === 'light') return brand.assets.monogramLight ?? brand.assets.monogram;
  return brand.assets.monogram;
}

/**
 * The firm's monogram, centred on `cx` with its top at `topY` and drawn to
 * height `h`. Draws nothing at all when the firm has no monogram configured —
 * the space stays clean rather than borrowing a mark.
 *
 * Returns the width drawn (0 when nothing was), so callers that align other
 * elements to the mark can do so without assuming an aspect ratio.
 */
export function drawMark(
  doc: BrandedDoc,
  cx: number,
  topY: number,
  h: number,
  opacity = 1,
  variant: MarkVariant = 'default',
): number {
  const src = markSrc(doc.brand, variant);
  if (!src) return 0;
  const ar = imageAspect(doc, src);
  if (ar == null) return 0;
  const w = h * ar;
  doc.save();
  if (opacity !== 1) doc.opacity(opacity);
  try {
    doc.image(src, cx - w / 2, topY, { width: w, height: h });
  } catch {
    doc.restore();
    return 0;
  }
  doc.restore();
  return w;
}

/** Width the monogram would occupy at height `h`, or 0 when there is none. */
export function markWidth(doc: BrandedDoc, h: number, variant: MarkVariant = 'default'): number {
  const src = markSrc(doc.brand, variant);
  if (!src) return 0;
  const ar = imageAspect(doc, src);
  return ar == null ? 0 : h * ar;
}

// ── Shared deco primitives ──────────────────────────────────────────
// Thin L-brackets at the four corners of a rectangle.
export function decoCorners(doc: BrandedDoc, x: number, y: number, w: number, h: number, len: number, color: string, lw = 0.8) {
  doc.save().lineWidth(lw).strokeColor(color);
  const c = [
    [x, y, 1, 1],
    [x + w, y, -1, 1],
    [x, y + h, 1, -1],
    [x + w, y + h, -1, -1],
  ] as const;
  for (const [cx, cy, sx, sy] of c) {
    doc.moveTo(cx, cy).lineTo(cx + sx * len, cy).stroke();
    doc.moveTo(cx, cy).lineTo(cx, cy + sy * len).stroke();
  }
  doc.restore();
}

// Accent keyline border inset from the page edge, with deco corners.
export function keyline(doc: BrandedDoc, color: string) {
  const i = BORDER_INSET;
  doc.save().lineWidth(0.8).strokeColor(color)
    .rect(i, i, PAGE.w - 2 * i, PAGE.h - 2 * i).stroke()
    .restore();
  decoCorners(doc, i - 6, i - 6, PAGE.w - 2 * (i - 6), PAGE.h - 2 * (i - 6), 12, color, 1.1);
}

// Deco bar cluster: uniform width + uniform spacing, but each bar has its own
// top and bottom so the column tops AND bases are staggered (an abstract
// art-deco rhythm, not a chart). Shared by the cover and contact pages.
export type Bar = { top: number; bottom: number; color: string };
export function drawDecoBars(doc: BrandedDoc, x0: number, width: number, pitch: number, bars: Bar[]) {
  doc.save();
  bars.forEach((b, i) => doc.rect(x0 + i * pitch, b.top, width, b.bottom - b.top).fill(b.color));
  doc.restore();
}

/**
 * Centred section header: caps title over a short pair of accent rules. When the
 * firm has a monogram it sits between them; when it does not, the rules close up
 * into one continuous rule rather than leaving a conspicuous gap.
 */
export function sectionHeader(doc: BrandedDoc, text: string, y: number, opts?: { caps?: boolean; size?: number }): number {
  const C = doc.brand.palette;
  const size = opts?.size ?? 26;
  const caps = opts?.caps ?? true;
  doc
    .font(caps ? FONT.dispSb : FONT.disp)
    .fontSize(size)
    .fillColor(C.primary)
    .text(caps ? text.toUpperCase() : text, M.left, y, { width: CONTENT_W, align: 'center', characterSpacing: caps ? 3 : 1 });
  const afterText = doc.y;
  const cx = PAGE.w / 2;
  const ruleY = afterText + 12;
  const markH = 13;
  const half = 52;
  const gap = markWidth(doc, markH) > 0 ? 16 : 0;
  doc.save().lineWidth(0.9).strokeColor(C.accentLine);
  if (gap === 0) {
    doc.moveTo(cx - half, ruleY).lineTo(cx + half, ruleY).stroke();
  } else {
    doc.moveTo(cx - half, ruleY).lineTo(cx - gap, ruleY).stroke();
    doc.moveTo(cx + gap, ruleY).lineTo(cx + half, ruleY).stroke();
  }
  doc.restore();
  drawMark(doc, cx, ruleY - markH / 2 - 1, markH);
  return ruleY + 24;
}

/**
 * Footer: small monogram + wordmark (left) and page number (right) on a
 * hairline. The wordmark shifts left when there is no monogram to sit beside.
 */
export function footer(doc: BrandedDoc, firmName: string, pageNum: number) {
  const C = doc.brand.palette;
  const y = PAGE.h - BORDER_INSET - 26;
  doc.save().lineWidth(0.5).strokeColor(C.hairline)
    .moveTo(M.left, y).lineTo(PAGE.w - M.right, y).stroke().restore();
  const markW = drawMark(doc, M.left + 7, y + 7, 13);
  doc.font(FONT.body).fontSize(8.5).fillColor(C.inkMuted)
    .text(firmName.toUpperCase(), M.left + (markW > 0 ? 20 : 0), y + 9, { characterSpacing: 2, lineBreak: false });
  doc.font(FONT.body).fontSize(8.5).fillColor(C.inkMuted)
    .text(String(pageNum), PAGE.w - M.right - 40, y + 9, { width: 40, align: 'right' });
}

/** Paint a tinted content page: background, keyline, faint monogram watermark. */
export function paintSurfacePage(doc: BrandedDoc) {
  const C = doc.brand.palette;
  doc.rect(0, 0, PAGE.w, PAGE.h).fill(C.surfacePage);
  // Large, very faint monogram watermark, lower-right.
  drawMark(doc, PAGE.w - 150, PAGE.h - 360, 300, 0.04);
  keyline(doc, C.accentLine);
}

/**
 * The cover lockup shared by the firm profile and the engagement proposal: the
 * monogram, the firm's name set line by line in engraved caps beside it, and an
 * optional spread small-caps tagline beneath.
 *
 * The name lines come from `branding.nameLines` verbatim. The single-firm kit
 * split the name on '&' to get two lines, which is a house style of one
 * particular firm's name and produced nonsense for anyone else's.
 *
 * Returns the y below the lockup so each cover can continue its own way.
 */
export function drawCoverLockup(doc: BrandedDoc, opts: { logoY?: number } = {}): number {
  const C = doc.brand.palette;
  const { nameLines, tagline } = doc.brand;
  const logoY = opts.logoY ?? 88;
  const MARK_H = 74;
  const markW = drawMark(doc, M.left + 26, logoY, MARK_H);
  const wordX = markW > 0 ? M.left + 78 : M.left;

  doc.font(FONT.dispSb).fontSize(34).fillColor(C.white);
  nameLines.forEach((line, i) => {
    doc.text(line.toUpperCase(), wordX, i === 0 ? logoY + 4 : doc.y + 2, { characterSpacing: 1.5 });
  });

  if (tagline) {
    // Left edge aligns with the mark (the logo figure), spread to span the full
    // lockup width — out to the wordmark's right edge.
    const tag = tagline.toUpperCase();
    const markLeft = markW > 0 ? M.left + 26 - markW / 2 : M.left;
    doc.font(FONT.dispSb).fontSize(34);
    const widest = Math.max(...nameLines.map((l) => doc.widthOfString(l.toUpperCase(), { characterSpacing: 1.5 })));
    const span = wordX + widest - markLeft;
    doc.font(FONT.dispSb).fontSize(8.5);
    const baseW = doc.widthOfString(tag, { characterSpacing: 0 });
    const cs = Math.max(0.5, (span - baseW) / Math.max(tag.length, 1));
    doc.fillColor(C.accentSoft).text(tag, markLeft, doc.y + 11, { characterSpacing: cs, lineBreak: false });
  }
  return doc.y;
}

/** Accent keyline + deco corners drawn over a primary field (cover pages). */
export function keylineOnPrimary(doc: BrandedDoc) {
  const C = doc.brand.palette;
  doc.save().lineWidth(0.8).strokeColor(C.accent)
    .rect(BORDER_INSET, BORDER_INSET, PAGE.w - 2 * BORDER_INSET, PAGE.h - 2 * BORDER_INSET).stroke().restore();
  decoCorners(doc, BORDER_INSET - 6, BORDER_INSET - 6, PAGE.w - 2 * (BORDER_INSET - 6), PAGE.h - 2 * (BORDER_INSET - 6), 14, C.accent, 1.1);
}

/** Collect a pdfkit document into a Buffer. */
export function collect(doc: PDFKit.PDFDocument, render: () => void): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c as Buffer));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    try {
      render();
      doc.end();
    } catch (err) {
      reject(err as Error);
    }
  });
}
