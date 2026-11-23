// Formal Offer of Evidence (FOE) generator.
// Renders a draft FOE per the standard Philippine pleading layout:
//   1. Court caption + case title + case number
//   2. Title: "FORMAL OFFER OF EVIDENCE FOR THE <PARTY>"
//   3. Preamble + numbered exhibit table (Exhibit / Description / Purpose)
//   4. Prayer + signature block (draft — lawyer signs later)
//
// Deliberately minimal so lawyers can refine — but the exhibit table is
// the actual time-sink, and that's generated from the data.

import {
  Document, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, Packer, WidthType, BorderStyle,
  Header, HeightRule,
} from 'docx';
import { logoHeader, type DocxBrand } from './brand';

export interface FOEExhibitInput {
  label: string;          // 'A', '1', 'A-1'
  title: string;          // 'Affidavit of Juan Dela Cruz dated 5 May 2026'
  description: string;
  purpose: string;
  documentDate: string | null;
}

export interface FOEParams {
  caseTitle: string;            // "Juan dela Cruz vs. Maria Santos"
  caseNumber: string;
  court: string;                // "Regional Trial Court of Makati City, Branch 145"
  natureOfAction: string;       // e.g. "Annulment of Marriage" — optional
  offeringParty: string;        // "Plaintiff", "Defendant", "Petitioner", etc.
  exhibits: FOEExhibitInput[];
  /** The firm's name, letterhead logo and typeface. */
  brand: DocxBrand;
  signers: { name: string; position?: string }[];
  /** Where it is signed: the firm's city, or null to leave a blank to fill in. */
  city: string | null;
  date: string;                 // '26 May 2026'
}

/**
 * The city a firm signs from, read off its own address: the last part of it
 * that names a city ("Makati City 1229" → "Makati City"). Null when the address
 * names none, so the document leaves a blank rather than printing a city the
 * firm is not in.
 */
export function signingCity(addressLines: string[]): string | null {
  const parts = addressLines.flatMap((l) => l.split(','));
  for (let i = parts.length - 1; i >= 0; i--) {
    const m = /^\s*(.*?\bCity)\b/i.exec(parts[i].replace(/\d+/g, ' ').replace(/\s+/g, ' '));
    if (m && m[1].trim().split(' ').length > 1) return m[1].trim();
  }
  return null;
}

const FONT_SIZE = 22;           // 11pt (half-points)
const FONT_SIZE_SMALL = 20;     // 10pt
const LEFT_MARGIN = 1630;
const RIGHT_MARGIN = 720;
const TOP_MARGIN = 720;
const BOTTOM_MARGIN = 720;

type TextOpts = { bold?: boolean; italic?: boolean; underline?: boolean; size?: number; allCaps?: boolean };

/** Run factory bound to the firm's typeface — see lib/docx/brand.ts. */
function runs(family: string) {
  return (content: string, opts: TextOpts = {}): TextRun =>
    new TextRun({
      text: opts.allCaps ? content.toUpperCase() : content,
      font: family,
      size: opts.size ?? FONT_SIZE,
      bold: opts.bold,
      italics: opts.italic,
      underline: opts.underline ? {} : undefined,
    });
}

type Text = ReturnType<typeof runs>;

function para(
  runs: TextRun[],
  opts: { alignment?: (typeof AlignmentType)[keyof typeof AlignmentType]; spacing?: { after?: number; before?: number }; indent?: { firstLine?: number; left?: number } } = {},
): Paragraph {
  return new Paragraph({
    children: runs,
    alignment: opts.alignment ?? AlignmentType.JUSTIFIED,
    spacing: opts.spacing ?? { after: 120 },
    indent: opts.indent,
  });
}

function emptyLines(text: Text, count = 1): Paragraph[] {
  return Array.from({ length: count }, () =>
    new Paragraph({ children: [text('')], spacing: { after: 0 } })
  );
}

function tableCell(children: Paragraph[], opts: { width?: number; bold?: boolean } = {}): TableCell {
  return new TableCell({
    children,
    width: opts.width ? { size: opts.width, type: WidthType.DXA } : undefined,
    borders: {
      top:    { style: BorderStyle.SINGLE, size: 4, color: '000000' },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: '000000' },
      left:   { style: BorderStyle.SINGLE, size: 4, color: '000000' },
      right:  { style: BorderStyle.SINGLE, size: 4, color: '000000' },
    },
  });
}

