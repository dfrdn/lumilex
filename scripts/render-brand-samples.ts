/**
 * Render the branded document set for one firm and assert it actually came out
 * in that firm's brand.
 *
 *   npx tsx scripts/render-brand-samples.ts [firmId] [outDir]
 *
 * Writes a fee schedule, an engagement proposal letter, an annex divider and a
 * firm profile, then checks each PDF for the things a screenshot would catch:
 *   - the firm's own name in the running header and PDF metadata
 *   - no string from any other firm anywhere in the page content
 *   - the fonts the firm's set declares, embedded when the set bundles real
 *     files, and no font file embedded that we are not licensed to redistribute
 *   - the peso prefix the set declared it could print
 *   - the derived palette actually painted (fill operators match)
 *
 * Text is read straight out of the content streams (inflating them where
 * pdfkit deflated them) rather than through a PDF text extractor, so the check
 * needs no extra dependency and sees exactly the bytes that were written. An
 * embedded face is written as Identity-H — the show operators carry glyph ids,
 * not characters — so the ids are mapped back through each font's own
 * /ToUnicode CMap. Without that every text assertion here silently passes on a
 * page it can no longer read.
 */

import './load-env';
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { loadFirmBrand } from '@/lib/pdf/firm-brand';
import { generateFeeSchedulePdf } from '@/lib/pdf/fee-schedule';
import { generateEngagementProposalPdf } from '@/lib/pdf/engagement-proposal';
import { generateFirmProfilePdf } from '@/lib/pdf/firm-profile';
import { generateBillingBreakdownPdf, type BillingBreakdownPdfParams } from '@/lib/pdf/billing-breakdown';
import type { LawyerEntry } from '@/lib/billing/breakdown-types';
import type { Brand } from '@/lib/pdf/brand';
import type { EngagementProposalContent } from '@/lib/engagement-proposal/types';
import type { FeeScheduleContent } from '@/lib/fee-schedule/types';
import type { FirmProfileContent } from '@/lib/firm-profile/types';
import { brandTerms } from './brand-terms';

const DEV_FIRM = '00000000-0000-4000-8000-000000000001';

/**
 * The standard-14 PDF faces. A document rendered in a set that bundles real
 * files must not carry any of them: their presence means a renderer named a face
 * directly instead of resolving one through the firm's set.
 */
const CORE_FACES = [
  'Times-Roman', 'Times-Bold', 'Times-Italic', 'Times-BoldItalic',
  'Helvetica', 'Helvetica-Bold', 'Helvetica-Oblique', 'Helvetica-BoldOblique',
  'Courier', 'Courier-Bold', 'Courier-Oblique', 'Courier-BoldOblique',
  'Symbol', 'ZapfDingbats',
];

/** Licensed faces another firm used, which no tenant's document may embed. */
const FOREIGN_FACES = ['Felix Titling', 'AGaramond', 'Adobe Garamond', 'Forum-Regular'];

// ── PDF inspection ──────────────────────────────────────────────────

/** One indirect object: its dictionary text and its stream, inflated. */
interface PdfObject {
  dict: string;
  stream: string | null;
}

/**
 * Split the file into indirect objects. The stream is cut with the /Length the
 * dictionary declares rather than by searching for `endstream`, so binary that
 * happens to contain the keyword (font programs do) neither truncates an object
 * nor makes the scanner resume inside compressed bytes.
 */
function parseObjects(pdf: Buffer): Map<number, PdfObject> {
  const src = pdf.toString('latin1');
  const objects = new Map<number, PdfObject>();
  const re = /(\d+) 0 obj/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const bodyStart = m.index + m[0].length;
    const sm = /stream\r?\n/.exec(src.slice(bodyStart, bodyStart + 4096));
    const endObj = src.indexOf('endobj', bodyStart);
    if (!sm || (endObj !== -1 && bodyStart + sm.index > endObj)) {
      objects.set(Number(m[1]), { dict: src.slice(bodyStart, endObj), stream: null });
      continue;
    }
    const dict = src.slice(bodyStart, bodyStart + sm.index);
    const start = bodyStart + sm.index + sm[0].length;
    const declared = /\/Length (\d+)/.exec(dict);
    const end = declared ? start + Number(declared[1]) : src.indexOf('endstream', start);
    const raw = Buffer.from(src.slice(start, end), 'latin1');
    let stream = raw.toString('latin1');
    if (dict.includes('/FlateDecode')) {
      try {
        stream = zlib.inflateSync(raw).toString('latin1');
      } catch {
        // An image or a truncated slice; the raw bytes still get scanned.
      }
    }
    objects.set(Number(m[1]), { dict, stream });
    re.lastIndex = Math.max(re.lastIndex, end);
  }
  return objects;
}

