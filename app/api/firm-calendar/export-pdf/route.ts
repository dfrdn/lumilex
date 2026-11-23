import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { getFirmConfig } from '@/lib/firm/config';
import PDFDocument from 'pdfkit';
import { getFirmCalendarMonthData, type FirmCalendarData } from '@/lib/queries/firm-calendar-data';
import { attachmentDisposition } from '@/lib/download-headers';
import { addDays, isDateOnly, toManilaDay } from '@/lib/dates';

export const maxDuration = 60;

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// Print-safe colors for event types (RGB tuples)
const TYPE_COLORS: Record<string, [number, number, number]> = {
  meeting:              [59, 130, 246],   // blue
  hearing:              [244, 63, 94],    // rose
  filing:               [245, 158, 11],   // amber
  deliverable_deadline: [249, 115, 22],   // orange
  deliverable_review:   [139, 92, 246],   // violet
  leave:                [34, 211, 238],   // cyan
  holiday:              [52, 211, 153],   // emerald
};
const DEFAULT_COLOR: [number, number, number] = [120, 113, 108]; // stone

const TYPE_PREFIX: Record<string, string> = {
  meeting: 'MTG',
  hearing: 'HRG',
  filing: 'FIL',
  deliverable_deadline: 'DL',
  deliverable_review: 'REV',
  leave: 'LV',
  holiday: 'HOL',
};

interface DayEntry {
  type: string;
  name: string;
  time?: string;
}

function getMonthRange(year: number, month: number): { start: string; end: string } {
  const start = `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const lastDay = new Date(year, month + 1, 0).getDate();
  const end = `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return { start, end };
}

function buildDayMap(data: FirmCalendarData): Map<string, DayEntry[]> {
  const map = new Map<string, DayEntry[]>();
  const add = (date: string, entry: DayEntry) => {
    const list = map.get(date) ?? [];
    list.push(entry);
    map.set(date, list);
  };

  for (const d of data.deliverables) {
    add(d.date, {
      type: d.dateType === 'review' ? 'deliverable_review' : 'deliverable_deadline',
      name: d.name,
    });
  }
  for (const m of data.meetings) {
    const time = m.date && !isDateOnly(m.date)
      ? new Date(m.date).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Manila' })
      : undefined;
    const dateStr = m.date ? toManilaDay(m.date) : null;
    if (dateStr) add(dateStr, { type: 'meeting', name: m.name, time });
  }
  for (const h of data.hearings) {
    const time = h.date && !isDateOnly(h.date)
      ? new Date(h.date).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Manila' })
      : undefined;
    const dateStr = h.date ? toManilaDay(h.date) : null;
    if (dateStr) add(dateStr, { type: 'hearing', name: h.name, time });
  }
  for (const f of data.filings) {
    if (f.date) add(f.date, { type: 'filing', name: f.name });
  }
  for (const h of data.holidays) {
    add(h.date, { type: 'holiday', name: h.name });
  }
  for (const l of data.leaves) {
    // Expand leave across its range
    for (let ds = l.periodStart; ds <= l.periodEnd; ds = addDays(ds, 1)) {
      add(ds, { type: 'leave', name: `${l.lawyerName} (${l.leaveType})` });
    }
  }
  return map;
}

