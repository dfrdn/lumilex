/**
 * The firm's letterhead, as Word header parts.
 *
 * Three designs, chosen per firm (lib/firm/letterhead-design.ts): Classic, a
 * centred name over its address and a short accent rule; Band, the name
 * reversed out of a full-width band in the firm's primary; Ledger, the name
 * ranged left and the address ranged right over a double rule. All three carry
 * the roster across the foot of page one, and a quieter running head on the
 * pages after it.
 *
 * Every colour, mark, typeface and line of text comes from the firm's own
 * configuration: the palette through `derivePalette`, the marks from its
 * storage prefix, the face from its font set, the address from its invoice
 * settings, the roster from its `team` table. What is shared is the geometry.
 * lib/docx/template-updater.ts writes the parts into the neutral template; this
 * module is pure XML so it can be read and tested without unzipping anything.
 *
 * Two things are deliberate.
 *
 * The roster holds the foot of page one only. It is drawn in the first-page
 * header and an empty spacer there, wrapped top-and-bottom, keeps the body
 * above it; the pages after it run to the ordinary bottom margin.
 *
 * Each object exists once. There is no `mc:AlternateContent` VML fallback: the
 * drawn template this replaced kept two copies of its roster, its updater once
 * rewrote only one, and the fallback went on listing the people the template
 * was drawn with. One copy cannot drift from itself.
 */

import type { LetterheadDesign } from '@/lib/firm/letterhead-design';

// ── Geometry (A4 portrait, points from the page's top-left) ──────────
const PAGE = { width: 595.28, height: 841.89 };
const SIDE = 72;
const MEASURE = PAGE.width - 2 * SIDE;
/** Bottom margin on every page; page one's roster sits inside its own spacer. */
const BOTTOM = 72;
const ROSTER_FOOT = 40;

