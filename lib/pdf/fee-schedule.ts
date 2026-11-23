/**
 * Branded PDF rendering of a fee schedule — the export side of the admin
 * fee-schedule CMS (app/admin/fee-schedule), and Annex "A" of an engagement
 * proposal.
 *
 *   1. Cover  → navy lockup panel, cream title panel, gold contact band
 *   2+. Body  → numbered gold section bands over navy-headed fee tables
 *   N. Notes  → bold lead-in definitions, then the italic effectivity line
 *
 * Every schedule — the professional rate card and the three IP schedules —
 * renders through the same cover and letterhead chrome as the engagement
 * proposal and the firm profile, so a bound package reads as one document
 * rather than several separately typeset PDFs.
 */

import {
  PAGE, M, CONTENT_W, FONT,
  brandedDocument, collect, type Brand, type BrandedDoc,
} from './brand';
import {
  BODY_BOTTOM,
  paintLetterPage, renderPanelCover, runningFooter, sectionBand, paragraph, peso,
  labelledParagraph, labelledHeight,
} from './letterhead';
import type {
  FeeScheduleContent, ProfessionalBody, TableBody, FeeColumn,
} from '@/lib/fee-schedule/types';
import { discounted } from '@/lib/fee-schedule/types';

// ── Table engine ────────────────────────────────────────────────────
interface Cell {
  text: string;
  /** Small grey qualifier under the value, e.g. "(per class)". */
  note?: string;
  bold?: boolean;
  color?: string;
  /** Absorb this many following columns (used for the "Subject to negotiation" row). */
  span?: number;
}
interface Row {
  kind?: 'row' | 'subheader';
  cells: Cell[];
  indent?: boolean;
}
interface Table {
  columns: FeeColumn[];
  /** A gold band drawn across the table, e.g. a group label. */
  rows: (Row | { band: string })[];
}

const CELL_PAD_X = 8;
const CELL_PAD_Y = 6;
const ROW_MIN_H = 22;
const HEADER_H = 30;
const HEADER_H_TALL = 40; // when any column carries a sublabel

function columnWidths(columns: FeeColumn[]): number[] {
  const total = columns.reduce((s, c) => s + c.flex, 0);
  return columns.map((c) => (CONTENT_W * c.flex) / total);
}

/**
 * Largest size at or below `start` at which every word of `text` fits `width`.
 * Header labels are admin-editable, so a long one ("Professional Fees") must
 * shrink rather than hyphen-break mid-word ("PROFESSIONA / L FEES").
 */
function fittingSize(
  doc: BrandedDoc,
  text: string,
  width: number,
  start: number,
  characterSpacing: number,
  min = 6.6,
): number {
  const words = text.split(/\s+/).filter(Boolean);
  let size = start;
  while (size > min) {
    doc.fontSize(size);
    if (words.every((w) => doc.widthOfString(w, { characterSpacing }) <= width)) break;
    size -= 0.2;
  }
  return size;
}

function drawTableHeader(doc: BrandedDoc, columns: FeeColumn[], widths: number[], y: number): number {
  const C = doc.brand.palette;
  const tall = columns.some((c) => c.sublabel);
  const h = tall ? HEADER_H_TALL : HEADER_H;
  doc.rect(M.left, y, CONTENT_W, h).fill(C.primary);
  let x = M.left;
  columns.forEach((col, i) => {
    const w = widths[i];
    const inner = w - CELL_PAD_X * 2;
    const align = col.align === 'left' && i === 0 ? 'left' : 'center';
    const labelY = tall ? y + 7 : y + 9.5;
    doc.font(FONT.bodyB);
    const size = fittingSize(doc, col.label.toUpperCase(), inner, 8.6, 0.4);
    doc.fontSize(size).fillColor(C.white)
      .text(col.label.toUpperCase(), x + CELL_PAD_X, labelY, { width: inner, align, characterSpacing: 0.4 });
    if (col.sublabel) {
      doc.font(FONT.bodyB);
      const subSize = fittingSize(doc, col.sublabel, inner, 7.6, 0.2);
      doc.fontSize(subSize).fillColor(C.accentSoft)
        .text(col.sublabel, x + CELL_PAD_X, doc.y + 1, { width: inner, align, characterSpacing: 0.2 });
    }
    x += w;
  });
  return y + h;
}