/** The raw file plus every stream in it, decompressed. */
function rawContent(pdf: Buffer, objects: Map<number, PdfObject>): string {
  const out = [pdf.toString('latin1')];
  for (const obj of objects.values()) if (obj.stream) out.push(obj.stream);
  return out.join('\n');
}

/** How the show operators of one font's runs decode back to characters. */
interface FontDecoder {
  /** Identity-H: two bytes per glyph id, mapped through /ToUnicode. */
  wide: boolean;
  toUnicode: Map<number, string>;
}

/**
 * Parse a /ToUnicode CMap. pdfkit writes one `bfrange` in the array form
 * (`<lo> <hi> [<u> <u> …]`); `bfchar` and the plain range form are handled too,
 * so this keeps reading if pdfkit ever changes which it emits.
 */
function parseToUnicode(cmap: string): Map<number, string> {
  const map = new Map<number, string>();
  // A value is one or more 4-hex code units, space-separated: a ligature glyph
  // maps to the several characters it stands for (`<0066 0069>` for "fi"). Read
  // those as one entry or every index after them shifts.
  const hex = (s: string) =>
    String.fromCharCode(...(s.replace(/\s/g, '').match(/.{4}/g) ?? []).map((h) => parseInt(h, 16)));
  for (const block of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const e of block[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f\s]*)>/g)) {
      map.set(parseInt(e[1], 16), hex(e[2]));
    }
  }
  for (const block of cmap.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const e of block[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(\[[^\]]*\]|<[0-9A-Fa-f\s]*>)/g)) {
      const lo = parseInt(e[1], 16);
      const hi = parseInt(e[2], 16);
      if (e[3].startsWith('[')) {
        [...e[3].matchAll(/<([0-9A-Fa-f\s]*)>/g)].forEach((v, i) => map.set(lo + i, hex(v[1])));
      } else {
        const base = parseInt(e[3].replace(/[<>\s]/g, ''), 16);
        for (let c = lo; c <= hi; c++) map.set(c, String.fromCharCode(base + (c - lo)));
      }
    }
  }
  return map;
}

/**
 * Resource name (`/F3`) → how to decode runs set in it. pdfkit numbers fonts
 * per document, not per page, so one table serves every content stream.
 */
function fontDecoders(objects: Map<number, PdfObject>): Map<string, FontDecoder> {
  const decoders = new Map<string, FontDecoder>();
  for (const obj of objects.values()) {
    const fontDict = /\/Font\s*<<([\s\S]*?)>>/.exec(obj.dict);
    if (!fontDict) continue;
    for (const ref of fontDict[1].matchAll(/\/(\w+)\s+(\d+) 0 R/g)) {
      const font = objects.get(Number(ref[2]));
      if (!font) continue;
      const toUnicodeRef = /\/ToUnicode\s+(\d+) 0 R/.exec(font.dict);
      const cmap = toUnicodeRef ? objects.get(Number(toUnicodeRef[1]))?.stream : null;
      decoders.set(ref[1], {
        wide: /\/Subtype\s*\/Type0/.test(font.dict),
        toUnicode: cmap ? parseToUnicode(cmap) : new Map(),
      });
    }
  }
  return decoders;
}

/** Decode one show-operator string operand in the font currently selected. */
function decodeRun(bytes: string, font: FontDecoder | null): string {
  if (!font?.wide) return bytes;
  let out = '';
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    const gid = (bytes.charCodeAt(i) << 8) | bytes.charCodeAt(i + 1);
    out += font.toUnicode.get(gid) ?? '�';
  }
  return out;
}

/**
 * Text drawn by the show-text operators, as characters.
 *
 * pdfkit writes letterspaced runs as `[<hex> 100 <hex>] TJ` arrays of hex
 * strings, so a naive `(literal) Tj` scan finds nothing at all. For a core PDF
 * font those bytes are the characters; for an embedded face they are Identity-H
 * glyph ids, meaningless until run back through that font's /ToUnicode — hence
 * the `Tf` tracking, which says which font each run is set in.
 */