const twips = (pt: number) => Math.round(pt * 20);
const emu = (pt: number) => Math.round(pt * 12700);
const hex = (color: string) => color.replace(/^#/, '').toUpperCase();

/**
 * Characters that fit a line, conservatively, at the sizes used here. A text
 * box clips what does not fit, silently, so a line is assumed to wrap once it
 * passes this — the boxes are transparent and drawing them taller costs nothing.
 */
const charsFor = (widthPt: number, sizePt: number) => Math.floor(widthPt / (sizePt * 0.55));

/** The inks the letterhead uses, by role: hex, with or without the hash. */
export interface LetterheadInks {
  primary: string;
  accent: string;
  accentSoft: string;
  hairline: string;
  ink: string;
  inkSoft: string;
  white: string;
}

export interface RosterGroup {
  label: string;
  names: string[];
}

export interface RosterMember {
  name: string;
  position: string;
  /** Joined the firm; the tie-break between two people of the same rank. */
  start_date: string | null;
}

export interface LetterheadContent {
  roster: RosterGroup[];
  address: string[];
  contact: string[];
  /** The firm's name as printed, set as type wherever there is no wordmark image. */
  firmName: string;
  /** Word family name from the firm's font set. */
  fontFamily: string;
  inks: LetterheadInks;
}

/** A mark registered on the header part: its relationship id and width ÷ height. */
export interface LetterheadMark {
  relationshipId: string;
  aspect: number;
}

export interface LetterheadMarks {
  /** The firm's full lockup, for a white ground. */
  wordmark: LetterheadMark | null;
  monogram: LetterheadMark | null;
  /** Reversed-out monogram for the Band design's coloured ground. */
  monogramLight: LetterheadMark | null;
}

/** Page margins in points. */
export interface LetterheadMargins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface LetterheadParts {
  firstPageHeaderXml: string;
  continuationHeaderXml: string;
  margins: LetterheadMargins;
}

// ── Who is listed, and in what order ─────────────────────────────────
/**
 * The roster's groupings, in the order they are read, and within each the
 * positions in order of rank. A position that is not listed here does not
 * appear on the letterhead — liaison officers, finance and admin staff are
 * firm, not counsel, and an underbar associate is not yet a lawyer.
 */
export const ROSTER_GROUPS = [
  {
    label: 'Partners',
    positions: ['Founding Partner', 'Managing Partner', 'Monitoring Partner', 'Partner'],
  },
  { label: 'Senior Associate', positions: ['Senior Associate'] },
  { label: 'Mid-level Associate', positions: ['Mid-level Associate'] },
  { label: 'Junior Associates', positions: ['Junior Associate'] },
  { label: 'Of Counsel', positions: ['Of Counsel'] },
  { label: 'Special Counsel', positions: ['Special Counsel'] },
];

/** Last word of the name — the surname in the usual Philippine order. */
function surname(name: string): string {
  const parts = (name ?? '').trim().split(/\s+/);
  return (parts[parts.length - 1] ?? '').toLowerCase();
}

/**
 * Seniority within a group: rank, then who has been here longest, then surname
 * so the result is total. Someone with no start date sorts after those who
 * have one rather than jumping the queue.
 */
export function bySeniority(positions: string[]) {
  return (a: RosterMember, b: RosterMember): number => {
    const rank = positions.indexOf(a.position) - positions.indexOf(b.position);
    if (rank !== 0) return rank;

    const started = (m: RosterMember) => (m.start_date ? Date.parse(m.start_date) : Number.POSITIVE_INFINITY);
    const tenure = started(a) - started(b);
    if (tenure !== 0 && !Number.isNaN(tenure)) return tenure;

    return surname(a.name).localeCompare(surname(b.name)) || a.name.localeCompare(b.name);
  };
}

/** Positions the letterhead doesn't print, in the order a list of people shows them after those it does. */
const OFF_LETTERHEAD = ['Underbar Associate'];

/**
 * Anyone in the order the letterhead lists them: by group, then seniority
 * within it. Positions the letterhead doesn't print (an underbar associate,
 * staff) come after, those named in OFF_LETTERHEAD first, then by name.
 */
export function byLetterhead(a: RosterMember, b: RosterMember): number {
  const at = (m: RosterMember) => {
    const i = ROSTER_GROUPS.findIndex((g) => g.positions.includes(m.position));
    return i === -1 ? ROSTER_GROUPS.length : i;
  };
  const group = at(a) - at(b);
  if (group !== 0) return group;
  if (at(a) === ROSTER_GROUPS.length) {
    const rest = (m: RosterMember) => {
      const i = OFF_LETTERHEAD.indexOf(m.position);
      return i === -1 ? OFF_LETTERHEAD.length : i;
    };
    const off = rest(a) - rest(b);
    return off !== 0 ? off : a.name.localeCompare(b.name);
  }
  return bySeniority(ROSTER_GROUPS[at(a)].positions)(a, b);
}

/** The roster as it prints: grouped, each group in seniority. */
export function rosterGroups(members: RosterMember[]): RosterGroup[] {
  return ROSTER_GROUPS
    .map((group) => ({
      label: group.label,
      names: members
        .filter((m) => group.positions.includes(m.position))
        .sort(bySeniority(group.positions))
        .map((m) => m.name.trim()),
    }))
    .filter((group) => group.names.length > 0);
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ── Runs and paragraphs ──────────────────────────────────────────────
interface RunStyle {
  font: string;
  /** Points. */
  size: number;
  color: string;
  italic?: boolean;
  caps?: boolean;
  /** Points of letterspacing. */
  spacing?: number;
}

type Align = 'left' | 'center' | 'right';

function runProps(style: RunStyle): string {
  const font = escapeXml(style.font);
  const half = Math.round(style.size * 2);
  return (
    '<w:rPr>' +
    `<w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:cs="${font}"/>` +
    (style.italic ? '<w:i/><w:iCs/>' : '') +
    (style.caps ? '<w:caps/>' : '') +
    `<w:color w:val="${hex(style.color)}"/>` +
    (style.spacing ? `<w:spacing w:val="${twips(style.spacing)}"/>` : '') +
    `<w:sz w:val="${half}"/><w:szCs w:val="${half}"/>` +
    '</w:rPr>'
  );
}

const run = (text: string, style: RunStyle) =>
  `<w:r>${runProps(style)}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;

/** One paragraph of runs, at an exact line height so box heights are predictable. */
function para(runs: string, opts: { align?: Align; line: number; after?: number }): string {
  const jc = opts.align && opts.align !== 'left' ? `<w:jc w:val="${opts.align}"/>` : '';
  return (
    '<w:p><w:pPr>' +
    `<w:spacing w:before="0" w:after="${twips(opts.after ?? 0)}" w:line="${twips(opts.line)}" w:lineRule="exact"/>` +
    jc +
    '</w:pPr>' +
    runs +
    '</w:p>'
  );
}

// ── Floating objects ─────────────────────────────────────────────────
const A_NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';
const SHAPE_URI = 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape';
const PICTURE_URI = 'http://schemas.openxmlformats.org/drawingml/2006/picture';

interface Frame {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface AnchorOpts {
  behindDoc?: boolean;
  /** 'topAndBottom' keeps the body text above or below it; 'none' ignores it. */
  wrap?: 'none' | 'topAndBottom';
}

/**
 * Page-anchored drawing objects with ids unique within the part. Each header
 * part gets its own, so the ids a design draws with never collide.
 */
class Canvas {
  private next = 1;
  private readonly objects: string[] = [];

  private anchor(frame: Frame, name: string, uri: string, body: string, opts: AnchorOpts = {}): void {
    const id = this.next++;
    this.objects.push(
      '<w:r><w:drawing>' +
      `<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="${251650000 + id}" ` +
      `behindDoc="${opts.behindDoc ? 1 : 0}" locked="0" layoutInCell="1" allowOverlap="1">` +
      '<wp:simplePos x="0" y="0"/>' +
      `<wp:positionH relativeFrom="page"><wp:posOffset>${emu(frame.x)}</wp:posOffset></wp:positionH>` +
      `<wp:positionV relativeFrom="page"><wp:posOffset>${emu(frame.y)}</wp:posOffset></wp:positionV>` +
      `<wp:extent cx="${emu(frame.width)}" cy="${emu(frame.height)}"/>` +
      '<wp:effectExtent l="0" t="0" r="0" b="0"/>' +
      (opts.wrap === 'topAndBottom' ? '<wp:wrapTopAndBottom/>' : '<wp:wrapNone/>') +
      `<wp:docPr id="${id}" name="${escapeXml(name)}"/>` +
      '<wp:cNvGraphicFramePr/>' +
      `<a:graphic ${A_NS}><a:graphicData uri="${uri}">${body}</a:graphicData></a:graphic>` +
      '</wp:anchor></w:drawing></w:r>',
    );
  }

  /** Text with no insets, so the first character sits exactly on `frame.x`. */
  text(frame: Frame, name: string, paragraphs: string): void {
    this.anchor(frame, name, SHAPE_URI,
      '<wps:wsp><wps:cNvSpPr txBox="1"/>' +
      `<wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${emu(frame.width)}" cy="${emu(frame.height)}"/></a:xfrm>` +
      '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></wps:spPr>' +
      `<wps:txbx><w:txbxContent>${paragraphs}</w:txbxContent></wps:txbx>` +
      '<wps:bodyPr rot="0" vertOverflow="overflow" horzOverflow="overflow" vert="horz" wrap="square" ' +
      'lIns="0" tIns="0" rIns="0" bIns="0" anchor="t" anchorCtr="0"><a:noAutofit/></wps:bodyPr>' +
      '</wps:wsp>');
  }

  /** A filled rectangle — bands, stripes and rules are all this. */
  fill(frame: Frame, name: string, color: string, opts: AnchorOpts = {}): void {
    this.anchor(frame, name, SHAPE_URI,
      '<wps:wsp><wps:cNvSpPr/>' +
      `<wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${emu(frame.width)}" cy="${emu(frame.height)}"/></a:xfrm>` +
      `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="${hex(color)}"/></a:solidFill>` +
      '<a:ln><a:noFill/></a:ln></wps:spPr><wps:bodyPr/></wps:wsp>', opts);
  }

  /** An empty shape the body text keeps clear of. */
  spacer(frame: Frame, name: string): void {
    this.anchor(frame, name, SHAPE_URI,
      '<wps:wsp><wps:cNvSpPr/>' +
      `<wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${emu(frame.width)}" cy="${emu(frame.height)}"/></a:xfrm>` +
      '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></wps:spPr>' +
      '<wps:bodyPr/></wps:wsp>', { wrap: 'topAndBottom' });
  }

  image(frame: Frame, name: string, relationshipId: string): void {
    this.anchor(frame, name, PICTURE_URI,
      `<pic:pic xmlns:pic="${PICTURE_URI}">` +
      `<pic:nvPicPr><pic:cNvPr id="0" name="${escapeXml(name)}"/><pic:cNvPicPr/></pic:nvPicPr>` +
      `<pic:blipFill><a:blip r:embed="${relationshipId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
      `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${emu(frame.width)}" cy="${emu(frame.height)}"/></a:xfrm>` +
      '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>');
  }

  /** The part, its objects hung off one empty paragraph so the header adds no height. */
  header(namespaces: string): string {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' +
      `<w:hdr ${namespaces}>` +
      `<w:p><w:pPr><w:spacing w:after="0" w:line="20" w:lineRule="exact"/></w:pPr>${this.objects.join('')}</w:p>` +
      '</w:hdr>';
  }
}

