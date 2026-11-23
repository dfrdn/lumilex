// DOCX generator for matter executive summaries.
// Plain internal-brief layout — no client letterhead. Readable without the
// formal letter chrome the status-report docx uses.

import {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  BorderStyle, ShadingType, Table, TableRow, TableCell, WidthType,
} from 'docx';

export interface ExecSummaryDocParams {
  matterName: string;
  matterCode?: string | null;
  clientName?: string | null;
  caseNumber?: string | null;
  court?: string | null;
  status?: string | null;
  generatedAt: string; // formatted string like "18 April 2026"
  overview: string;
  currentPosture: string;
  parties: Array<{ name: string; role: string; side?: string; notes?: string }>;
  timeline: Array<{ date: string; label: string; significance: string }>;
  keyRulings: Array<{ date: string; ruling: string; effect: string }>;
  openItems: Array<{ item: string; owner?: string; due_date?: string | null; notes?: string }>;
  readingList: Array<{ name: string; why: string; rank: number }>;
}

const GREY = '595959';
const MUTED = '8C8C8C';
const ACCENT = '7C3AED'; // violet-600

function h2(text: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 280, after: 120 },
    children: [new TextRun({ text, bold: true, color: ACCENT, size: 22 })],
  });
}

function body(text: string): Paragraph {
  return new Paragraph({
    spacing: { after: 120 },
    children: [new TextRun({ text, size: 22 })],
  });
}

function muted(text: string): Paragraph {
  return new Paragraph({
    spacing: { after: 80 },
    children: [new TextRun({ text, color: MUTED, size: 18 })],
  });
}

function dateLine(date: string, label: string): Paragraph {
  return new Paragraph({
    spacing: { after: 40 },
    children: [
      new TextRun({ text: `${date}  `, color: MUTED, size: 20 }),
      new TextRun({ text: label, bold: true, size: 22 }),
    ],
  });
}

function indentedDetail(text: string): Paragraph {
  return new Paragraph({
    spacing: { after: 120 },
    indent: { left: 240 },
    children: [new TextRun({ text, color: GREY, size: 20 })],
  });
}

function tableRow(cells: string[], isHeader = false): TableRow {
  return new TableRow({
    tableHeader: isHeader,
    children: cells.map((t) => new TableCell({
      width: { size: 100 / cells.length, type: WidthType.PERCENTAGE },
      shading: isHeader ? { type: ShadingType.SOLID, color: 'F5F3FF', fill: 'F5F3FF' } : undefined,
      borders: {
        top: { style: BorderStyle.SINGLE, size: 4, color: 'E5E5E5' },
        bottom: { style: BorderStyle.SINGLE, size: 4, color: 'E5E5E5' },
        left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
        right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      },
      children: [new Paragraph({
        children: [new TextRun({
          text: t,
          size: isHeader ? 18 : 20,
          bold: isHeader,
          color: isHeader ? GREY : undefined,
        })],
      })],
    })),
  });
}

export async function generateExecSummaryDocx(p: ExecSummaryDocParams): Promise<Buffer> {
  const children: (Paragraph | Table)[] = [];

  // ── Title block ──
  children.push(new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { after: 80 },
    children: [new TextRun({ text: 'Executive Summary', bold: true, size: 28, color: ACCENT })],
  }));
  children.push(new Paragraph({
    spacing: { after: 80 },
    children: [new TextRun({ text: p.matterName, bold: true, size: 32 })],
  }));

  const metaBits: string[] = [];
  if (p.matterCode) metaBits.push(p.matterCode);
  if (p.clientName) metaBits.push(p.clientName);
  if (p.caseNumber) metaBits.push(p.caseNumber);
  if (p.court) metaBits.push(p.court);
  if (p.status) metaBits.push(p.status);
  if (metaBits.length) children.push(muted(metaBits.join(' · ')));
  children.push(muted(`Generated ${p.generatedAt}`));

  // ── Overview ──
  if (p.overview) {
    children.push(h2('Overview'));
    for (const para of p.overview.split(/\n\n+/)) {
      children.push(body(para.trim()));
    }
  }

  // ── Current Posture ──
  if (p.currentPosture) {
    children.push(h2('Current Posture'));
    children.push(body(p.currentPosture));
  }

  // ── Reading List ──
  if (p.readingList.length) {
    children.push(h2('What to Read First'));
    const sorted = [...p.readingList].sort((a, b) => a.rank - b.rank);
    for (const r of sorted) {
      children.push(new Paragraph({
        spacing: { after: 40 },
        children: [
          new TextRun({ text: `${r.rank}. `, bold: true, size: 22 }),
          new TextRun({ text: r.name, bold: true, size: 22 }),
        ],
      }));
      children.push(indentedDetail(r.why));
    }
  }

  // ── Parties ──
  if (p.parties.length) {
    children.push(h2('Parties'));
    children.push(new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        tableRow(['Name', 'Role', 'Side'], true),
        ...p.parties.map((party) => tableRow([
          party.name + (party.notes ? ` (${party.notes})` : ''),
          party.role,
          party.side === 'us' ? 'Us' : party.side === 'opposing' ? 'Opposing' : 'Other',
        ])),
      ],
    }));
  }

  // ── Timeline ──
  if (p.timeline.length) {
    children.push(h2('Timeline'));
    for (const t of p.timeline) {
      children.push(dateLine(t.date, t.label));
      children.push(indentedDetail(t.significance));
    }
  }

  // ── Key Rulings ──
  if (p.keyRulings.length) {
    children.push(h2('Key Rulings'));
    for (const r of p.keyRulings) {
      children.push(dateLine(r.date, r.ruling));
      children.push(indentedDetail(r.effect));
    }
  }

  // ── Open Items ──
  if (p.openItems.length) {
    children.push(h2('Open Items'));
    for (const item of p.openItems) {
      const metaParts: string[] = [];
      if (item.owner) metaParts.push(item.owner);
      if (item.due_date) metaParts.push(`due ${item.due_date}`);
      children.push(new Paragraph({
        bullet: { level: 0 },
        spacing: { after: 40 },
        children: [
          new TextRun({ text: item.item, size: 22 }),
          ...(metaParts.length ? [new TextRun({ text: ` — ${metaParts.join(' · ')}`, color: MUTED, size: 20 })] : []),
        ],
      }));
      if (item.notes) {
        children.push(new Paragraph({
          spacing: { after: 80 },
          indent: { left: 360 },
          children: [new TextRun({ text: item.notes, color: GREY, size: 20 })],
        }));
      }
    }
  }

  const doc = new Document({
    creator: 'Lumilex',
    title: `Executive Summary — ${p.matterName}`,
    sections: [{ children }],
  });

  const buffer = await Packer.toBuffer(doc);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return buffer as any as Buffer;
}