export async function generateFOEDocx(params: FOEParams): Promise<Buffer> {
  const text = runs(params.brand.fontFamily);
  const emptyLine = (count = 1) => emptyLines(text, count);
  const children: (Paragraph | Table)[] = [];

  // ── Caption ───────────────────────────────────────────────────────────
  children.push(para([text('REPUBLIC OF THE PHILIPPINES', { bold: true })], {
    alignment: AlignmentType.CENTER,
    spacing: { after: 0 },
  }));
  children.push(para([text(params.court.toUpperCase(), { bold: true })], {
    alignment: AlignmentType.CENTER,
    spacing: { after: 240 },
  }));

  // Two-column table for case title (left) and docket info (right)
  const captionTable = new Table({
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: 60, type: WidthType.PERCENTAGE },
            borders: {
              top:    { style: BorderStyle.NONE, size: 0 },
              bottom: { style: BorderStyle.NONE, size: 0 },
              left:   { style: BorderStyle.NONE, size: 0 },
              right:  { style: BorderStyle.NONE, size: 0 },
            },
            children: [
              para([text(params.caseTitle, { bold: true })], {
                alignment: AlignmentType.LEFT,
                spacing: { after: 0 },
              }),
              para([text('       Plaintiff/Petitioner,', { italic: true })], {
                alignment: AlignmentType.LEFT,
                spacing: { after: 60 },
              }),
              para([text('-versus-')], {
                alignment: AlignmentType.CENTER,
                spacing: { after: 60 },
              }),
              para([text('[adverse party]', { italic: true })], {
                alignment: AlignmentType.LEFT,
                spacing: { after: 0 },
              }),
              para([text('       Defendant/Respondent.', { italic: true })], {
                alignment: AlignmentType.LEFT,
              }),
            ],
          }),
          new TableCell({
            width: { size: 40, type: WidthType.PERCENTAGE },
            borders: {
              top:    { style: BorderStyle.NONE, size: 0 },
              bottom: { style: BorderStyle.NONE, size: 0 },
              left:   { style: BorderStyle.SINGLE, size: 8, color: '000000' },
              right:  { style: BorderStyle.NONE, size: 0 },
            },
            children: [
              para([text('CASE NO. ', { bold: true }), text(params.caseNumber || '__________')], {
                alignment: AlignmentType.LEFT,
                spacing: { after: 60 },
                indent: { left: 240 },
              }),
              ...(params.natureOfAction
                ? [para([text('For: ', { bold: true }), text(params.natureOfAction)], {
                    alignment: AlignmentType.LEFT,
                    indent: { left: 240 },
                  })]
                : []),
            ],
          }),
        ],
      }),
    ],
    width: { size: 100, type: WidthType.PERCENTAGE },
  });
  children.push(captionTable);

  children.push(new Paragraph({
    children: [text('x' + '-'.repeat(60) + 'x')],
    alignment: AlignmentType.CENTER,
    spacing: { after: 240, before: 60 },
  }));

  // ── Title ─────────────────────────────────────────────────────────────
  children.push(para(
    [text(`FORMAL OFFER OF EVIDENCE FOR THE ${params.offeringParty.toUpperCase()}`, { bold: true, underline: true })],
    { alignment: AlignmentType.CENTER, spacing: { after: 360, before: 120 } },
  ));

  // ── Preamble ──────────────────────────────────────────────────────────
  children.push(para([
    text(`${params.offeringParty}, by the undersigned counsel, and unto this Honorable Court, respectfully states:`),
  ], { indent: { firstLine: 720 } }));

  children.push(para([
    text(`1. Pursuant to Rule 132, Section 34 of the Rules of Court, the ${params.offeringParty} hereby formally offers in evidence the following exhibits:`),
  ], { indent: { firstLine: 720 } }));

  children.push(...emptyLine());

  // ── Exhibits table ────────────────────────────────────────────────────
  const headerRow = new TableRow({
    tableHeader: true,
    height: { value: 360, rule: HeightRule.ATLEAST },
    children: [
      tableCell([para([text('Exhibit', { bold: true, size: FONT_SIZE_SMALL })], {
        alignment: AlignmentType.CENTER, spacing: { after: 0 },
      })], { width: 1200 }),
      tableCell([para([text('Description', { bold: true, size: FONT_SIZE_SMALL })], {
        alignment: AlignmentType.CENTER, spacing: { after: 0 },
      })], { width: 4500 }),
      tableCell([para([text('Purpose', { bold: true, size: FONT_SIZE_SMALL })], {
        alignment: AlignmentType.CENTER, spacing: { after: 0 },
      })], { width: 4500 }),
    ],
  });

  const exhibitRows = params.exhibits.length === 0
    ? [new TableRow({
        children: [
          tableCell([para([text('—')], { alignment: AlignmentType.CENTER, spacing: { after: 0 } })]),
          tableCell([para([text('(No exhibits marked for this party.)', { italic: true, size: FONT_SIZE_SMALL })], { spacing: { after: 0 } })]),
          tableCell([para([text('—')], { alignment: AlignmentType.CENTER, spacing: { after: 0 } })]),
        ],
      })]
    : params.exhibits.map((ex) => new TableRow({
        children: [
          tableCell([para([text(`"${ex.label}"`, { bold: true, size: FONT_SIZE_SMALL })], {
            alignment: AlignmentType.CENTER, spacing: { after: 0 },
          })], { width: 1200 }),
          tableCell([
            para([text(ex.title || '(untitled)', { size: FONT_SIZE_SMALL })], { spacing: { after: 60 } }),
            ...(ex.documentDate
              ? [para([text(`Dated: ${ex.documentDate}`, { italic: true, size: FONT_SIZE_SMALL })], { spacing: { after: 60 } })]
              : []),
            ...(ex.description
              ? [para([text(ex.description, { size: FONT_SIZE_SMALL })], { spacing: { after: 0 } })]
              : []),
          ], { width: 4500 }),
          tableCell([para([text(ex.purpose || 'To prove _____.', { size: FONT_SIZE_SMALL, italic: !ex.purpose })], {
            spacing: { after: 0 },
          })], { width: 4500 }),
        ],
      }));

  children.push(new Table({
    rows: [headerRow, ...exhibitRows],
    width: { size: 100, type: WidthType.PERCENTAGE },
  }));

  children.push(...emptyLine());

  // ── Prayer ────────────────────────────────────────────────────────────
  children.push(para(
    [text('PRAYER', { bold: true, underline: true })],
    { alignment: AlignmentType.CENTER, spacing: { after: 240, before: 240 } },
  ));

  children.push(para([
    text(`WHEREFORE, ${params.offeringParty} respectfully prays that the foregoing exhibits be ADMITTED in evidence for the purposes for which they are respectively offered.`),
  ], { indent: { firstLine: 720 } }));

  children.push(para([
    text('Other reliefs, just and equitable under the premises, are likewise prayed for.'),
  ], { indent: { firstLine: 720 } }));

  // ── Place / date ──────────────────────────────────────────────────────
  children.push(...emptyLine());
  children.push(para([
    text(`${params.city ?? '____________'}, Philippines; ${params.date}.`),
  ], { indent: { firstLine: 720 } }));

  children.push(...emptyLine(2));

  // ── Signature block ──────────────────────────────────────────────────
  children.push(para([text(params.brand.firmName.toUpperCase(), { bold: true })], {
    alignment: AlignmentType.RIGHT, spacing: { after: 0 },
  }));
  children.push(para([text(`Counsel for the ${params.offeringParty}`, { italic: true })], {
    alignment: AlignmentType.RIGHT, spacing: { after: 360 },
  }));
  children.push(para([text('By:')], {
    alignment: AlignmentType.RIGHT, spacing: { after: 0 },
  }));
  children.push(...emptyLine(3));

  for (let i = 0; i < params.signers.length; i++) {
    const s = params.signers[i];
    children.push(para([text(s.name.toUpperCase(), { bold: true })], {
      alignment: AlignmentType.RIGHT, spacing: { after: 0 },
    }));
    if (s.position) {
      children.push(para([text(s.position, { italic: true })], {
        alignment: AlignmentType.RIGHT, spacing: { after: 0 },
      }));
    }
    if (i < params.signers.length - 1) children.push(...emptyLine(3));
  }

  // ── Header (the firm's logo, when it has one) ─────────────────────────
  const headerChildren = logoHeader(params.brand);

  const doc = new Document({
    styles: { default: { document: { run: { font: params.brand.fontFamily, size: FONT_SIZE } } } },
    sections: [{
      properties: {
        page: { margin: { left: LEFT_MARGIN, right: RIGHT_MARGIN, top: TOP_MARGIN, bottom: BOTTOM_MARGIN } },
      },
      headers: headerChildren.length > 0 ? { default: new Header({ children: headerChildren }) } : undefined,
      children,
    }],
  });

  const buffer = await Packer.toBuffer(doc);
  return Buffer.from(buffer);
}