/** A mark's box: as wide as `maxWidth` allows, held to `maxHeight`. */
export function fitMark(aspect: number, maxWidth: number, maxHeight: number): { width: number; height: number } {
  const width = Math.min(maxWidth, maxHeight * aspect);
  return { width, height: width / aspect };
}

/** Lines a block of text takes in a box this wide at this size. */
function lineCount(lines: string[], widthPt: number, sizePt: number): number {
  const chars = charsFor(widthPt, sizePt);
  return lines.reduce((n, line) => n + Math.max(1, Math.ceil(line.length / chars)), 0);
}

// ── The roster across the foot of page one ───────────────────────────
const ROSTER = { label: 6.5, name: 7.5, line: 10, gap: 3 };

function rosterParagraphs(content: LetterheadContent, align: Align): string {
  const label: RunStyle = { font: content.fontFamily, size: ROSTER.label, color: content.inks.accent, caps: true, spacing: 0.8 };
  const name: RunStyle = { font: content.fontFamily, size: ROSTER.name, color: content.inks.ink };
  return content.roster
    .map((group, i) =>
      para(run(group.label, label) + run('   ' + group.names.join('  ·  '), name), {
        align,
        line: ROSTER.line,
        after: i < content.roster.length - 1 ? ROSTER.gap : 0,
      }))
    .join('');
}