function measureRow(doc: BrandedDoc, row: Row, widths: number[]): number {
  if (row.kind === 'subheader') {
    doc.font(FONT.bodyB).fontSize(9.4);
    return Math.max(
      ROW_MIN_H,
      doc.heightOfString(row.cells[0]?.text ?? '', { width: CONTENT_W - CELL_PAD_X * 2 }) + CELL_PAD_Y * 2,
    );
  }
  let tallest = ROW_MIN_H;
  let i = 0;
  let col = 0;
  while (col < widths.length) {
    const cell = row.cells[i];
    const span = cell?.span ?? 1;
    const w = widths.slice(col, col + span).reduce((s, v) => s + v, 0);
    const indent = row.indent && col === 0 ? 12 : 0;
    doc.font(cell?.bold ? FONT.bodyB : FONT.body).fontSize(9.4);
    let h = doc.heightOfString(cell?.text ?? '', { width: w - CELL_PAD_X * 2 - indent }) + CELL_PAD_Y * 2;
    if (cell?.note) {
      doc.font(FONT.body).fontSize(7.2);
      h += doc.heightOfString(cell.note, { width: w - CELL_PAD_X * 2 }) + 1;
    }
    tallest = Math.max(tallest, h);
    col += span;
    i += 1;
  }
  return tallest;
}

function drawRow(doc: BrandedDoc, row: Row, columns: FeeColumn[], widths: number[], y: number, h: number) {
  const C = doc.brand.palette;
  if (row.kind === 'subheader') {
    doc.rect(M.left, y, CONTENT_W, h).fill(C.surfaceDeep);
    doc.font(FONT.bodyB).fontSize(9.4).fillColor(C.primary)
      .text(row.cells[0]?.text ?? '', M.left + CELL_PAD_X, y + CELL_PAD_Y, { width: CONTENT_W - CELL_PAD_X * 2 });
  } else {
    // A solid white body over the cream page — the row divide is carried by the
    // hairlines alone, not by a cream/white stripe that reads as heavy banding.
    doc.rect(M.left, y, CONTENT_W, h).fill(C.white);
    let x = M.left;
    let i = 0;
    let col = 0;
    while (col < widths.length) {
      const cell = row.cells[i];
      const span = cell?.span ?? 1;
      const w = widths.slice(col, col + span).reduce((s, v) => s + v, 0);
      const indent = row.indent && col === 0 ? 12 : 0;
      const align = span > 1 ? 'center' : columns[col].align === 'left' && col === 0 ? 'left' : 'center';
      doc.font(cell?.bold ? FONT.bodyB : FONT.body).fontSize(9.4).fillColor(cell?.color ?? C.ink)
        .text(cell?.text ?? '', x + CELL_PAD_X + indent, y + CELL_PAD_Y, { width: w - CELL_PAD_X * 2 - indent, align });
      if (cell?.note) {
        doc.font(FONT.body).fontSize(7.2).fillColor(C.inkMuted)
          .text(cell.note, x + CELL_PAD_X, doc.y + 0.5, { width: w - CELL_PAD_X * 2, align });
      }
      x += w;
      col += span;
      i += 1;
    }
    // Column rules for this row only, so a spanned cell reads as one field.
    doc.save().lineWidth(0.4).strokeColor(C.hairline);
    let rx = M.left;
    let rcol = 0;
    let ri = 0;
    while (rcol < widths.length - 1) {
      const span = row.cells[ri]?.span ?? 1;
      rx += widths.slice(rcol, rcol + span).reduce((s, v) => s + v, 0);
      rcol += span;
      ri += 1;
      if (rcol < widths.length) doc.moveTo(rx, y).lineTo(rx, y + h).stroke();
    }
    doc.restore();
  }
  // Hairline under every row.
  doc.save().lineWidth(0.4).strokeColor(C.hairline)
    .moveTo(M.left, y + h).lineTo(PAGE.w - M.right, y + h).stroke().restore();
}

