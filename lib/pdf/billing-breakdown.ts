/**
 * Branded PDF rendering of the billing breakdown — the client-facing companion
 * to the billing letter, and the only rendering of BillingBreakdownParams:
 *
 *   - the firm's own palette, derived from its two configured brand colours
 *   - the firm's own logo + address header on every page
 *   - Lawyer blocks, each grouped by matter
 *   - "Page X of Y" footer
 *
 * This document keeps its own tighter geometry (it is a working schedule, not
 * stationery) but takes its identity from the same `Brand` the proposal and fee
 * schedules render in, so a client receiving both sees one firm.
 *
 * Built on pdfkit (already used in app/api/firm-calendar/export-pdf).
 */

import type { BillingBreakdownParams, LawyerBlock, ExpenseEntry, AcceptanceFee } from '@/lib/billing/breakdown-types';
import { groupEntriesByMatter } from '@/lib/billing/group-entries-by-matter';
import { brandedDocument, imageAspect, FONT, type Brand, type BrandedDoc } from './brand';
import type { Palette } from './palette';

export type BillingBreakdownPdfParams = BillingBreakdownParams & {
  /** Client name shown in the title block. */
  clientName?: string;
  /** Invoice number printed in the footer. */
  invoiceNumber?: string;
  /** Retainer cap in hours; if set, surfaces under the within-retainer header. */
  retainerHoursCap?: number | null;
  /** Settle-from-deposit matters: the slice of the client's advance deposit
   *  this bill draws down, and what stays in trust after. When set, the
   *  summary shows the deduction and an AMOUNT DUE line under the grand total. */
  depositApplied?: number;
  depositRemaining?: number;
  /**
   * Stamp a translucent diagonal "DRAFT" watermark on every page. Used when
   * finance previews an as-yet-unapproved bundle, so a draft breakdown can never
   * be mistaken for the final, approved one.
   */
  draft?: boolean;
};

/**
 * The breakdown's ink names, mapped onto the shared derived palette. Kept as a
 * local mapping rather than renaming ~66 call sites: the roles this document
 * needs (five steps of primary, three of accent) are exactly the ramp
 * derivePalette already produces.
 */
function inks(p: Palette) {
  return {
    navy900: p.primaryDeep,
    navy800: p.primary,
    navy700: p.primaryMid,
    navy600: p.primarySoft,
    navy500: p.primaryFaint,
    gold600: p.accentDeep,
    gold500: p.accent,
    gold100: p.accentPale,
    gold50: p.surfacePage,
    textPrimary: p.ink,
    textBody: p.inkSoft,
    textMuted: p.inkMuted,
    border: p.border,
    white: p.white,
  } as const;
}

// ── Page geometry (A4 portrait, pts) ────────────────────────────────
const PAGE = { width: 595.28, height: 841.89 };
const MARGIN = { top: 50, right: 45, bottom: 60, left: 45 };
const CONTENT_W = PAGE.width - MARGIN.left - MARGIN.right;
// Vertical space kept clear above the bottom margin for the page footer (gold
// rule + invoice/page/firm lines stamped by paintFooters). Content page-breaks
// before reaching this band so no row can overprint the footer.
const FOOTER_RESERVE = 16;

// ── Column layout for entry tables ──────────────────────────────────
const COL = {
  date:     { x: MARGIN.left,            w: 60,  align: 'left' as const },
  hours:    { x: MARGIN.left + 60,       w: 40,  align: 'right' as const },
  desc:     { x: MARGIN.left + 105,      w: CONTENT_W - 105 - 95 },
  amount:   { x: MARGIN.left + CONTENT_W - 90, w: 90, align: 'right' as const },
};

function fmtPHP(n: number): string {
  if (n === 0) return '—';
  const abs = Math.abs(n);
  const s = abs.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n < 0 ? `(${s})` : s;
}

function fmtHours(n: number): string {
  return n.toFixed(1);
}

/**
 * An amount carrying the currency symbol — the emphasis bands, the grand total,
 * the amount due, the courtesy lines. The entry tables stay unprefixed (a symbol
 * on every row of a time sheet is noise), so this is the only place the symbol
 * is printed.
 *
 * It comes off the brand for the same reason `peso()` in lib/pdf/letterhead.ts
 * takes it off the font set: a core-font set has no ₱ (U+20B1) to print, and
 * hard-coding one would drop a notdef box into a bill. Hard-coding "P" was the
 * mirror of that bug — the firm's fee schedule printed ₱ and the invoice bound
 * with it printed P.
 */
function money(doc: Doc, n: number): string {
  return `${doc.brand.pesoSymbol}${fmtPHP(n)}`;
}