/** How tall the foot roster runs, in points. */
export function rosterHeight(roster: RosterGroup[]): number {
  if (roster.length === 0) return 0;
  const lines = lineCount(roster.map((g) => `${g.label}   ${g.names.join('  ·  ')}`), MEASURE, ROSTER.name);
  return lines * ROSTER.line + (roster.length - 1) * ROSTER.gap;
}

/** A roster that would take more than a third of the page is one to set differently. */
export function rosterOverflows(content: Pick<LetterheadContent, 'roster'>): boolean {
  return rosterHeight(content.roster) > PAGE.height / 3;
}

function footRoster(canvas: Canvas, content: LetterheadContent, align: Align, ruleColor: string): void {
  if (content.roster.length === 0) return;
  const height = rosterHeight(content.roster);
  const top = PAGE.height - ROSTER_FOOT - height;
  canvas.spacer({ x: 0, y: top - 18, width: PAGE.width, height: PAGE.height - top + 18 }, 'Roster space');
  canvas.fill({ x: SIDE, y: top - 9, width: MEASURE, height: 0.5 }, 'Roster rule', ruleColor);
  // Drawn a few lines taller than it needs, so a wrap the estimate missed is not clipped.
  canvas.text({ x: SIDE, y: top, width: MEASURE, height: height + 3 * ROSTER.line }, 'Roster', rosterParagraphs(content, align));
}