/**
 * Render a table, breaking across pages and repeating the column header.
 * `newPage` paints the next page's chrome and returns the y to resume at.
 */
function drawTable(doc: BrandedDoc, table: Table, y: number, newPage: () => number): number {
  const C = doc.brand.palette;
  const widths = columnWidths(table.columns);
  let boxTop = y;   // top of the frame on the current page
  let cursor = drawTableHeader(doc, table.columns, widths, y);

  const closeBox = () => {
    doc.save().lineWidth(0.7).strokeColor(C.accentLine)
      .rect(M.left, boxTop, CONTENT_W, cursor - boxTop).stroke().restore();
  };
  const breakPage = () => {
    closeBox();
    boxTop = newPage();
    cursor = drawTableHeader(doc, table.columns, widths, boxTop);
  };

  for (const entry of table.rows) {
    if ('band' in entry) {
      const h = 20;
      // A band stranded above a page break would head an empty column.
      if (cursor + h + ROW_MIN_H > BODY_BOTTOM) breakPage();
      doc.rect(M.left, cursor, CONTENT_W, h).fill(C.accent);
      doc.font(FONT.bodyB).fontSize(9).fillColor(C.white)
        .text(entry.band.toUpperCase(), M.left + CELL_PAD_X, cursor + 5.5, { characterSpacing: 0.9, lineBreak: false });
      cursor += h;
      continue;
    }
    const h = measureRow(doc, entry, widths);
    if (cursor + h > BODY_BOTTOM) breakPage();
    drawRow(doc, entry, table.columns, widths, cursor, h);
    cursor += h;
  }
  closeBox();
  return cursor + 20;
}

// ── Cover ───────────────────────────────────────────────────────────
function renderCover(doc: BrandedDoc, content: FeeScheduleContent) {
  const { cover } = content;
  renderPanelCover(doc, {
    titleLines: cover.title.split(' '),
    subject: cover.subtitle,
    metaLines: [cover.edition, cover.footnote],
    addressLines: cover.addressLines,
    contactLines: [cover.email, cover.website, cover.phone],
  });
}

// ── Bodies ──────────────────────────────────────────────────────────
function professionalTables(brand: Brand, body: ProfessionalBody): { retainer: Table; hourly: Table; acceptance: Table } {
  const C = brand.palette;
  const money = (n: number) => peso(n, brand.fonts);
  const tiers = body.retainer.tiers;
  const priced = tiers.filter((t) => t.discountPct != null && t.monthlyFee != null);

  const retainer: Table = {
    columns: [
      { label: 'Retainer Tier', flex: 1.25, align: 'center' },
      { label: 'Monthly Coverage', flex: 2.7, align: 'center' },
      { label: 'Monthly Fee', flex: 1.3, align: 'center' },
      { label: 'Hourly Rate Discount', flex: 1.4, align: 'center' },
    ],
    rows: tiers.map((t) =>
      t.monthlyFee == null
        ? { cells: [{ text: t.label, bold: true }, { text: t.note ?? '', bold: true, color: C.accent, span: 3 }] }
        : {
            cells: [
              { text: t.label, bold: true },
              { text: `Up to ${t.hours} hours of legal services per month` },
              { text: money(t.monthlyFee), bold: true },
              { text: `${t.discountPct}%`, bold: true, color: C.accent },
            ],
          },
    ),
  };

  // Tier columns are derived from the standard rate, never typed twice — the
  // annex and the proposal's fee maths therefore cannot disagree.
  const tierCols: FeeColumn[] = priced.map((t) => ({
    label: t.label,
    sublabel: `−${t.discountPct}%`,
    flex: 1,
    align: 'center' as const,
  }));

  const hourly: Table = {
    columns: [
      { label: 'Position', flex: 1.7, align: 'left' },
      { label: 'Standard Rate', flex: 1.15, align: 'center' },
      ...tierCols,
    ],
    rows: body.hourly.rates.map((r) => ({
      cells: [
        { text: r.position, bold: true },
        { text: money(r.standard), bold: true },
        ...priced.map((t) => ({ text: money(discounted(r.standard, t.discountPct)), color: C.accent })),
      ],
    })),
  };

  const acceptance: Table = {
    columns: [
      { label: 'Litigation Matter', flex: 1.7, align: 'left' },
      { label: 'Standard Fee', flex: 1.15, align: 'center' },
      ...tierCols,
    ],
    rows: body.acceptance.fees.map((f) => ({
      cells: [
        { text: f.matter, bold: true },
        { text: money(f.standard), bold: true },
        ...priced.map((t) => ({ text: money(discounted(f.standard, t.discountPct)), color: C.accent })),
      ],
    })),
  };

  return { retainer, hourly, acceptance };
}