function renderMonthPage(
  doc: InstanceType<typeof PDFDocument>,
  year: number,
  month: number,
  dayMap: Map<string, DayEntry[]>,
  firmName: string,
) {
  // Landscape A4
  const pageW = 841.89;
  const pageH = 595.28;
  const margin = 30;
  const usableW = pageW - margin * 2;
  const colW = usableW / 7;

  // Title
  doc.font('Helvetica-Bold').fontSize(14).fillColor('#1a1a1a');
  doc.text(`${MONTHS[month]} ${year}`, margin, margin, { align: 'center', width: usableW });

  const headerY = margin + 22;

  // Firm name subtitle
  doc.font('Helvetica').fontSize(7).fillColor('#888888');
  doc.text(firmName ? `${firmName} — Calendar` : 'Calendar', margin, headerY, { align: 'center', width: usableW });

  const dayHeaderY = headerY + 16;

  // Day column headers
  doc.font('Helvetica-Bold').fontSize(8).fillColor('#555555');
  for (let i = 0; i < 7; i++) {
    doc.text(DAY_LABELS[i], margin + i * colW, dayHeaderY, { width: colW, align: 'center' });
  }

  // Divider
  const gridTop = dayHeaderY + 14;
  doc.moveTo(margin, gridTop).lineTo(margin + usableW, gridTop).lineWidth(0.5).strokeColor('#cccccc').stroke();

  // Calendar grid
  const firstDayOfMonth = new Date(year, month, 1);
  let startCol = firstDayOfMonth.getDay() - 1; // Mon=0
  if (startCol < 0) startCol = 6; // Sun→6
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const weekCount = Math.ceil((startCol + daysInMonth) / 7);
  const gridBottom = pageH - margin - 30; // Reserve 30pt for legend
  const rowH = (gridBottom - gridTop) / weekCount;

  // Draw grid lines
  doc.lineWidth(0.3).strokeColor('#e0e0e0');
  for (let r = 0; r <= weekCount; r++) {
    const y = gridTop + r * rowH;
    doc.moveTo(margin, y).lineTo(margin + usableW, y).stroke();
  }
  for (let c = 0; c <= 7; c++) {
    const x = margin + c * colW;
    doc.moveTo(x, gridTop).lineTo(x, gridTop + weekCount * rowH).stroke();
  }

  // Fill cells
  for (let day = 1; day <= daysInMonth; day++) {
    const idx = startCol + day - 1;
    const row = Math.floor(idx / 7);
    const col = idx % 7;
    const cellX = margin + col * colW + 3;
    const cellY = gridTop + row * rowH + 2;
    const cellContentH = rowH - 14;

    // Day number
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const isWeekend = col >= 5;
    doc.font('Helvetica-Bold').fontSize(8).fillColor(isWeekend ? '#aaaaaa' : '#333333');
    doc.text(String(day), cellX, cellY, { width: colW - 6 });

    // Events
    const entries = dayMap.get(dateStr) ?? [];
    let eventY = cellY + 10;
    const maxEvents = Math.floor(cellContentH / 7.5);
    const shown = entries.slice(0, maxEvents);
    const overflow = entries.length - shown.length;

    for (const entry of shown) {
      if (eventY + 7 > cellY + rowH - 2) break;
      const color = TYPE_COLORS[entry.type] ?? DEFAULT_COLOR;
      const prefix = TYPE_PREFIX[entry.type] ?? '';
      const timeStr = entry.time ? ` ${entry.time}` : '';
      const label = `${prefix}${timeStr} ${entry.name}`;
      const truncated = label.length > 28 ? label.slice(0, 26) + '…' : label;

      doc.font('Helvetica').fontSize(5.5).fillColor(color);
      doc.text(truncated, cellX, eventY, { width: colW - 8, lineBreak: false });
      eventY += 7;
    }

    if (overflow > 0) {
      doc.font('Helvetica').fontSize(5).fillColor('#999999');
      doc.text(`+${overflow} more`, cellX, eventY, { width: colW - 8, lineBreak: false });
    }
  }

  // Legend at bottom
  const legendY = pageH - margin - 20;
  doc.font('Helvetica').fontSize(6).fillColor('#888888');
  let legendX = margin;
  for (const [type, prefix] of Object.entries(TYPE_PREFIX)) {
    const color = TYPE_COLORS[type] ?? DEFAULT_COLOR;
    doc.fillColor(color);
    doc.circle(legendX + 3, legendY + 3, 2.5).fill();
    doc.fillColor('#666666').text(`${prefix}`, legendX + 8, legendY, { continued: false });
    legendX += 40;
  }
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.notionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const startYear = parseInt(req.nextUrl.searchParams.get('startYear') ?? '');
  const startMonth = parseInt(req.nextUrl.searchParams.get('startMonth') ?? '');
  const endYear = parseInt(req.nextUrl.searchParams.get('endYear') ?? '');
  const endMonth = parseInt(req.nextUrl.searchParams.get('endMonth') ?? '');

  if ([startYear, startMonth, endYear, endMonth].some(isNaN)) {
    return NextResponse.json({ error: 'startYear, startMonth, endYear, endMonth required' }, { status: 400 });
  }

  // Validate range (max 12 months)
  const totalMonths = (endYear - startYear) * 12 + (endMonth - startMonth) + 1;
  if (totalMonths < 1 || totalMonths > 12) {
    return NextResponse.json({ error: 'Range must be 1–12 months' }, { status: 400 });
  }

  try {
    // Create PDF
    const doc = new PDFDocument({
      size: 'A4',
      layout: 'landscape',
      margin: 30,
      autoFirstPage: false,
    });

    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));

    const config = await getFirmConfig(session.firmId);
    const firmName = config.branding.documentName.trim() || config.name.trim();

    // Generate pages
    let y = startYear;
    let m = startMonth;
    for (let i = 0; i < totalMonths; i++) {
      const range = getMonthRange(y, m);
      const data = await getFirmCalendarMonthData(session.firmId, range.start, range.end);
      const dayMap = buildDayMap(data);

      doc.addPage();
      renderMonthPage(doc, y, m, dayMap, firmName);

      m++;
      if (m > 11) { m = 0; y++; }
    }

    doc.end();

    // Collect into buffer
    const pdfBuffer = await new Promise<Buffer>((resolve) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
    });

    const startLabel = `${startYear}-${String(startMonth + 1).padStart(2, '0')}`;
    const endLabel = `${endYear}-${String(endMonth + 1).padStart(2, '0')}`;
    const filename = `firm-calendar-${startLabel}-to-${endLabel}.pdf`;

    return new NextResponse(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': attachmentDisposition(filename),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[firm-calendar/export-pdf]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