/** The firm's name as type, for the head of a page. */
function nameLine(content: LetterheadContent, size: number, color: string, spacing: number, align: Align): string {
  return para(run(content.firmName, { font: content.fontFamily, size, color, caps: true, spacing }), { align, line: size * 1.25 });
}

const margins = (top: number): LetterheadMargins => ({ top, right: SIDE, bottom: BOTTOM, left: SIDE });

// ── Classic ──────────────────────────────────────────────────────────
/** Centred: the monogram, the name, the address on one line, a short accent rule. */
function classic(content: LetterheadContent, marks: LetterheadMarks, namespaces: string): LetterheadParts {
  const { inks } = content;
  const first = new Canvas();
  let y = 36;

  if (marks.monogram) {
    const box = fitMark(marks.monogram.aspect, 60, 28);
    first.image({ x: (PAGE.width - box.width) / 2, y, ...box }, 'Monogram', marks.monogram.relationshipId);
    y += box.height + 10;
  }
  if (marks.wordmark) {
    const box = fitMark(marks.wordmark.aspect, 300, 40);
    first.image({ x: (PAGE.width - box.width) / 2, y, ...box }, 'Wordmark', marks.wordmark.relationshipId);
    y += box.height + 8;
  } else {
    first.text({ x: SIDE, y, width: MEASURE, height: 24 }, 'Name', nameLine(content, 17, inks.primary, 3, 'center'));
    y += 26;
  }

  const addressLine = [...content.address, ...content.contact].join('  ·  ');
  if (addressLine) {
    const height = lineCount([addressLine], MEASURE, 8) * 11;
    first.text({ x: SIDE, y, width: MEASURE, height: height + 11 }, 'Address',
      para(run(addressLine, { font: content.fontFamily, size: 8, color: inks.inkSoft }), { align: 'center', line: 11 }));
    y += height + 8;
  }
  first.fill({ x: (PAGE.width - 48) / 2, y, width: 48, height: 0.75 }, 'Accent rule', inks.accent);
  footRoster(first, content, 'center', inks.hairline);

  const rest = new Canvas();
  rest.text({ x: SIDE, y: 38, width: MEASURE, height: 12 }, 'Running head', nameLine(content, 7.5, inks.primary, 2, 'center'));
  rest.fill({ x: (PAGE.width - 32) / 2, y: 54, width: 32, height: 0.5 }, 'Running rule', inks.accent);

  return {
    firstPageHeaderXml: first.header(namespaces),
    continuationHeaderXml: rest.header(namespaces),
    margins: margins(y + 34),
  };
}

// ── Band ─────────────────────────────────────────────────────────────
const BAND = { height: 100, stripe: 3 };

/**
 * A full-width band in the primary, bled off the top, with the name reversed
 * out of it and the address ranged right inside it; an accent stripe beneath.
 * The name is set as type here even when the firm has a wordmark image, because
 * a lockup drawn for white paper disappears on a coloured ground; the monogram
 * is used only in its reversed-out form.
 */