function tableFromBody(body: TableBody): Table {
  const rows: (Row | { band: string })[] = [];
  for (const group of body.groups) {
    rows.push({ band: group.label });
    for (const r of group.rows) {
      rows.push({
        kind: r.kind,
        indent: r.indent,
        cells: r.cells.map((text, i) => ({ text, note: r.cellNotes?.[i] })),
      });
    }
  }
  return { columns: body.columns, rows };
}

// ── Notes ───────────────────────────────────────────────────────────
function renderNotes(doc: BrandedDoc, content: FeeScheduleContent, y: number, newPage: () => number): number {
  const C = doc.brand.palette;
  let cursor = y;
  if (cursor + 90 > BODY_BOTTOM) cursor = newPage();
  cursor = sectionBand(doc, null, content.notesHeading, cursor);

  for (const note of content.notes) {
    // Bold navy lead-in then justified body, via the shared helper — only the
    // opening paragraph is indented to clear the label; a note spanning several
    // paragraphs keeps the rest flush to the margin.
    const h = labelledHeight(doc, note.label, note.text);
    if (cursor + h > BODY_BOTTOM) cursor = newPage();
    cursor = labelledParagraph(doc, note.label, note.text, cursor);
  }

  if (content.footnotes.length) {
    cursor += 6;
    for (const fn of content.footnotes) {
      doc.font(FONT.bodyIt).fontSize(8.6).fillColor(C.inkMuted);
      const h = doc.heightOfString(fn, { width: CONTENT_W }) + 3;
      if (cursor + h > BODY_BOTTOM) cursor = newPage();
      doc.text(fn, M.left, cursor, { width: CONTENT_W });
      cursor = doc.y + 3;
    }
  }
  return cursor;
}

// ── Entry point ─────────────────────────────────────────────────────

export function generateFeeSchedulePdf(brand: Brand, content: FeeScheduleContent): Promise<Buffer> {
  const doc = brandedDocument(brand, {
    bufferPages: true,
    info: {
      Title: `${content.name} ${content.year}`.trim(),
      Author: brand.documentName,
      Subject: content.name,
    },
  });

  return collect(doc, () => {
    renderCover(doc, content);

    // Every interior page gets the letterhead chrome; `newPage` is threaded
    // into the table and notes renderers so a mid-table break stays branded.
    const newPage = (): number => {
      doc.addPage();
      return paintLetterPage(doc, content.runningTitle);
    };

    let y = newPage();

    if (content.body.kind === 'professional') {
      const body = content.body;
      y = paragraph(doc, body.intro, y);
      const tables = professionalTables(brand, body);

      const section = (index: number, heading: string, paras: string[], table: Table) => {
        if (y + 120 > BODY_BOTTOM) y = newPage();
        y = sectionBand(doc, index, heading, y);
        for (const p of paras) y = paragraph(doc, p, y);
        y = drawTable(doc, table, y, newPage);
      };

      section(1, body.retainer.heading, body.retainer.paragraphs, tables.retainer);
      section(2, body.hourly.heading, body.hourly.paragraphs, tables.hourly);
      section(3, body.acceptance.heading, body.acceptance.paragraphs, tables.acceptance);
    } else {
      const body = content.body;
      if (body.intro) y = paragraph(doc, body.intro, y);
      y = drawTable(doc, tableFromBody(body), y, newPage);
    }

    renderNotes(doc, content, y, newPage);

    // Stamp footers on the interior pages (the cover at index 0 has its own).
    const range = doc.bufferedPageRange();
    for (let i = range.start + 1; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      runningFooter(doc, 'Strictly Confidential', i);
    }
  });
}