/** "2026-04-15" → "15-Apr" */
function fmtShortDate(iso: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${String(d).padStart(2, '0')}-${months[m - 1]}`;
}

export async function generateBillingBreakdownPdf(
  brand: Brand,
  params: BillingBreakdownPdfParams,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // Zero margins on all sides so the accent top rule + header can paint to
    // the very edges; content is positioned with our own MARGIN.
    const doc = brandedDocument(brand, {
      // bufferPages lets paintFooters() iterate every page after content is
      // drawn (default false drops earlier pages).
      bufferPages: true,
      info: {
        Title: `Billing Breakdown ${params.invoiceNumber ?? ''}`.trim(),
        Author: brand.documentName,
        Subject: `Billing breakdown — ${params.billingPeriod}`,
      },
    });

    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    try {
      drawDocument(doc, params);
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

// ── Drawing helpers ─────────────────────────────────────────────────

type Doc = BrandedDoc;

/**
 * pdfkit carries the current font — its metrics, normalised to a 1000-unit em,
 * and what `.font()` was last called with — but @types/pdfkit declares none of
 * it, and there is no public getter for "which face is selected right now".
 * Same shape of access as `openImage` in ./brand.ts; reading these three to put
 * a face back afterwards is pdfkit's own idiom (its table mixin's rollbackFont).
 */
interface CurrentFont {
  _font: { ascender: number; xHeight: number };
  _fontSize: number;
  _fontSource: string | Buffer;
  _fontFamily: string | undefined;
}

/** Re-select the face that is selected now, after something else has drawn. */
function restoreFont(doc: Doc): () => void {
  const { _fontSource: src, _fontFamily: family, _fontSize: size } = doc as unknown as CurrentFont;
  return () => {
    if (family) doc.font(src, family, size);
    else doc.font(src, size);
  };
}

/**
 * Rule through every line of a waived cell. The strike spans the column, not the
 * text, which is how the single-line case has always drawn; `textH` is the
 * height the cell was measured at, so a description that wrapped gets a rule per
 * line instead of one through its first line and nothing through the rest.
 *
 * The height of the rule within the line is read off the face rather than fixed:
 * a strike belongs halfway up the x-height, and every face puts that somewhere
 * else. The constant this replaced (5pt below the top of the line) crossed
 * Times' lowercase at a third of its x-height, but sits 20% *above* EB
 * Garamond's — which has a taller ascent and a smaller x-height — so the rule
 * cleared the letters entirely and a waived line stopped looking waived.
 *
 * Call it with the cell's own font and size selected.
 */
function strikeThrough(doc: Doc, x: number, y: number, w: number, textH: number, color: string): void {
  const lineH = doc.currentLineHeight(true);
  const lines = Math.max(1, Math.round(textH / lineH));
  const { _font: face, _fontSize: size } = doc as unknown as CurrentFont;
  const strikeY = ((face.ascender - face.xHeight / 2) / 1000) * size;
  doc.save().lineWidth(0.6).strokeColor(color);
  for (let i = 0; i < lines; i++) {
    const ruleY = y + strikeY + i * lineH;
    doc.moveTo(x, ruleY).lineTo(x + w, ruleY).stroke();
  }
  doc.restore();
}

function drawDocument(doc: Doc, params: BillingBreakdownPdfParams): void {
  // Bind params into the page-break helper via closure so it can repaint the
  // header on every new page without threading params through every function.
  // paintFooters() stamps a gold rule at (PAGE.height - MARGIN.bottom + 10) with
  // text below it — i.e. inside the bottom margin band. We stop content a
  // FOOTER_RESERVE *above* the margin so even an under-measured row keeps clear
  // of that footer band rather than printing into it.
  const ensureRoomCtx = (y: number, needed: number): number => {
    const limit = PAGE.height - MARGIN.bottom - FOOTER_RESERVE;
    if (y + needed > limit) {
      // The face has to survive the break. Every row loop selects its font
      // before asking for room — it has to, to measure the row it is asking
      // for — and repainting the header leaves pdfkit's current face on the
      // last thing the header set, its italic TIN line. Without this the first
      // row on every new page printed in the header's italic: matter name,
      // particulars and amount alike, on a bill.
      const restore = restoreFont(doc);
      doc.addPage();
      const top = drawHeader(doc, params) + 4;
      restore();
      return top;
    }
    return y;
  };

  let cursorY = drawHeader(doc, params);
  cursorY = drawTitleBlock(doc, params, cursorY);

  // Acceptance fees (rare but supported)
  if (params.acceptanceFees && params.acceptanceFees.length > 0) {
    cursorY = drawAcceptanceFees(doc, params.acceptanceFees, cursorY, ensureRoomCtx);
  }

  // Lawyer-grouped hours. The within/beyond split is meaningful only when
  // there's actually a retainer cap. Without one, all hours are professional
  // fees billed at the lawyer rate, and pretending otherwise ("Within
  // Retainer Hours" totalling more than the cap) is misleading.
  // Absorption is driven by a retainer HOURS CAP, not by the mere presence of a
  // monthly retainer. A flat monthly retainer with no cap is an availability fee
  // — every billable hour is charged on top as professional fees (this matches
  // the letter total from computeCapAwareFees). Only when a cap applies are the
  // within-cap hours truly absorbed and shown as informational.
  // Absorption requires BOTH a cap and a retainer for the within-cap hours to be
  // absorbed into. A cap with no monthly retainer is treated as no cap — every
  // hour is charged as professional fees (matches computeCapAwareFees).
  const hasCap = (params.retainerHoursCap ?? 0) > 0 && params.monthlyRetainer > 0;
  const withinLabel = hasCap
    ? `Within Retainer Hours (cap: ${params.retainerHoursCap}h)`
    : 'Professional Fees';

  if (params.withinRetainer.length > 0) {
    cursorY = drawLawyerSection(
      doc,
      withinLabel,
      params.withinRetainer,
      cursorY,
      /*charge*/ !hasCap, // absorbed only when a cap actually applies
      ensureRoomCtx,
    );
  }

  // Lawyer-grouped hours beyond retainer (charged). Only render when a cap is in
  // play — otherwise "beyond retainer" makes no sense and everything already
  // lives under the single "Professional Fees" head above.
  if (params.beyondRetainer.length > 0 && hasCap) {
    cursorY = drawLawyerSection(doc, 'Beyond Retainer Hours', params.beyondRetainer, cursorY, /*charge*/ true, ensureRoomCtx);
  }

  // Monthly retainer line, if any
  if (params.monthlyRetainer > 0) {
    cursorY = drawRetainerLine(doc, params.monthlyRetainer, cursorY, ensureRoomCtx);
  }

  // Non-DTR fee sections (new billing types). Each is rendered only when
  // the corresponding feeLines kind is present.
  const fees = params.feeLines ?? [];
  const fixedFees = fees.filter((f) => f.kind === 'fixed_fee');
  const actionFees = fees.filter((f) => f.kind === 'action');
  const milestoneFees = fees.filter((f) => f.kind === 'milestone');
  const adHocFees = fees.filter((f) => f.kind === 'adhoc');
  const infoHours = fees.filter((f) => f.kind === 'informational_hours');
  const discounts = fees.filter((f) => f.kind === 'discount');

  if (fixedFees.length > 0) {
    cursorY = drawFeeLineTable(doc, 'Fixed Fees', fixedFees, cursorY, ensureRoomCtx);
  }
  if (actionFees.length > 0) {
    cursorY = drawFeeLineTable(doc, 'Per-Action Fees', actionFees, cursorY, ensureRoomCtx);
  }
  if (milestoneFees.length > 0) {
    cursorY = drawFeeLineTable(doc, 'Milestones', milestoneFees, cursorY, ensureRoomCtx);
  }
  if (adHocFees.length > 0) {
    cursorY = drawFeeLineTable(doc, 'Additional Items', adHocFees, cursorY, ensureRoomCtx);
  }
  if (infoHours.length > 0) {
    cursorY = drawInformationalHours(doc, infoHours, cursorY, ensureRoomCtx);
  }
  if (discounts.length > 0) {
    cursorY = drawDiscountSection(doc, discounts, cursorY, ensureRoomCtx);
  }

  // Total legal fees emphasis row (already includes the discount adjustment
  // since computeTotalLegalFees sums feeLines and discount amounts are
  // negative).
  const totalLegalFees = computeTotalLegalFees(params);
  cursorY = drawEmphasisTotal(doc, 'Total Legal Fees', totalLegalFees, cursorY, ensureRoomCtx);

  // Expenses section
  let totalExpenses = 0;
  if (params.expenses.length > 0) {
    const result = drawExpenses(doc, params.expenses, cursorY, ensureRoomCtx);
    cursorY = result.cursorY;
    totalExpenses = result.total;
    cursorY = drawEmphasisTotal(doc, 'Total Out-of-Pocket Expenses', totalExpenses, cursorY, ensureRoomCtx);
  }

  // VAT + grand total summary
  cursorY = drawSummary(doc, params, totalLegalFees, totalExpenses, cursorY, ensureRoomCtx);

  // Stamp every page with the footer + page numbers
  paintFooters(doc, params);

  // Draft watermark on top of everything (translucent, so content stays legible)
  if (params.draft) paintDraftWatermark(doc);
}

type EnsureRoom = (y: number, needed: number) => number;

// ── Header ──────────────────────────────────────────────────────────

function drawHeader(doc: Doc, params: BillingBreakdownPdfParams): number {
  const COLOR = inks(doc.brand.palette);
  const startY = MARGIN.top;

  // Top gold rule across the full page width
  doc.save()
    .moveTo(0, 0)
    .lineTo(PAGE.width, 0)
    .lineWidth(4)
    .strokeColor(COLOR.gold500)
    .stroke()
    .restore();

  const logoPath = doc.brand.assets.logo;
  // Render the firm's logo ~150pt wide, hugging the left margin so the address
  // column has room on the right. Height follows the file's own aspect ratio.
  const LOGO_W = 150;
  let logoRight = MARGIN.left;
  let logoH = 0;
  if (logoPath) {
    try {
      doc.image(logoPath, MARGIN.left, startY, { width: LOGO_W });
      logoRight = MARGIN.left + LOGO_W;
      // The header rule clears the logo, so its drawn height has to come from
      // the file's own proportions — a fixed ratio squashes any mark that is
      // not the shape the single-firm header was drawn around.
      logoH = LOGO_W / (imageAspect(doc, logoPath) || 2.85);
    } catch {
      // Image embed failed — fall through to text-only header
    }
  }
  if (logoRight === MARGIN.left) {
    // No logo configured (or it would not embed) — set the firm's name
    // typographically in its place. Span the full content width with the name
    // on top and the address on the row below, so the header stays balanced.
    doc.font(FONT.bodyB)
      .fontSize(20)
      .fillColor(COLOR.navy900)
      .text(doc.brand.documentName.toUpperCase(), MARGIN.left, startY, {
        width: CONTENT_W,
        align: 'center',
        characterSpacing: 1.4,
      });
    // Address goes BELOW the wordmark (full-width, centered) instead of in
    // the right column, since there's no logo column to balance against.
    const addrTop = startY + 48;
    doc.font(FONT.body).fontSize(10).fillColor(COLOR.textBody);
    let addrY = addrTop;
    if (params.firmAddress) {
      const h = doc.heightOfString(params.firmAddress, { width: CONTENT_W, align: 'center' });
      doc.text(params.firmAddress, MARGIN.left, addrY, { width: CONTENT_W, align: 'center' });
      addrY += h;
    }
    if (params.firmAddress2) {
      const h = doc.heightOfString(params.firmAddress2, { width: CONTENT_W, align: 'center' });
      doc.text(params.firmAddress2, MARGIN.left, addrY, { width: CONTENT_W, align: 'center' });
      addrY += h;
    }
    if (params.firmTIN) {
      doc.font(FONT.bodyIt).fontSize(9.5).fillColor(COLOR.textMuted);
      const h = doc.heightOfString(params.firmTIN, { width: CONTENT_W, align: 'center' });
      doc.text(params.firmTIN, MARGIN.left, addrY, { width: CONTENT_W, align: 'center' });
      addrY += h;
    }
    // Bottom rule under the centered header
    const ruleY = addrY + 8;
    doc.save()
      .moveTo(MARGIN.left, ruleY)
      .lineTo(MARGIN.left + CONTENT_W, ruleY)
      .lineWidth(0.5)
      .strokeColor(COLOR.gold500)
      .stroke()
      .restore();
    return ruleY + 18;
  }

  // Address block on the right. Computed from the bottom of the logo so the
  // header has a consistent baseline regardless of whether the logo embedded.
  // Each line may wrap on narrow viewports, so we measure with the CURRENT
  // font (set before each measurement) and advance by the actual rendered
  // height — fixed 13pt steps would let a wrapped line stack on top.
  const addrTop = startY + 6;
  const addrW = CONTENT_W - (logoRight - MARGIN.left) - 12;
  const addrX = logoRight + 12;
  let addrY = addrTop;
  const addrLineGap = 2; // vertical breathing room between address lines

  if (params.firmAddress) {
    doc.font(FONT.body).fontSize(10).fillColor(COLOR.textBody);
    const h = doc.heightOfString(params.firmAddress, { width: addrW, align: 'right' });
    doc.text(params.firmAddress, addrX, addrY, { width: addrW, align: 'right' });
    addrY += h + addrLineGap;
  }
  if (params.firmAddress2) {
    doc.font(FONT.body).fontSize(10).fillColor(COLOR.textBody);
    const h = doc.heightOfString(params.firmAddress2, { width: addrW, align: 'right' });
    doc.text(params.firmAddress2, addrX, addrY, { width: addrW, align: 'right' });
    addrY += h + addrLineGap;
  }
  if (params.firmTIN) {
    doc.font(FONT.bodyIt).fontSize(9.5).fillColor(COLOR.textMuted);
    const h = doc.heightOfString(params.firmTIN, { width: addrW, align: 'right' });
    doc.text(params.firmTIN, addrX, addrY, { width: addrW, align: 'right' });
    addrY += h + addrLineGap;
  }

  // Bottom thin gold rule below the header band
  const ruleY = Math.max(startY + logoH + 4, addrY + 6);
  doc.save()
    .moveTo(MARGIN.left, ruleY)
    .lineTo(MARGIN.left + CONTENT_W, ruleY)
    .lineWidth(0.5)
    .strokeColor(COLOR.gold500)
    .stroke()
    .restore();

  return ruleY + 18;
}

// ── Title block ─────────────────────────────────────────────────────

function drawTitleBlock(doc: Doc, params: BillingBreakdownPdfParams, y: number): number {
  const COLOR = inks(doc.brand.palette);
  doc.font(FONT.bodyB)
    .fontSize(18)
    .fillColor(COLOR.navy900)
    .text('Billing Breakdown', MARGIN.left, y, {
      width: CONTENT_W,
      align: 'center',
      characterSpacing: 0.5,
    });

  doc.font(FONT.bodyIt)
    .fontSize(11)
    .fillColor(COLOR.navy600)
    .text(params.billingPeriod, MARGIN.left, y + 26, {
      width: CONTENT_W,
      align: 'center',
    });

  if (!params.clientName) return y + 56;

  // A corporate client's full style ("… Holdings and Development Corporation,
  // Inc.") can take a second line, so the block ends where the name actually
  // ended rather than a fixed 70pt down.
  doc.font(FONT.body).fontSize(11).fillColor(COLOR.textPrimary);
  const nameH = doc.heightOfString(params.clientName, { width: CONTENT_W, align: 'center' });
  doc.text(params.clientName, MARGIN.left, y + 44, { width: CONTENT_W, align: 'center' });

  return y + 44 + nameH + 12;
}

// ── Acceptance fees ─────────────────────────────────────────────────

function drawAcceptanceFees(doc: Doc, fees: AcceptanceFee[], y: number, ensureRoom: EnsureRoom): number {
  const COLOR = inks(doc.brand.palette);
  y = drawSectionHeader(doc, 'Acceptance Fees', y, ensureRoom);

  // Both lines of a fee wrap — the matter style is long and the case
  // description is a sentence — so each advances by its measured height. A fixed
  // 15pt step assumed one line apiece and printed the next fee's title straight
  // over the tail of the previous description.
  const titleW = CONTENT_W - 100;
  const descW = CONTENT_W - 110;
  for (const f of fees) {
    doc.font(FONT.body).fontSize(10.5);
    const titleH = Math.max(15, doc.heightOfString(f.clientOrMatter, { width: titleW }));
    let descH = 0;
    if (f.caseDescription) {
      doc.font(FONT.bodyIt).fontSize(10);
      descH = Math.max(15, doc.heightOfString(f.caseDescription, { width: descW }));
    }
    // Keep a fee's description with the fee it belongs to.
    y = ensureRoom(y, titleH + descH + 4);

    doc.font(FONT.body).fontSize(10.5).fillColor(COLOR.textPrimary);
    doc.text(f.clientOrMatter, MARGIN.left, y, { width: titleW });
    doc.text(fmtPHP(f.amount), COL.amount.x, y, { width: COL.amount.w, align: 'right' });
    y += titleH;
    if (f.caseDescription) {
      doc.font(FONT.bodyIt).fontSize(10).fillColor(COLOR.textBody);
      doc.text(f.caseDescription, MARGIN.left + 12, y, { width: descW });
      y += descH;
    }
    y += 4;
  }

  return y + 6;
}

// ── Lawyer section (within / beyond retainer) ───────────────────────

function drawLawyerSection(
  doc: Doc,
  title: string,
  blocks: LawyerBlock[],
  y: number,
  charge: boolean,
  ensureRoom: EnsureRoom,
): number {
  const COLOR = inks(doc.brand.palette);
  y = drawSectionHeader(doc, title, y, ensureRoom);

  let sectionTotal = 0;
  for (const block of blocks) {
    y = ensureRoom(y, 50);
    // Lawyer name + position
    doc.font(FONT.bodyB).fontSize(12).fillColor(COLOR.navy800);
    doc.text(block.initials ? `${block.name} (${block.initials})` : block.name, MARGIN.left, y);
    if (block.position) {
      doc.font(FONT.bodyIt).fontSize(10).fillColor(COLOR.navy500);
      doc.text(block.position, MARGIN.left, y, { width: CONTENT_W, align: 'right' });
    }
    y += 18;

    // Column headers
    doc.save();
    doc.moveTo(MARGIN.left, y - 2).lineTo(MARGIN.left + CONTENT_W, y - 2).lineWidth(0.5).strokeColor(COLOR.navy500).stroke();
    doc.restore();

    doc.font(FONT.bodyB).fontSize(9).fillColor(COLOR.navy700 ?? COLOR.navy800);
    doc.text('DATE',        COL.date.x,   y, { width: COL.date.w, characterSpacing: 0.5 });
    doc.text('HOURS',       COL.hours.x,  y, { width: COL.hours.w, align: 'right', characterSpacing: 0.5 });
    doc.text('PARTICULARS', COL.desc.x,   y, { width: COL.desc.w, characterSpacing: 0.5 });
    doc.text('AMOUNT',      COL.amount.x, y, { width: COL.amount.w, align: 'right', characterSpacing: 0.5 });
    y += 14;
    doc.save();
    doc.moveTo(MARGIN.left, y - 2).lineTo(MARGIN.left + CONTENT_W, y - 2).lineWidth(0.5).strokeColor(COLOR.border).stroke();
    doc.restore();

    // Entries. Important: set the entry font BEFORE measuring the description
    // height — pdfkit's heightOfString uses the *current* font, and if we
    // measure with the column-header font (FONT.bodyB 9pt) the wrapped multi-
    // line description gets undercounted and the next row stacks on top.
    let blockTotal = 0;
    // One sub-table per matter, so the client reads the lawyer's time the way
    // the firm's statements present it: lawyer → matter → entries.
    const matterGroups = groupEntriesByMatter(block.entries);
    for (const group of matterGroups) {
      const drawMatterHeading = (suffix = '') => {
        doc.font(FONT.bodyB).fontSize(9.5).fillColor(COLOR.navy700);
        doc.text(`${group.label}${suffix}`, MARGIN.left, y, { width: CONTENT_W });
        y += 14;
      };
      if (group.label) {
        // Keep the heading with at least one row of its table.
        y = ensureRoom(y, 34);
        drawMatterHeading();
      }

      for (const e of group.entries) {
        const amount = e.hours * e.hourlyRate;
        if (!e.waived) blockTotal += amount; // waived: shown, but ₱0 to the bill

        doc.font(FONT.body).fontSize(9.5);
        const descH = doc.heightOfString(e.description || '—', {
          width: COL.desc.w,
          align: 'left',
        });
        const rowH = Math.max(14, descH + 4);
        const beforeBreak = y;
        y = ensureRoom(y, rowH + 4);
        // A matter that spills onto the next page re-announces itself — otherwise
        // the continuation rows read as belonging to whatever heading came last.
        if (y < beforeBreak && group.label) drawMatterHeading(' (continued)');

        doc.font(FONT.body).fontSize(9.5);
        doc.fillColor(e.waived ? COLOR.textMuted : COLOR.textPrimary);
        doc.text(fmtShortDate(e.date), COL.date.x, y, { width: COL.date.w });
        doc.text(fmtHours(e.hours),    COL.hours.x, y, { width: COL.hours.w, align: 'right' });
        doc.text(e.description || '—', COL.desc.x, y, { width: COL.desc.w });
        if (e.waived) {
          // "Waived" in place of the amount + a strikethrough across the particulars.
          doc.font(FONT.bodyIt).fillColor(COLOR.gold600);
          doc.text('Waived', COL.amount.x, y, { width: COL.amount.w, align: 'right' });
          doc.font(FONT.body);
          strikeThrough(doc, COL.desc.x, y, COL.desc.w, descH, COLOR.textMuted);
        } else {
          doc.text(fmtPHP(amount), COL.amount.x, y, { width: COL.amount.w, align: 'right' });
        }

        y += rowH + 2; // small breathing room so descenders don't kiss the rule
        doc.save();
        doc.moveTo(MARGIN.left, y - 1).lineTo(MARGIN.left + CONTENT_W, y - 1).lineWidth(0.25).strokeColor(COLOR.border).stroke();
        doc.restore();
        y += 3;
      }

      // Breathing room between one matter's table and the next.
      if (group.label && matterGroups.length > 1) y += 6;
    }

    // Subtotal for this lawyer. Guarded so a block that ends near the page
    // bottom pushes its subtotal to the next page instead of over the footer.
    y = ensureRoom(y, 22);
    y += 2;
    doc.font(FONT.bodyB).fontSize(9.5).fillColor(COLOR.navy800);
    doc.text(`${block.name} — Subtotal`, MARGIN.left, y, { width: CONTENT_W - 100 });
    doc.text(fmtPHP(blockTotal), COL.amount.x, y, { width: COL.amount.w, align: 'right' });
    y += 18;

    sectionTotal += blockTotal;
  }

  // Section subtotal — only show when charging the client (within-retainer is
  // informational; the math is absorbed by the monthly retainer line).
  if (charge && blocks.length > 1) {
    y = ensureRoom(y, 24);
    doc.save();
    doc.moveTo(MARGIN.left, y).lineTo(MARGIN.left + CONTENT_W, y).lineWidth(0.75).strokeColor(COLOR.navy600).stroke();
    doc.restore();
    y += 4;
    doc.font(FONT.bodyB).fontSize(10).fillColor(COLOR.navy900);
    doc.text(`${title} — Total`, MARGIN.left, y, { width: CONTENT_W - 100 });
    doc.text(fmtPHP(sectionTotal), COL.amount.x, y, { width: COL.amount.w, align: 'right' });
    y += 18;
  } else if (!charge) {
    // Informational note for the within-retainer block. Guarded so it never
    // prints over the footer when the section ends low on the page.
    y = ensureRoom(y, 22);
    y += 2;
    doc.font(FONT.bodyIt).fontSize(8.5).fillColor(COLOR.textMuted);
    doc.text(
      'Hours absorbed by the monthly retainer — not charged separately.',
      MARGIN.left, y, { width: CONTENT_W, align: 'right' },
    );
    y += 16;
  }

  return y + 4;
}

// ── Monthly retainer ─────────────────────────────────────────────────

function drawRetainerLine(doc: Doc, retainer: number, y: number, ensureRoom: EnsureRoom): number {
  const COLOR = inks(doc.brand.palette);
  y = ensureRoom(y, 24);
  y = drawSectionHeader(doc, 'Monthly Retainer', y, ensureRoom);
  doc.font(FONT.body).fontSize(10).fillColor(COLOR.textPrimary);
  doc.text('Monthly retainer fee', MARGIN.left, y, { width: CONTENT_W - 100 });
  doc.text(fmtPHP(retainer), COL.amount.x, y, { width: COL.amount.w, align: 'right' });
  return y + 22;
}

// ── feeLines tables (fixed_fee / action / milestone) ────────────────

interface FeeLineLike {
  matterName: string | null;
  description: string;
  amount: number;
  quantity?: number;
}

/**
 * The two pieces of text a fee row prints: the description, and — for a row
 * that aggregates a count of occurrences ('action' lines) — the unit line
 * spelling out the arithmetic behind the amount, "14 × ₱1,500.00". A client
 * checking a per-action bill checks the count first; an aggregate row that
 * shows only its total asks them to take the figure on faith.
 *
 * Two things it is careful about:
 *
 *  - The rate is derived (amount ÷ quantity), so it is only printed when it
 *    multiplies back to the amount on the same row. A row whose amount was
 *    adjusted away from rate × quantity shows the count alone rather than a
 *    unit rate that doesn't reconcile with what is printed beside it.
 *  - deriveFeeLines bakes the count into the description ("Court Appearance
 *    (appearance) × 3") so consumers that render only the text still show it.
 *    This document renders the count structurally, so it drops the baked-in
 *    marker — but only when its number is exactly the row's quantity, leaving
 *    anything that says more than the count ("× 3 of 4 cap") untouched.
 *
 * Exported for the unit test; the renderer is the only other caller.
 */
export function feeLineUnits(
  row: { description: string; amount: number; quantity?: number },
  pesoSymbol: string,
): { description: string; unitDetail: string | null } {
  const qty = row.quantity;
  if (qty == null || !Number.isFinite(qty) || qty <= 0) {
    return { description: row.description, unitDetail: null };
  }

  const qtyText = qty.toLocaleString('en-PH', { maximumFractionDigits: 2 });
  const unit = Math.round((row.amount / qty) * 100) / 100;
  const reconciles = unit > 0 && Math.abs(unit * qty - row.amount) < 0.005;

  // Strip the description's own "× N" only when N is this row's quantity.
  const marker = row.description.match(/\s*[×x]\s*(\d+(?:\.\d+)?)\s*$/);
  const description = marker && Number(marker[1]) === qty
    ? row.description.slice(0, marker.index).trimEnd()
    : row.description;

  return {
    description,
    unitDetail: reconciles ? `${qtyText} × ${pesoSymbol}${fmtPHP(unit)}` : `× ${qtyText}`,
  };
}

/** Renders a feeLines bucket as a Matter / Description / Amount table. */
function drawFeeLineTable(
  doc: Doc,
  title: string,
  rows: FeeLineLike[],
  y: number,
  ensureRoom: EnsureRoom,
): number {
  const COLOR = inks(doc.brand.palette);
  y = drawSectionHeader(doc, title, y, ensureRoom);

  // Column layout: matter (40%) | description (40%) | amount (right-aligned)
  const matterX = MARGIN.left;
  const matterW = Math.round(CONTENT_W * 0.35);
  const descX = matterX + matterW + 10;
  const descW = CONTENT_W - matterW - 10 - 95;

  // Headers
  doc.font(FONT.bodyB).fontSize(9).fillColor(COLOR.navy700);
  doc.text('MATTER', matterX, y, { width: matterW, characterSpacing: 0.5 });
  doc.text('DESCRIPTION', descX, y, { width: descW, characterSpacing: 0.5 });
  doc.text('AMOUNT', COL.amount.x, y, { width: COL.amount.w, align: 'right', characterSpacing: 0.5 });
  y += 14;
  doc.save();
  doc.moveTo(MARGIN.left, y - 2).lineTo(MARGIN.left + CONTENT_W, y - 2).lineWidth(0.5).strokeColor(COLOR.navy500).stroke();
  doc.restore();

  let total = 0;
  for (const r of rows) {
    total += r.amount;
    const { description, unitDetail } = feeLineUnits(r, doc.brand.pesoSymbol);
    doc.font(FONT.body).fontSize(10);
    const matterH = doc.heightOfString(r.matterName ?? '—', { width: matterW });
    const descH = doc.heightOfString(description, { width: descW });
    const rowH = Math.max(14, matterH + 4, descH + 4);
    // The unit line is part of the row: reserved here so a page break can never
    // land between an amount and the arithmetic behind it.
    y = ensureRoom(y, rowH + (unitDetail ? 13 : 0) + 4);

    doc.fillColor(COLOR.textPrimary);
    doc.text(r.matterName ?? '—', matterX, y, { width: matterW });
    doc.text(description, descX, y, { width: descW });
    doc.text(fmtPHP(r.amount), COL.amount.x, y, { width: COL.amount.w, align: 'right' });

    y += rowH + 2;

    // Count and unit rate behind an aggregated row — same italic, indented
    // sub-line the photocopy expenses spell their arithmetic out on.
    if (unitDetail) {
      doc.font(FONT.bodyIt).fontSize(9).fillColor(COLOR.textMuted);
      doc.text(unitDetail, descX + 8, y, { width: descW - 8 });
      y += 13;
    }

    doc.save();
    doc.moveTo(MARGIN.left, y - 1).lineTo(MARGIN.left + CONTENT_W, y - 1).lineWidth(0.25).strokeColor(COLOR.border).stroke();
    doc.restore();
    y += 3;
  }

  // Section subtotal when there are 2+ rows
  if (rows.length > 1) {
    y = ensureRoom(y, 22);
    doc.save();
    doc.moveTo(MARGIN.left, y).lineTo(MARGIN.left + CONTENT_W, y).lineWidth(0.75).strokeColor(COLOR.navy600).stroke();
    doc.restore();
    y += 4;
    doc.font(FONT.bodyB).fontSize(10).fillColor(COLOR.navy900);
    doc.text(`${title} — Total`, MARGIN.left, y, { width: CONTENT_W - 100 });
    doc.text(fmtPHP(total), COL.amount.x, y, { width: COL.amount.w, align: 'right' });
    y += 18;
  }

  return y + 4;
}

/** Renders a discount line — italic, gold-tinted, right-aligned amount in
 *  parens so it visually subtracts. */
function drawDiscountSection(
  doc: Doc,
  rows: FeeLineLike[],
  y: number,
  ensureRoom: EnsureRoom,
): number {
  const COLOR = inks(doc.brand.palette);
  y = drawSectionHeader(doc, 'Discount', y, ensureRoom);

  for (const r of rows) {
    doc.font(FONT.bodyIt).fontSize(10);
    const descH = doc.heightOfString(r.description, { width: CONTENT_W - 110 });
    const rowH = Math.max(14, descH + 4);
    y = ensureRoom(y, rowH + 4);

    doc.fillColor(COLOR.gold600);
    doc.text(r.description, MARGIN.left, y, { width: CONTENT_W - 110 });
    // amount is negative — fmtPHP wraps negatives in parens.
    doc.text(fmtPHP(r.amount), COL.amount.x, y, { width: COL.amount.w, align: 'right' });
    y += rowH + 2;
    doc.save();
    doc.moveTo(MARGIN.left, y - 1).lineTo(MARGIN.left + CONTENT_W, y - 1).lineWidth(0.25).strokeColor(COLOR.border).stroke();
    doc.restore();
    y += 3;
  }

  return y + 4;
}

/** Renders informational hours (no charge) — used for fixed-retainer matters
 *  where DTR hours are tracked for transparency but not billed. */
function drawInformationalHours(
  doc: Doc,
  rows: FeeLineLike[],
  y: number,
  ensureRoom: EnsureRoom,
): number {
  const COLOR = inks(doc.brand.palette);
  y = drawSectionHeader(doc, 'Hours Rendered (informational)', y, ensureRoom);

  // Measured at the widths the cells are actually drawn at, and against both
  // columns: the description was being measured 10pt wider than its own column
  // and the matter name not at all, so a row whose either half wrapped was given
  // less height than it takes.
  const matterW = 200;
  const descX = MARGIN.left + matterW + 10;
  const descW = CONTENT_W - matterW - 10;
  for (const r of rows) {
    doc.font(FONT.body).fontSize(10);
    const matterH = doc.heightOfString(r.matterName ?? '—', { width: matterW });
    const descH = doc.heightOfString(r.description, { width: descW });
    const rowH = Math.max(14, matterH + 4, descH + 4);
    y = ensureRoom(y, rowH + 4);

    doc.fillColor(COLOR.textPrimary);
    doc.text(r.matterName ?? '—', MARGIN.left, y, { width: matterW });
    doc.text(r.description, descX, y, { width: descW });
    y += rowH + 4;
  }

  doc.font(FONT.bodyIt).fontSize(9).fillColor(COLOR.textMuted);
  doc.text(
    'These hours are tracked for transparency but absorbed by the fixed retainer — not charged separately.',
    MARGIN.left, y, { width: CONTENT_W, align: 'right' },
  );
  return y + 18;
}

// ── Expenses ────────────────────────────────────────────────────────

function drawExpenses(doc: Doc, expenses: ExpenseEntry[], y: number, ensureRoom: EnsureRoom): { cursorY: number; total: number } {
  const COLOR = inks(doc.brand.palette);
  y = drawSectionHeader(doc, 'Out-of-Pocket Expenses', y, ensureRoom);

  // Column headers
  doc.font(FONT.bodyIt).fontSize(8).fillColor(COLOR.textMuted);
  doc.text('Date',        COL.date.x,   y, { width: COL.date.w });
  doc.text('Particulars', MARGIN.left + 70, y, { width: CONTENT_W - 70 - 95 });
  doc.text('Amount',      COL.amount.x, y, { width: COL.amount.w, align: 'right' });
  y += 12;
  doc.save();
  doc.moveTo(MARGIN.left, y - 2).lineTo(MARGIN.left + CONTENT_W, y - 2).lineWidth(0.5).strokeColor(COLOR.border).stroke();
  doc.restore();

  let total = 0;
  const descX = MARGIN.left + 70;
  const descW = CONTENT_W - 70 - 95;
  for (const e of expenses) {
    if (!e.waived) total += e.amount; // waived: shown, but ₱0 to the bill
    // Same heightOfString pitfall as the lawyer section — set the font before
    // measuring so wrapped descriptions get a correct row height.
    doc.font(FONT.body).fontSize(9.5);
    const descH = doc.heightOfString(e.description || '—', { width: descW });
    const rowH = Math.max(14, descH + 4);
    y = ensureRoom(y, rowH + 4);

    doc.fillColor(e.waived ? COLOR.textMuted : COLOR.textPrimary);
    doc.text(fmtShortDate(e.date), COL.date.x, y, { width: COL.date.w });
    doc.text(e.description || '—', descX, y, { width: descW });
    if (e.waived) {
      doc.font(FONT.bodyIt).fillColor(COLOR.gold600);
      doc.text('Waived', COL.amount.x, y, { width: COL.amount.w, align: 'right' });
      doc.font(FONT.body);
      strikeThrough(doc, descX, y, descW, descH, COLOR.textMuted);
    } else {
      doc.text(fmtPHP(e.amount), COL.amount.x, y, { width: COL.amount.w, align: 'right' });
    }

    y += rowH + 2;

    // Photocopy detail (italic, indented)
    if (e.photocopyDetail) {
      const pd = e.photocopyDetail;
      doc.font(FONT.bodyIt).fontSize(9).fillColor(COLOR.textMuted);
      doc.text(
        `${pd.numberOfSets} sets × ${pd.pagesPerSet} pages × ${doc.brand.pesoSymbol}${pd.costPerPage.toFixed(2)} = ${pd.totalCopies} copies`,
        descX + 8, y, { width: descW - 8 },
      );
      y += 13;
    }

    doc.save();
    doc.moveTo(MARGIN.left, y - 1).lineTo(MARGIN.left + CONTENT_W, y - 1).lineWidth(0.25).strokeColor(COLOR.border).stroke();
    doc.restore();
    y += 3;
  }

  return { cursorY: y + 4, total };
}

// ── Section header ──────────────────────────────────────────────────

// Band height plus the column-header row and one row of table under it. A band
// alone at the foot of a page reads as a mistake — it announces a table that
// starts overleaf — so the header only stays on a page that can also hold the
// first line of what it announces.
const SECTION_HEADER_KEEP = 32 + 30;

function drawSectionHeader(doc: Doc, title: string, y: number, ensureRoom: EnsureRoom): number {
  const COLOR = inks(doc.brand.palette);
  y = ensureRoom(y, SECTION_HEADER_KEEP);

  // Navy band, full content width, ~18pt tall
  const h = 20;
  doc.save();
  doc.rect(MARGIN.left, y, CONTENT_W, h).fill(COLOR.navy800);
  doc.restore();

  doc.font(FONT.bodyB)
    .fontSize(10)
    .fillColor(COLOR.white)
    .text(title.toUpperCase(), MARGIN.left + 10, y + 6, {
      width: CONTENT_W - 20,
      characterSpacing: 1.2,
    });

  return y + h + 8;
}

// ── Emphasis totals (Total Legal Fees, Total Expenses) ──────────────

function drawEmphasisTotal(doc: Doc, label: string, amount: number, y: number, ensureRoom: EnsureRoom): number {
  const COLOR = inks(doc.brand.palette);
  y = ensureRoom(y, 32);

  // Gold-tinted band
  const h = 22;
  doc.save();
  doc.rect(MARGIN.left, y, CONTENT_W, h).fill(COLOR.gold100);
  // Left gold bar
  doc.rect(MARGIN.left, y, 3, h).fill(COLOR.gold500);
  doc.restore();

  doc.font(FONT.bodyB)
    .fontSize(11)
    .fillColor(COLOR.navy900)
    .text(label, MARGIN.left + 12, y + 6, { width: CONTENT_W - 130 });

  doc.font(FONT.bodyB)
    .fontSize(12)
    .fillColor(COLOR.navy900)
    .text(money(doc, amount), COL.amount.x - 10, y + 5, {
      width: COL.amount.w + 10,
      align: 'right',
    });

  return y + h + 10;
}

// ── VAT + grand total summary ───────────────────────────────────────

function drawSummary(
  doc: Doc,
  params: BillingBreakdownPdfParams,
  totalLegalFees: number,
  totalExpenses: number,
  y: number,
  ensureRoom: EnsureRoom,
): number {
  const COLOR = inks(doc.brand.palette);
  const vatRate = params.vatRate ?? 0.12;
  const includeVAT = params.includeVAT;

  y = ensureRoom(y, 120);
  y = drawSectionHeader(doc, 'Summary', y, ensureRoom);

  const labelX = MARGIN.left + 12;
  const labelW = CONTENT_W - 130;

  const drawLine = (label: string, amount: number, opts?: { italic?: boolean; bold?: boolean; muted?: boolean }) => {
    const font = opts?.bold ? FONT.bodyB : opts?.italic ? FONT.bodyIt : FONT.body;
    const color = opts?.muted ? COLOR.textMuted : opts?.bold ? COLOR.navy900 : COLOR.textPrimary;
    doc.font(font).fontSize(10).fillColor(color);
    doc.text(label, labelX, y, { width: labelW });
    doc.text(fmtPHP(amount), COL.amount.x, y, { width: COL.amount.w, align: 'right' });
    y += 16;
  };

  let grand: number;
  if (includeVAT) {
    const vatable = totalLegalFees + totalExpenses;
    const vat = Math.round(vatable * vatRate * 100) / 100;
    grand = vatable + vat + (params.previousBalance ?? 0);
    drawLine('VATable Sales', vatable);
    drawLine(`VAT (${(vatRate * 100).toFixed(0)}%)`, vat);
  } else {
    drawLine('Total Legal Fees', totalLegalFees);
    if (totalExpenses > 0) drawLine('Total Out-of-Pocket Expenses', totalExpenses);
    grand = totalLegalFees + totalExpenses + (params.previousBalance ?? 0);
  }

  if (params.previousBalance && Math.abs(params.previousBalance) > 0.005) {
    const lbl = params.previousBalanceLabel || (params.previousBalance > 0 ? 'Previous Balance' : 'Less: Advance Deposit');
    drawLine(lbl, params.previousBalance, { italic: true, muted: true });
  }

  // Grand total — gold band
  y += 4;
  y = ensureRoom(y, 36);
  const h = 28;
  doc.save();
  doc.rect(MARGIN.left, y, CONTENT_W, h).fill(COLOR.gold500);
  doc.restore();
  doc.font(FONT.bodyB).fontSize(13).fillColor(COLOR.white)
    .text('GRAND TOTAL', MARGIN.left + 14, y + 8, { width: CONTENT_W - 160, characterSpacing: 1.5 });
  doc.font(FONT.bodyB).fontSize(14).fillColor(COLOR.white)
    .text(money(doc, grand), COL.amount.x - 14, y + 7, {
      width: COL.amount.w + 14,
      align: 'right',
    });
  y += h + 10;

  // Settle-from-deposit: show the deposit drawn against this bill and the net
  // amount actually payable. The grand total above stays the full bill — the
  // deposit is a payment against it, not a reduction of it.
  const depositApplied = params.depositApplied ?? 0;
  if (depositApplied > 0.005) {
    const amountDue = Math.max(0, Math.round((grand - depositApplied) * 100) / 100);
    y = ensureRoom(y, 90);
    doc.font(FONT.bodyIt).fontSize(10).fillColor(COLOR.textMuted);
    doc.text('Less: Applied against advance deposit on hand', labelX, y, { width: labelW });
    doc.text(`(${fmtPHP(depositApplied)})`, COL.amount.x, y, { width: COL.amount.w, align: 'right' });
    y += 20;

    // AMOUNT DUE band — navy, so it reads as the figure to act on. A fully
    // covered bill must print P0.00, not fmtPHP's em-dash placeholder.
    const dueH = 28;
    doc.save();
    doc.rect(MARGIN.left, y, CONTENT_W, dueH).fill(COLOR.navy900);
    doc.restore();
    doc.font(FONT.bodyB).fontSize(13).fillColor(COLOR.white)
      .text('AMOUNT DUE', MARGIN.left + 14, y + 8, { width: CONTENT_W - 160, characterSpacing: 1.5 });
    doc.font(FONT.bodyB).fontSize(14).fillColor(COLOR.white)
      .text(`${doc.brand.pesoSymbol}${amountDue === 0 ? '0.00' : fmtPHP(amountDue)}`, COL.amount.x - 14, y + 7, {
        width: COL.amount.w + 14,
        align: 'right',
      });
    y += dueH + 8;

    const remaining = params.depositRemaining ?? 0;
    doc.font(FONT.bodyIt).fontSize(9.5).fillColor(COLOR.textMuted)
      .text(
        remaining > 0.005
          ? `Remaining advance deposit held on your behalf after this application:  ${money(doc, remaining)}`
          : 'This application exhausts the advance deposit held on your behalf.',
        MARGIN.left, y, { width: CONTENT_W, align: 'right' },
      );
    y += 16;
  }

  // Goodwill line: the peso value shown-but-waived, so the client sees the full
  // courtesy in one figure. The grand total already excludes it — this does NOT
  // subtract again.
  const totalWaived = computeTotalWaived(params);
  if (totalWaived > 0.005) {
    y = ensureRoom(y, 20);
    doc.font(FONT.bodyIt).fontSize(9.5).fillColor(COLOR.gold600)
      .text(
        `Professional courtesy — waived, not charged:  ${money(doc, totalWaived)}`,
        MARGIN.left, y, { width: CONTENT_W, align: 'right' },
      );
    y += 16;
  }

  return y;
}

/** Sum of everything shown-but-waived (goodwill) — the client-visible courtesy total. */
function computeTotalWaived(params: BillingBreakdownPdfParams): number {
  const fees = [...params.withinRetainer, ...params.beyondRetainer]
    .reduce((s, b) => s + b.entries.reduce((es, e) => es + (e.waived ? e.hours * e.hourlyRate : 0), 0), 0);
  const exp = (params.expenses ?? []).reduce((s, e) => s + (e.waived ? e.amount : 0), 0);
  return Math.round((fees + exp) * 100) / 100;
}

// ── Footer + page numbers stamped after all content ─────────────────

function paintFooters(doc: Doc, params: BillingBreakdownPdfParams): void {
  const COLOR = inks(doc.brand.palette);
  const pageCount = doc.bufferedPageRange().count;
  for (let i = 0; i < pageCount; i++) {
    doc.switchToPage(doc.bufferedPageRange().start + i);

    const y = PAGE.height - MARGIN.bottom + 18;

    // Thin gold rule
    doc.save();
    doc.moveTo(MARGIN.left, y - 8).lineTo(MARGIN.left + CONTENT_W, y - 8)
      .lineWidth(0.5).strokeColor(COLOR.gold500).stroke();
    doc.restore();

    doc.font(FONT.bodyIt).fontSize(8).fillColor(COLOR.textMuted);
    const left = params.invoiceNumber ? `Invoice ${params.invoiceNumber}` : '';
    if (left) doc.text(left, MARGIN.left, y, { width: 200 });

    doc.text(
      `Page ${i + 1} of ${pageCount}`,
      MARGIN.left, y,
      { width: CONTENT_W, align: 'center' },
    );

    doc.text(
      doc.brand.documentName,
      MARGIN.left, y,
      { width: CONTENT_W, align: 'right' },
    );
  }
}

// ── Draft watermark ─────────────────────────────────────────────────

/**
 * Stamp a large, translucent, diagonal "DRAFT" across every page. Painted last
 * (over content) at low opacity so the breakdown stays fully legible while being
 * unmistakably marked as a non-final, unapproved draft.
 */
function paintDraftWatermark(doc: Doc): void {
  const COLOR = inks(doc.brand.palette);
  const pageCount = doc.bufferedPageRange().count;
  for (let i = 0; i < pageCount; i++) {
    doc.switchToPage(doc.bufferedPageRange().start + i);
    doc.save();
    doc.rotate(-45, { origin: [PAGE.width / 2, PAGE.height / 2] });
    doc.font(FONT.bodyB)
      .fontSize(140)
      .fillColor(COLOR.navy900)
      .fillOpacity(0.08)
      .text('DRAFT', 0, PAGE.height / 2 - 80, {
        width: PAGE.width,
        align: 'center',
        characterSpacing: 6,
      });
    doc.restore();
    doc.fillOpacity(1);
  }
}

// ── Pure-function helpers ───────────────────────────────────────────

export function computeTotalLegalFees(params: BillingBreakdownPdfParams): number {
  const sumBlocks = (blocks: LawyerBlock[]) =>
    blocks.reduce((s, b) => s + b.entries.reduce((s2, e) => s2 + (e.waived ? 0 : e.hours * e.hourlyRate), 0), 0);
  const within = sumBlocks(params.withinRetainer);
  const beyond = sumBlocks(params.beyondRetainer);
  const accept = (params.acceptanceFees ?? []).reduce((s, a) => s + a.amount, 0);
  // feeLines holds the new billing types: fixed_fee, per-action aggregates,
  // milestones. Informational hours have amount=0 by design — fold them in
  // anyway, the reducer is a no-op for them.
  const feeLinesTotal = (params.feeLines ?? []).reduce((s, f) => s + (f.amount ?? 0), 0);
  // Within-cap hours are absorbed by the flat monthly retainer ONLY when a
  // retainer hours cap actually applies. With a flat retainer but no cap (or no
  // retainer at all), the within-array is fully billable and adds to the bill on
  // top of any flat retainer fee.
  // Within-cap hours are absorbed only when a cap AND a retainer both apply (see
  // the section renderer + computeCapAwareFees). Otherwise every hour is charged
  // on top of any flat retainer fee.
  const hasCap = (params.retainerHoursCap ?? 0) > 0 && params.monthlyRetainer > 0;
  const dtrFees = hasCap
    ? params.monthlyRetainer + beyond
    : params.monthlyRetainer + within + beyond;
  return dtrFees + accept + feeLinesTotal;
}