function band(content: LetterheadContent, marks: LetterheadMarks, namespaces: string): LetterheadParts {
  const { inks } = content;
  const first = new Canvas();
  first.fill({ x: 0, y: 0, width: PAGE.width, height: BAND.height }, 'Band', inks.primary, { behindDoc: true });
  first.fill({ x: 0, y: BAND.height, width: PAGE.width, height: BAND.stripe }, 'Band stripe', inks.accent, { behindDoc: true });

  let nameX = SIDE;
  if (marks.monogramLight) {
    const box = fitMark(marks.monogramLight.aspect, 48, 36);
    first.image({ x: SIDE, y: (BAND.height - box.height) / 2, ...box }, 'Monogram', marks.monogramLight.relationshipId);
    nameX += box.width + 14;
  }

  const addressWidth = 170;
  const nameWidth = PAGE.width - SIDE - addressWidth - 24 - nameX;
  const nameLines = lineCount([content.firmName.toUpperCase()], nameWidth, 15);
  const nameHeight = nameLines * 19;
  first.text({ x: nameX, y: (BAND.height - nameHeight) / 2, width: nameWidth, height: nameHeight + 19 }, 'Name',
    nameLine(content, 15, inks.white, 2.5, 'left'));

  const blockLines = [...content.address, ...content.contact];
  if (blockLines.length > 0) {
    const height = lineCount(blockLines, addressWidth, 7.5) * 10;
    const style = (color: string): RunStyle => ({ font: content.fontFamily, size: 7.5, color });
    first.text(
      { x: PAGE.width - SIDE - addressWidth, y: Math.max(14, (BAND.height - height) / 2), width: addressWidth, height: height + 10 },
      'Address',
      [
        ...content.address.map((l) => para(run(l, style(inks.white)), { align: 'right', line: 10 })),
        ...content.contact.map((l) => para(run(l, style(inks.accentSoft)), { align: 'right', line: 10 })),
      ].join(''),
    );
  }
  footRoster(first, content, 'left', inks.hairline);

  const rest = new Canvas();
  rest.fill({ x: 0, y: 0, width: PAGE.width, height: 12 }, 'Band', inks.primary, { behindDoc: true });
  rest.fill({ x: 0, y: 12, width: PAGE.width, height: 1.5 }, 'Band stripe', inks.accent, { behindDoc: true });
  rest.text({ x: SIDE, y: 32, width: MEASURE, height: 12 }, 'Running head', nameLine(content, 7.5, inks.primary, 2, 'left'));

  return {
    firstPageHeaderXml: first.header(namespaces),
    continuationHeaderXml: rest.header(namespaces),
    margins: margins(BAND.height + BAND.stripe + 42),
  };
}

// ── Ledger ───────────────────────────────────────────────────────────
/** The name ranged left, the address ranged right, a double rule beneath both. */
function ledger(content: LetterheadContent, marks: LetterheadMarks, namespaces: string): LetterheadParts {
  const { inks } = content;
  const first = new Canvas();
  const top = 44;
  const addressWidth = 190;
  let leftBottom: number;

  if (marks.wordmark) {
    const box = fitMark(marks.wordmark.aspect, 240, 44);
    first.image({ x: SIDE, y: top, ...box }, 'Wordmark', marks.wordmark.relationshipId);
    leftBottom = top + box.height;
  } else {
    let nameX = SIDE;
    if (marks.monogram) {
      const box = fitMark(marks.monogram.aspect, 44, 32);
      first.image({ x: SIDE, y: top, ...box }, 'Monogram', marks.monogram.relationshipId);
      nameX += box.width + 12;
    }
    const nameWidth = PAGE.width - SIDE - addressWidth - 24 - nameX;
    const nameHeight = lineCount([content.firmName.toUpperCase()], nameWidth, 14) * 18;
    first.text({ x: nameX, y: top + 6, width: nameWidth, height: nameHeight + 18 }, 'Name',
      nameLine(content, 14, inks.primary, 1.5, 'left'));
    leftBottom = Math.max(top + 32, top + 6 + nameHeight);
  }

  let rightBottom = top;
  const blockLines = [...content.address, ...content.contact];
  if (blockLines.length > 0) {
    const height = lineCount(blockLines, addressWidth, 7.5) * 10;
    const style = (color: string): RunStyle => ({ font: content.fontFamily, size: 7.5, color });
    first.text({ x: PAGE.width - SIDE - addressWidth, y: top, width: addressWidth, height: height + 10 }, 'Address', [
      ...content.address.map((l) => para(run(l, style(inks.inkSoft)), { align: 'right', line: 10 })),
      ...content.contact.map((l) => para(run(l, style(inks.accent)), { align: 'right', line: 10 })),
    ].join(''));
    rightBottom = top + height;
  }

  const ruleY = Math.max(leftBottom, rightBottom) + 12;
  first.fill({ x: SIDE, y: ruleY, width: MEASURE, height: 1.25 }, 'Rule', inks.primary);
  first.fill({ x: SIDE, y: ruleY + 3.25, width: MEASURE, height: 0.5 }, 'Rule', inks.accent);
  footRoster(first, content, 'left', inks.hairline);

  const rest = new Canvas();
  rest.text({ x: SIDE, y: 38, width: MEASURE, height: 12 }, 'Running head', nameLine(content, 7.5, inks.primary, 2, 'left'));
  rest.fill({ x: SIDE, y: 52, width: MEASURE, height: 0.75 }, 'Running rule', inks.primary);

  return {
    firstPageHeaderXml: first.header(namespaces),
    continuationHeaderXml: rest.header(namespaces),
    margins: margins(ruleY + 34),
  };
}

