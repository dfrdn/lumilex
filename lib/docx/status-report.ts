import {
  Document, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, Packer, WidthType, BorderStyle, Header,
} from 'docx';
import { logoHeader, type DocxBrand } from './brand';

export interface StatusReportParams {
  date: string; // e.g. "15 March 2026"
  addressee: {
    name: string;
    address?: string;
    email?: string;
    throughName?: string;
    throughTitle?: string;
  };
  salutation: string;
  reLines: string;
  bodyParagraphs: string[];
  annexes?: { letter: string; description: string }[];
  signers: { name: string; position?: string }[];
  /** The firm's name, letterhead logo and typeface. */
  brand: DocxBrand;
}

// ── Constants ─────────────────────────────────────────────────────────
const FONT_SIZE = 22; // half-points (11pt)
const LEFT_MARGIN = 1630; // ~2.88cm in twips
const RIGHT_MARGIN = 720;
const TOP_MARGIN = 720;
const BOTTOM_MARGIN = 720;

type TextOpts = { bold?: boolean; italic?: boolean; underline?: boolean; size?: number; font?: string };

/**
 * Run factory bound to the firm's typeface. Bound rather than read from a
 * module constant so two firms' reports can render in the same process without
 * one picking up the other's font.
 */
function runs(family: string) {
  return (content: string, opts: TextOpts = {}): TextRun =>
    new TextRun({
      text: content,
      font: opts.font ?? family,
      size: opts.size ?? FONT_SIZE,
      bold: opts.bold,
      italics: opts.italic,
      underline: opts.underline ? {} : undefined,
    });
}

function para(
  runs: TextRun[],
  opts: { alignment?: (typeof AlignmentType)[keyof typeof AlignmentType]; spacing?: { after?: number; before?: number } } = {},
): Paragraph {
  return new Paragraph({
    children: runs,
    alignment: opts.alignment ?? AlignmentType.JUSTIFIED,
    spacing: opts.spacing ?? { after: 80 },
    style: 'Normal',
  });
}

function noBorderCell(children: Paragraph[], width?: number): TableCell {
  return new TableCell({
    children,
    width: width ? { size: width, type: WidthType.DXA } : undefined,
    borders: {
      top: { style: BorderStyle.NONE, size: 0 },
      bottom: { style: BorderStyle.NONE, size: 0 },
      left: { style: BorderStyle.NONE, size: 0 },
      right: { style: BorderStyle.NONE, size: 0 },
    },
  });
}

/**
 * Generate a status report DOCX using the local docx library.
 * Drop-in replacement for the Claude Skills API version — same interface,
 * ~100ms execution instead of 60-90s.
 */