function drawnText(objects: Map<number, PdfObject>): string {
  const decoders = fontDecoders(objects);
  const pieces: string[] = [];
  const token = /\/(\w+)\s+[\d.]+\s+Tf|(\[[^\]]*\]|\((?:\\.|[^\\)])*\)|<[0-9A-Fa-f\s]*>)\s*(?:Tj|TJ|')/g;
  for (const obj of objects.values()) {
    if (!obj.stream || !obj.stream.includes('Tf')) continue;
    let font: FontDecoder | null = null;
    let m: RegExpExecArray | null;
    token.lastIndex = 0;
    while ((m = token.exec(obj.stream)) !== null) {
      if (m[1] !== undefined) {
        font = decoders.get(m[1]) ?? null;
        continue;
      }
      let run = '';
      for (const tok of m[2].matchAll(/<([0-9A-Fa-f\s]*)>|\(((?:\\.|[^\\)])*)\)/g)) {
        run += decodeRun(
          tok[1] !== undefined
            ? Buffer.from(tok[1].replace(/\s/g, ''), 'hex').toString('latin1')
            : tok[2].replace(/\\([()\\])/g, '$1'),
          font,
        );
      }
      pieces.push(run);
    }
  }
  return pieces.join(' ');
}

function pageCount(pdf: Buffer): number {
  return (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;
}

/**
 * "#26333f" → the colour operand pdfkit writes for it. It emits full
 * double precision through Number#toString and selects the colour with `scn`
 * under an explicit `/DeviceRGB cs`, not with the shorthand `rg`.
 */
function fillOp(hex: string): string {
  const n = (i: number) => String(parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255);
  return `${n(0)} ${n(1)} ${n(2)} scn`;
}

// ── Assertions ──────────────────────────────────────────────────────

let failures = 0;
function check(label: string, ok: boolean, detail = '') {
  if (ok) {
    console.log(`  ✓ ${label}`);
  } else {
    failures += 1;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

interface InspectOpts {
  expectPages: number;
  /** This document formats its money itself, so the prefix is ours to check. */
  expectPeso?: boolean;
}

function inspect(name: string, pdf: Buffer, brand: Brand, opts: InspectOpts) {
  const { expectPages, expectPeso = false } = opts;
  console.log(`\n${name}  (${(pdf.length / 1024).toFixed(0)} KB, ${pageCount(pdf)} pages)`);
  const objects = parseObjects(pdf);
  const content = rawContent(pdf, objects);
  const text = drawnText(objects);

  check(`at least ${expectPages} page(s)`, pageCount(pdf) >= expectPages, `got ${pageCount(pdf)}`);

  // Scan BOTH the object dictionaries (font names, metadata, image paths) and
  // the decoded page text — pdfkit writes shown text as hex strings, so a raw
  // byte scan alone silently passes a page that prints another firm's name.
  const haystack = `${content}\n${text}`.toLowerCase();
  const leaked = [...brandTerms(), ...FOREIGN_FACES.map((f) => f.toLowerCase())].filter((s) => haystack.includes(s));
  check('no other firm\'s name, mark or licensed font anywhere', leaked.length === 0, leaked.join(', '));

  check(
    'the firm\'s own name is set on the page',
    text.includes(brand.documentName) || text.includes(brand.documentName.toUpperCase())
      || brand.nameLines.every((l) => text.includes(l.toUpperCase())),
    `looked for "${brand.documentName}"`,
  );

  const fonts = [...new Set([...content.matchAll(/\/BaseFont\s*\/([A-Za-z0-9+#-]+)/g)].map((m) => m[1]))];
  check('fonts resolved', fonts.length > 0, `found ${fonts.join(', ')}`);

  // A bundled set has to arrive as embedded subsets — and as *distinct* ones.
  // pdfkit dedupes embedded fonts on their name records, so two faces cut from
  // one variable file collapse into a single subset and every weight prints in
  // whichever was opened first.
  const embedded = fonts.filter((f) => /^[A-Z]{6}\+/.test(f));
  if (brand.fonts.dir) {
    check(
      'the bundled faces are embedded as subsets',
      content.includes('/FontFile') && embedded.length >= 2,
      `embedded: ${embedded.join(', ') || 'none'}`,
    );
    check(
      'each weight is its own subset (none collapsed into another)',
      new Set(embedded.map((f) => f.slice(7))).size === embedded.length,
      embedded.join(', '),
    );
    // A renderer that asks pdfkit for a face by name ('Times-Roman') instead of
    // through the FONT.* aliases gets that core face, silently, whatever the
    // firm chose — the breakdown did exactly this while every set was core
    // fonts and nobody could see it. A bundled set embeds everything it uses,
    // so any standard-14 name here is a renderer that went around the set.
    const bypassed = fonts.filter((f) => CORE_FACES.includes(f));
    check('nothing set in a core PDF face (every renderer went through the set)', bypassed.length === 0, bypassed.join(', '));
  } else {
    check('no font program embedded (a core-font set embeds nothing)', !content.includes('/FontFile'));
  }

  check('primary painted', content.includes(fillOp(brand.palette.primary)), fillOp(brand.palette.primary));
  check('accent painted', content.includes(fillOp(brand.palette.accent)), fillOp(brand.palette.accent));

  // The set declares whether its faces carry ₱ (U+20B1); the formatters print
  // "P" when they do not — `peso()` in lib/pdf/letterhead.ts for the schedules,
  // `money()` in the breakdown. Getting that backwards is a notdef box on every
  // amount, so check the money actually on the page rather than the flag alone.
  // Amounts that arrive as *content* are covered too: the proposal fixture
  // deliberately authors one of its fee rows under the other symbol, the way a
  // draft stored before the firm changed `branding.fontSet` would have, and
  // `inBrandCurrency` in lib/pdf/engagement-proposal.ts re-prefixes it on the
  // way to the page. Both assertions below see through to that.
  if (!brand.fonts.hasPesoGlyph) {
    check('no ₱ printed by a set whose faces lack the glyph', !text.includes('₱'));
  } else if (expectPeso) {
    const amounts = [...text.matchAll(/₱\s?[\d,]+\.\d{2}/g)].map((m) => m[0]);
    check('amounts print ₱, which the set says its faces carry', amounts.length > 0, amounts.slice(0, 3).join(' '));
  }

  // Nothing on the page may fail to decode: a replacement char here means a
  // glyph was shown that its font's /ToUnicode cannot name — the same hole a
  // notdef box comes out of.
  check('every glyph on the page decodes', !text.includes('�'));
}

// ── Sample content ──────────────────────────────────────────────────

/**
 * Neutral fixtures rather than a real firm's published content: rendering a
 * transcribed rate card or profile would fail the leak check on the *content*,
 * not on the visual system this script exists to verify.
 */
function sampleSchedule(): FeeScheduleContent {
  return {
    slug: 'professional',
    name: 'Schedule of Fees',
    year: '2026',
    runningTitle: 'Professional Fee Schedule',
    cover: {
      firmName: 'unused — the brand supplies the lockup',
      title: 'Fee Schedule',
      subtitle: 'Retainer · Hourly · Acceptance Fees',
      edition: '2026 Edition',
      footnote: 'Strictly Confidential',
      addressLines: ['1 Sample Street', 'Makati City, Philippines'],
      email: 'hello@example.test',
      website: 'example.test',
      phone: '(02) 0000 0000',
    },
    body: {
      kind: 'professional',
      intro: 'This schedule sets out the standard professional fees of the Firm for 2026.',
      retainer: {
        heading: 'Monthly Retainer Fees',
        paragraphs: ['The Firm offers fixed monthly retainer packages.'],
        tiers: [
          { label: 'Tier I', hours: 3, monthlyFee: 10000, discountPct: 10 },
          { label: 'Tier II', hours: 6, monthlyFee: 15000, discountPct: 15 },
          { label: 'Custom', hours: 0, monthlyFee: null, discountPct: null, note: 'Subject to negotiation' },
        ],
      },
      hourly: {
        heading: 'Hourly Rates',
        paragraphs: ['For matters billed on a time basis, the following rates apply.'],
        rates: [
          { position: 'Partner', standard: 5500 },
          { position: 'Senior Associate', standard: 4500 },
        ],
      },
      acceptance: {
        heading: 'Acceptance Fees',
        paragraphs: ['Litigation matters carry a one-time acceptance fee.'],
        fees: [{ matter: 'Civil Case', standard: 80000 }],
      },
    },
    notesHeading: 'Notes',
    notes: [{ label: 'Out-of-pocket expenses', text: 'Billed at cost and separately from professional fees.' }],
    footnotes: ['All fees are exclusive of VAT.'],
  } as unknown as FeeScheduleContent;
}

function sampleProfile(): FirmProfileContent {
  return {
    cover: {
      firmName: 'unused — the brand supplies the lockup',
      fullName: 'unused',
      year: '2026',
      subtitle: 'FIRM PROFILE',
      practiceTags: ['Litigation', 'Corporate & Commercial'],
    },
    about: {
      heading: 'About Us',
      tagline: 'A sample tagline for the development tenant.',
      paragraphs: ['A placeholder paragraph describing the firm.'],
    },
    practiceAreas: {
      heading: 'Practice Areas',
      items: [{ title: 'Litigation', description: 'Representation before the courts.' }],
    },
    team: {
      heading: 'Our Team',
      groups: [{
        label: 'Partners',
        layout: 'list',
        members: [{ name: 'J. Dela Cruz', title: 'Managing Partner', bio: 'A placeholder biography.', photoUrl: '' }],
      }],
      supportLabel: 'Support',
      support: [{ name: 'A. Santos', role: 'Paralegal' }],
    },
    glance: { heading: 'The Firm at a Glance', stats: [{ value: '2021', label: 'Founded' }], affiliationsLabel: 'Affiliations', affiliations: [] },
    contact: {
      heading: 'Contact Us',
      officeLabel: 'Principal Office',
      addressLines: ['1 Sample Street', 'Makati City, Philippines'],
      phone: '(02) 0000 0000',
      email: 'hello@example.test',
      website: 'example.test',
    },
  } as unknown as FirmProfileContent;
}

/**
 * `peso` is what the firm's resolved set can print; `stale` is the other one.
 * A proposal's figures are content — written when the letter was drafted — so
 * the fixture carries one row in each, which is the state of every draft stored
 * before the prefix followed the set.
 */
function sampleProposal(peso: string): EngagementProposalContent {
  const stale = peso === '₱' ? 'P' : '₱';
  return {
    date: '2026-08-23',
    privilegeLine: 'Privileged and Confidential',
    client: { name: 'Northwind Holdings, Inc.', isCorporate: true, attnName: 'Ms. A. Reyes', attnTitle: 'President' },
    subject: 'Engagement Proposal — Retainer Services',
    salutation: 'Gentlemen/Mesdames:',
    intro: [
      'We are pleased to submit this proposal for the retainer engagement of the Firm. '
      + 'The **Initial Fee** for Retainer Services is set out in the schedule bound behind this letter.',
    ],
    validityDays: 30,
    sections: [
      {
        heading: 'Scope of Services',
        blocks: [
          { kind: 'subheading', text: 'Retainer Services' },
          { kind: 'labelled', label: 'General legal support', text: 'Day-to-day advice on corporate and commercial matters.' },
          { kind: 'list', ordered: true, items: ['Contract review', 'Regulatory filings'] },
          { kind: 'feeTable', rows: [
            { fee: 'Monthly retainer', amount: `${peso}50,000.00`, when: 'Every 5th of the month' },
            { fee: 'Initial Fee', amount: `${stale}300,000.00`, when: 'On acceptance of the engagement' },
          ] },
        ],
      },
    ],
    closing: ['We look forward to working with you.'],
    signer: { firmName: 'ignored — the brand supplies this', name: 'J. Dela Cruz', position: 'Managing Partner' },
    annexes: { feeScheduleSlugs: ['professional'], includeFirmProfile: true },
    coverKicker: 'Retainer Proposal',
    firmContact: {
      addressLines: ['1 Sample Street', 'Makati City, Philippines'],
      phone: '(02) 0000 0000',
      email: 'hello@example.test',
      website: 'example.test',
    },
    payment: {
      bankName: 'Sample Bank',
      accountName: 'Lumilex Dev Firm',
      accountNo: '0000000000',
      tin: '000-000-000',
      note: '',
    },
  } as EngagementProposalContent;
}

/**
 * The billing breakdown fixture — deliberately the heaviest of the four.
 *
 * The breakdown is a money document made almost entirely of numeric tables, so a
 * typeface change moves every column in it. A near-empty fixture renders one
 * tidy page and proves nothing; this one is built to break if the metrics stop
 * fitting:
 *
 *   - five lawyers over four matters, so the per-matter sub-tables render and a
 *     matter that spills across a page re-announces itself "(continued)"
 *   - descriptions long enough to wrap to three and four lines, which is what
 *     the measured row heights are computed from
 *   - amounts from four figures (an expense) through seven (an acceptance fee,
 *     the grand total, the amount due), so a currency column that can no longer
 *     hold its widest string shows up instead of hiding behind small numbers
 *   - waived lines, negative discount lines, VAT, a previous balance and a
 *     deposit application, so every band and every summary line is on the page
 *   - enough rows to run to several pages, exercising page-break placement, the
 *     repeated header and the "Page X of Y" footer
 *
 * Keep it that way: the next typeface change is only verifiable against a
 * fixture that fills the page.
 */
const MATTERS = {
  collection: {
    matterId: 'matter-26-114',
    matterCode: '26-114',
    matterName: 'Sunrise Logistics — Collection of Sum of Money (RTC Br. 148)',
  },
  capital: {
    matterId: 'matter-26-118',
    matterCode: '26-118',
    matterName: 'Increase of Authorized Capital Stock',
  },
  labour: {
    matterId: 'matter-26-121',
    matterCode: '26-121',
    matterName: 'Illegal Dismissal — Field Operations Group (NLRC NCR)',
  },
  mark: {
    matterId: 'matter-26-130',
    matterCode: '26-130',
    matterName: 'Trademark Opposition — Class 39',
  },
} as const;

type Matter = (typeof MATTERS)[keyof typeof MATTERS];
/** [date, hours, particulars, waived?] */
type TimeRow = [string, number, string] | [string, number, string, true];

function entries(matter: Matter, hourlyRate: number, rows: TimeRow[]): LawyerEntry[] {
  return rows.map(([date, hours, description, waived]) => ({
    date, hours, description, hourlyRate, waived: waived ?? false, ...matter,
  }));
}

function sampleBreakdown(): BillingBreakdownPdfParams {
  return {
    billingPeriod: 'August 2026',
    clientName: 'Northwind Holdings, Inc.',
    invoiceNumber: 'DEV-2026-08-0147',
    firmAddress: '1 Sample Street, Makati City',
    firmAddress2: 'Philippines',
    firmTIN: 'TIN 000-000-000',

    monthlyRetainer: 60000,
    retainerHoursCap: 20,

    acceptanceFees: [
      {
        clientOrMatter: '[26-114] Sunrise Logistics — Collection of Sum of Money',
        caseDescription:
          'One-time acceptance fee for the filing and prosecution of the collection suit, inclusive of the '
          + 'application for a writ of preliminary attachment over the respondent’s rolling stock.',
        amount: 1250000,
      },
      {
        clientOrMatter: '[26-130] Trademark Opposition — Class 39',
        caseDescription: 'Acceptance fee for the verified opposition before the Bureau of Legal Affairs.',
        amount: 180000,
      },
    ],

    // Within the 20-hour cap: absorbed, shown for transparency.
    withinRetainer: [
      {
        name: 'J. Dela Cruz',
        initials: 'JDC',
        position: 'Managing Partner',
        entries: [
          ...entries(MATTERS.capital, 5500, [
            ['2026-08-03', 1.5, 'Conference with the Corporate Secretary on the timetable for the increase in authorized capital stock and the supporting treasurer’s affidavit.'],
            ['2026-08-06', 0.8, 'Review of the draft directors’ certificate.'],
          ]),
          ...entries(MATTERS.collection, 5500, [
            ['2026-08-04', 2.2, 'Case assessment conference with the client’s finance group; review of the statement of account and the demand letters previously sent.'],
            ['2026-08-11', 1.1, 'Telephone conference with counsel for the respondent on a possible compromise.'],
          ]),
        ],
      },
      {
        name: 'M. Villanueva',
        initials: 'MSV',
        position: 'Senior Associate',
        entries: entries(MATTERS.labour, 4500, [
          ['2026-08-05', 3.4, 'Review of the position paper filed by the complainants and of the company’s own records of the disciplinary proceedings, including the notices to explain and the administrative hearing minutes.'],
          ['2026-08-07', 2.0, 'Drafting of the outline of the company’s reply.'],
          ['2026-08-12', 1.6, 'Conference with the HR head on the documentary exhibits.'],
        ]),
      },
    ],

    // Beyond the cap: charged. The bulk of the document.
    beyondRetainer: [
      {
        name: 'J. Dela Cruz',
        initials: 'JDC',
        position: 'Managing Partner',
        entries: [
          ...entries(MATTERS.collection, 5500, [
            ['2026-08-13', 3.6, 'Drafting and revision of the Reply to the Opposition to the Motion for Partial Summary Judgment, including verification of the annexed statements of account against the client’s ledger and conformity with the pre-trial order.'],
            ['2026-08-14', 2.4, 'Final review and approval of the Reply; conference with the handling associate on the annexes.'],
            ['2026-08-18', 1.8, 'Appearance before the Regional Trial Court, Branch 148, for the hearing on the motion.'],
            ['2026-08-25', 2.9, 'Study of the respondent’s Comment and preparation of the outline of the memorandum.'],
          ]),
          ...entries(MATTERS.mark, 5500, [
            ['2026-08-19', 1.4, 'Review of the verified notice of opposition and the accompanying affidavit of the client’s marketing director.'],
            ['2026-08-26', 0.9, 'Conference with the client on the prospects of a coexistence agreement.', true],
          ]),
        ],
      },
      {
        name: 'M. Villanueva',
        initials: 'MSV',
        position: 'Senior Associate',
        entries: [
          ...entries(MATTERS.labour, 4500, [
            ['2026-08-13', 4.2, 'Drafting of the company’s Position Paper, including the statement of facts, the discussion on just cause under Article 297 of the Labor Code, and the compliance with the twin-notice requirement.'],
            ['2026-08-14', 3.8, 'Continuation of the drafting of the Position Paper; preparation of the judicial affidavits of the two company witnesses.'],
            ['2026-08-17', 2.6, 'Revision of the Position Paper per the partner’s comments; finalisation of the annexes and pagination.'],
            ['2026-08-20', 3.1, 'Attendance at the mandatory conference before the Labor Arbiter and preparation of the minutes for the client’s file.'],
            ['2026-08-24', 1.7, 'Drafting of the reply to the complainants’ manifestation.'],
          ]),
          ...entries(MATTERS.collection, 4500, [
            ['2026-08-15', 2.3, 'Preparation of the annexes to the Reply and certification of the machine copies against the originals.'],
            ['2026-08-21', 1.9, 'Research on the interest rate applicable to the unpaid freight charges and the reckoning date under prevailing jurisprudence.'],
          ]),
        ],
      },
      {
        name: 'R. Bautista',
        initials: 'RAB',
        position: 'Associate',
        entries: [
          ...entries(MATTERS.capital, 3500, [
            ['2026-08-05', 2.8, 'Preparation of the SEC application for the increase in authorized capital stock, the directors’ certificate, and the treasurer’s affidavit.'],
            ['2026-08-06', 1.9, 'Filing of the application with the Securities and Exchange Commission and follow-up with the processing officer.'],
            ['2026-08-10', 2.2, 'Compliance with the SEC examiner’s findings on the subscription and payment schedule; re-filing of the corrected annexes.'],
            ['2026-08-19', 1.4, 'Preparation of the amended articles of incorporation for signature.'],
          ]),
          ...entries(MATTERS.mark, 3500, [
            ['2026-08-11', 3.3, 'Search of the trademark register and preparation of the comparative table of the cited marks in Class 39, with printouts of the relevant registrations.'],
            ['2026-08-12', 2.7, 'Drafting of the verified notice of opposition.'],
            ['2026-08-20', 1.6, 'Preparation of the affidavit of the marketing director in support of the opposition.'],
          ]),
        ],
      },
      {
        name: 'A. Reyes',
        initials: 'ACR',
        position: 'Junior Associate',
        entries: [
          ...entries(MATTERS.collection, 2800, [
            ['2026-08-07', 2.1, 'Collation and paging of the documentary exhibits; preparation of the exhibit index.'],
            ['2026-08-13', 1.8, 'Filing of the Reply with the Regional Trial Court and service of copies on the respondent’s counsel by registered mail.'],
            ['2026-08-27', 1.2, 'Securing of certified true copies of the orders from the branch clerk of court.'],
          ]),
          ...entries(MATTERS.labour, 2800, [
            ['2026-08-14', 2.4, 'Preparation of the judicial affidavit annexes and the verification and certification against forum shopping.'],
            ['2026-08-18', 1.5, 'Filing of the Position Paper with the NLRC and service on the complainants’ counsel.'],
            ['2026-08-28', 0.9, 'Docketing of the next hearing date and calendaring of the reglementary period to reply.', true],
          ]),
        ],
      },
    ],

    feeLines: [
      { kind: 'fixed_fee', matterName: 'Increase of Authorized Capital Stock', description: 'Fixed fee for the SEC application, end to end, inclusive of one round of compliance with examiner findings.', amount: 350000 },
      { kind: 'fixed_fee', matterName: 'Corporate housekeeping', description: 'Annual general information sheet and minutes book review.', amount: 95000 },

      // First row carries the "× N" deriveFeeLines bakes into the description,
      // so the sample shows the renderer dropping the duplicate count once the
      // unit line prints it.
      { kind: 'action', matterName: 'Sunrise Logistics — Collection', description: 'Court appearances beyond the two covered by the retainer × 3', amount: 36000, quantity: 3 },
      { kind: 'action', matterName: 'Portfolio-wide', description: 'Notarial acknowledgment and jurat', amount: 21000, quantity: 14 },
      { kind: 'action', matterName: 'Trademark Opposition — Class 39', description: 'Filing and docketing before the Bureau of Legal Affairs', amount: 9000, quantity: 2 },

      { kind: 'milestone', matterName: 'Sunrise Logistics — Collection', description: 'Milestone on the grant of the writ of preliminary attachment over the respondent’s rolling stock.', amount: 750000 },
      { kind: 'milestone', matterName: 'Increase of Authorized Capital Stock', description: 'Milestone on the issuance of the SEC certificate of approval.', amount: 425000 },

      { kind: 'adhoc', matterName: null, description: 'Preparation of the board resolution authorising the compromise negotiations.', amount: 8500 },
      { kind: 'adhoc', matterName: 'Field Operations Group', description: 'Review of the revised employee handbook, disciplinary matrix and the two template notices to explain.', amount: 62400 },

      { kind: 'informational_hours', matterName: 'Retainer advisory', description: 'General corporate advisory hours rendered under the fixed retainer (18.4 hours).', amount: 0 },
      { kind: 'informational_hours', matterName: 'Compliance calendar', description: 'Monitoring of regulatory deadlines across the portfolio (6.1 hours).', amount: 0 },

      { kind: 'discount', matterName: 'Sunrise Logistics — Collection', description: 'Long-standing client courtesy on the acceptance fee (10%)', amount: -125000 },
      { kind: 'discount', matterName: 'Portfolio-wide', description: 'Volume adjustment on per-action fees', amount: -18750 },
    ],

    expenses: [
      { date: '2026-08-04', description: 'Filing fees — Regional Trial Court, Branch 148 (docket, sheriff’s and mediation fees on the collection suit)', amount: 48750 },
      { date: '2026-08-06', description: 'SEC filing and examination fees', amount: 12480 },
      {
        date: '2026-08-07',
        description: 'Reproduction of the documentary exhibits for the pre-trial brief',
        amount: 4725,
        photocopyDetail: { costPerPage: 1.5, numberOfSets: 7, pagesPerSet: 450, totalCopies: 3150 },
      },
      { date: '2026-08-13', description: 'Registered mail with return card — service of the Reply on the respondent’s counsel', amount: 1850 },
      { date: '2026-08-14', description: 'Notarial fees — judicial affidavits of the company witnesses', amount: 3000 },
      { date: '2026-08-18', description: 'Transportation and parking — hearing before the Regional Trial Court', amount: 2380 },
      { date: '2026-08-19', description: 'Certified true copies — branch clerk of court', amount: 1260 },
      { date: '2026-08-20', description: 'Transportation — mandatory conference before the Labor Arbiter, and courier of the position paper annexes to the client’s office', amount: 3140 },
      { date: '2026-08-24', description: 'Courier — trademark opposition filing set', amount: 980, waived: true },
      { date: '2026-08-27', description: 'Meals during the overnight finalisation of the memorandum outline', amount: 2650, waived: true },
    ],

    includeVAT: true,
    vatRate: 0.12,
    previousBalance: 68400,

    depositApplied: 2000000,
    depositRemaining: 1150000,
  };
}

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  const firmId = process.argv[2] || DEV_FIRM;
  const outDir = process.argv[3] || path.join(process.cwd(), '.brand-samples');
  fs.mkdirSync(outDir, { recursive: true });

  const brand = await loadFirmBrand(firmId);
  console.log('Brand resolved:');
  console.log(`  documentName  ${brand.documentName}`);
  console.log(`  nameLines     ${JSON.stringify(brand.nameLines)}`);
  console.log(`  tagline       ${brand.tagline || '(none)'}`);
  console.log(`  fontSet       ${brand.fonts.name} (${brand.fonts.label}), ₱ glyph: ${brand.fonts.hasPesoGlyph}`);
  console.log(`  palette       primary ${brand.palette.primary} · accent ${brand.palette.accent}`);
  console.log(`                surface ${brand.palette.surface} · page ${brand.palette.surfacePage}`);
  console.log(`  monogram      ${brand.assets.monogram ?? '(none configured — renders blank)'}`);
  console.log(`  logo          ${brand.assets.logo ?? '(none configured — renders blank)'}`);

  const write = (name: string, buf: Buffer) => {
    fs.writeFileSync(path.join(outDir, name), buf);
    return buf;
  };

  inspect('fee-schedule.pdf', write('fee-schedule.pdf', await generateFeeSchedulePdf(brand, sampleSchedule())), brand, {
    expectPages: 2,
    // Every figure on a fee schedule is formatted by peso().
    expectPeso: true,
  });
  inspect('engagement-proposal.pdf', write('engagement-proposal.pdf', await generateEngagementProposalPdf(brand, sampleProposal(brand.pesoSymbol), {
    annexLabels: ['Annex “A” — Schedule of Fees', 'Annex “B” — Firm Profile'],
  })), brand, {
    expectPages: 3,
    // The fee table's amounts are content, not formatted by a renderer — which
    // is the point: one of the two rows is authored under the other symbol.
    expectPeso: true,
  });
  inspect('firm-profile.pdf', write('firm-profile.pdf', await generateFirmProfilePdf(brand, sampleProfile())), brand, { expectPages: 5 });
  inspect(
    'billing-breakdown.pdf',
    write('billing-breakdown.pdf', await generateBillingBreakdownPdf(brand, sampleBreakdown())),
    brand,
    // Every prefixed amount on it — the emphasis bands, the grand total, the
    // amount due — is formatted by the document's own `money()`.
    { expectPages: 4, expectPeso: true },
  );

  console.log(`\nWrote ${outDir}`);
  if (failures) {
    console.error(`\n${failures} check(s) FAILED`);
    process.exit(1);
  }
  console.log('\nAll checks passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