const DESIGNS: Record<LetterheadDesign, typeof classic> = { classic, band, ledger };

/** Both header parts and the page margins they assume, for one design. */
export function letterheadParts(
  design: LetterheadDesign,
  content: LetterheadContent,
  opts: { namespaces: string; marks: LetterheadMarks },
): LetterheadParts {
  return DESIGNS[design](content, opts.marks, opts.namespaces);
}

// ── Package parts ────────────────────────────────────────────────────
/** Rewrite a section's page margins to the letterhead's. */
export function applyMargins(sectPr: string, m: LetterheadMargins): string {
  const pgMar =
    `<w:pgMar w:top="${twips(m.top)}" w:right="${twips(m.right)}" ` +
    `w:bottom="${twips(m.bottom)}" w:left="${twips(m.left)}" ` +
    'w:header="708" w:footer="708" w:gutter="0"/>';
  return /<w:pgMar\b[^>]*\/>/.test(sectPr)
    ? sectPr.replace(/<w:pgMar\b[^>]*\/>/, pgMar)
    : sectPr.replace(/(<w:pgSz\b[^>]*\/>)/, `$1${pgMar}`);
}

/** The namespace declarations the template's own header uses, so ours match it. */
export function headerNamespaces(headerXml: string): string {
  const m = headerXml.match(/<w:hdr\s([^>]*)>/);
  if (!m) throw new Error('Could not read the namespaces from the template header');
  return m[1];
}

const IMAGE_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image';

/** A header part's relationships: one image per target, ids in order from rId1. */
export function imageRelationships(targets: string[]): string {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    targets.map((target, i) => `<Relationship Id="rId${i + 1}" Type="${IMAGE_TYPE}" Target="${escapeXml(target)}"/>`).join('') +
    '</Relationships>';
}

/** Declare an image extension in [Content_Types].xml when it is not already. */
export function ensureImageContentType(contentTypesXml: string, ext: 'png' | 'jpg'): string {
  if (new RegExp(`<Default Extension="${ext}"`, 'i').test(contentTypesXml)) return contentTypesXml;
  const type = ext === 'png' ? 'image/png' : 'image/jpeg';
  return contentTypesXml.replace(/<Types([^>]*)>/, `<Types$1><Default Extension="${ext}" ContentType="${type}"/>`);
}

/**
 * Set every style in the template in the firm's face. The bundled template
 * names a neutral face; a letter typed into it, or a paragraph the drafting
 * code writes without its own run fonts, should read in the firm's.
 */
export function applyStyleFont(stylesXml: string, family: string): string {
  const name = escapeXml(family);
  return stylesXml.replace(/<w:rFonts\b[^>]*\/>/g, (tag) =>
    tag.replace(/\bw:(ascii|hAnsi|cs|eastAsia)="[^"]*"/g, `w:$1="${name}"`)
      .replace(/\s*w:(ascii|hAnsi|cs|eastAsia)Theme="[^"]*"/g, ''));
}

/** The bundled template's sign-off, set to the firm's document name. */
export const SIGN_OFF_MARKER = '[FIRM NAME]';

export function signOff(documentXml: string, firmName: string): string {
  return documentXml.split(SIGN_OFF_MARKER).join(escapeXml(firmName));
}