export async function generateStatusReportDocx(params: StatusReportParams): Promise<Buffer> {
  const text = runs(params.brand.fontFamily);
  const emptyLine = (count = 1): Paragraph[] =>
    Array.from({ length: count }, () => new Paragraph({ children: [text('')], spacing: { after: 0 } }));
  const children: (Paragraph | Table)[] = [];

  // Date
  children.push(para([text(params.date)], { alignment: AlignmentType.LEFT }));
  children.push(...emptyLine());

  // Addressee (name bold, then optional address lines, then optional email)
  children.push(para([text(params.addressee.name, { bold: true })], {
    alignment: AlignmentType.LEFT,
    spacing: { after: 0 },
  }));
  if (params.addressee.address) {
    for (const line of params.addressee.address.split('\n')) {
      children.push(para([text(line.trim())], {
        alignment: AlignmentType.LEFT,
        spacing: { after: 0 },
      }));
    }
  }
  if (params.addressee.email) {
    children.push(para([text(params.addressee.email)], {
      alignment: AlignmentType.LEFT,
      spacing: { after: 0 },
    }));
  }

  children.push(...emptyLine());

  // "Digitally transmitted" (italic)
  children.push(para([text('Digitally transmitted', { italic: true })], {
    alignment: AlignmentType.LEFT,
  }));
  children.push(...emptyLine());

  // Attn / Re table (borderless, 3 columns)
  const tableRows: TableRow[] = [];

  if (params.addressee.throughName) {
    const attnLines = [params.addressee.throughName];
    if (params.addressee.throughTitle) attnLines.push(params.addressee.throughTitle);
    tableRows.push(new TableRow({
      children: [
        noBorderCell([para([text('Attn')], { spacing: { after: 0 } })], 1000),
        noBorderCell([para([text(':')], { spacing: { after: 0 } })], 300),
        noBorderCell(attnLines.map((l) => para([text(l)], { spacing: { after: 0 } }))),
      ],
    }));
  }

  tableRows.push(new TableRow({
    children: [
      noBorderCell([para([text('Re')], { spacing: { after: 0 } })], 1000),
      noBorderCell([para([text(':')], { spacing: { after: 0 } })], 300),
      noBorderCell([para([text(params.reLines)], { spacing: { after: 0 } })]),
    ],
  }));

  children.push(new Table({
    rows: tableRows,
    width: { size: 100, type: WidthType.PERCENTAGE },
  }));

  children.push(...emptyLine());

  // Horizontal rule
  children.push(new Paragraph({
    children: [],
    border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: '000000' } },
    spacing: { after: 120 },
  }));

  children.push(...emptyLine());

  // Salutation
  children.push(para([text(params.salutation)], { alignment: AlignmentType.LEFT }));
  children.push(...emptyLine());

  // Body paragraphs (justified)
  for (const body of params.bodyParagraphs) {
    children.push(para([text(body)]));
    children.push(...emptyLine());
  }

  // Annexes
  if (params.annexes && params.annexes.length > 0) {
    children.push(para([text('Annexes:', { bold: true })], { alignment: AlignmentType.LEFT }));
    for (const a of params.annexes) {
      children.push(para(
        [
          text(`Annex "${a.letter}"`, { bold: true }),
          text(` — ${a.description}`),
        ],
        { alignment: AlignmentType.LEFT, spacing: { after: 0 } },
      ));
    }
    children.push(...emptyLine());
  }

  // Closing
  children.push(para([text('Very truly yours,')], { alignment: AlignmentType.LEFT }));
  children.push(...emptyLine());
  children.push(para([text(params.brand.firmName.toUpperCase(), { bold: true })], {
    alignment: AlignmentType.LEFT,
  }));
  children.push(...emptyLine());
  children.push(para([text('By:')], { alignment: AlignmentType.LEFT }));
  children.push(...emptyLine(3));

  // Signers — leave a signature gap between each
  for (let i = 0; i < params.signers.length; i++) {
    const s = params.signers[i];
    children.push(para([text(s.name.toUpperCase(), { bold: true })], {
      alignment: AlignmentType.LEFT,
      spacing: { after: 0 },
    }));
    if (s.position) {
      children.push(para([text(s.position, { italic: true })], {
        alignment: AlignmentType.LEFT,
        spacing: { after: 0 },
      }));
    }
    if (i < params.signers.length - 1) {
      children.push(...emptyLine(3));
    }
  }

  // ── Header (the firm's logo, when it has one) ───────────────────
  const headerChildren = logoHeader(params.brand);

  const doc = new Document({
    styles: {
      default: {
        document: {
          run: { font: params.brand.fontFamily, size: FONT_SIZE },
        },
      },
    },
    sections: [{
      properties: {
        page: {
          margin: {
            left: LEFT_MARGIN,
            right: RIGHT_MARGIN,
            top: TOP_MARGIN,
            bottom: BOTTOM_MARGIN,
          },
        },
      },
      headers: headerChildren.length > 0 ? {
        default: new Header({ children: headerChildren }),
      } : undefined,
      children,
    }],
  });

  const buffer = await Packer.toBuffer(doc);
  console.log(`[status-report] DOCX generated locally (${(buffer.length / 1024).toFixed(1)}KB)`);
  return Buffer.from(buffer);
}
