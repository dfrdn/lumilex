import fs from 'fs';
import path from 'path';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { LETTERHEAD_DESIGNS, pickLetterheadDesign } from '@/lib/firm/letterhead-design';
import {
  SIGN_OFF_MARKER,
  applyMargins,
  applyStyleFont,
  bySeniority,
  byLetterhead,
  ensureImageContentType,
  fitMark,
  headerNamespaces,
  imageRelationships,
  letterheadParts,
  rosterGroups,
  rosterOverflows,
  signOff,
  type LetterheadContent,
  type LetterheadMarks,
} from './letterhead';

const TEMPLATE = path.join(__dirname, 'template.docx');

async function part(name: string): Promise<string> {
  const zip = await JSZip.loadAsync(fs.readFileSync(TEMPLATE));
  return zip.files[name].async('string');
}

const content = (over: Partial<LetterheadContent> = {}): LetterheadContent => ({
  roster: [
    { label: 'Partners', names: ['Maria Santos', 'Jose Reyes'] },
    { label: 'Senior Associate', names: ['Ana Mendoza'] },
  ],
  address: ['10/F Example Tower', 'Makati City'],
  contact: ['office@firm.example'],
  firmName: 'Santos & Reyes',
  fontFamily: 'Garamond',
  inks: {
    primary: '#7a1f2b',
    accent: '#b08d57',
    accentSoft: '#c0a274',
    hairline: '#dccbb0',
    ink: '#1c1c1c',
    inkSoft: '#3a3a3a',
    white: '#ffffff',
  },
  ...over,
});

const NO_MARKS: LetterheadMarks = { wordmark: null, monogram: null, monogramLight: null };
const ALL_MARKS: LetterheadMarks = {
  wordmark: { relationshipId: 'rId1', aspect: 6 },
  monogram: { relationshipId: 'rId2', aspect: 1 },
  monogramLight: { relationshipId: 'rId3', aspect: 1 },
};
const ns = 'xmlns:w="w"';

describe('the bundled template', () => {
  it('carries no firm: no media, no embedded fonts, no attached template, empty headers', async () => {
    const zip = await JSZip.loadAsync(fs.readFileSync(TEMPLATE));
    const names = Object.keys(zip.files);
    expect(names.filter((n) => n.startsWith('word/media/'))).toEqual([]);
    expect(names.filter((n) => n.startsWith('word/fonts/'))).toEqual([]);
    expect(names).not.toContain('word/_rels/settings.xml.rels');
    for (const header of ['word/header1.xml', 'word/header2.xml']) {
      const xml = await part(header);
      expect(xml).not.toContain('<w:drawing>');
      expect(xml).not.toContain('<w:t');
    }
  });

  it('has a first-page header, a sign-off slot, and namespaces a header can reuse', async () => {
    const documentXml = await part('word/document.xml');
    expect(documentXml).toContain('<w:titlePg/>');
    expect(documentXml).toContain(SIGN_OFF_MARKER);
    const namespaces = headerNamespaces(await part('word/header1.xml'));
    for (const prefix of ['w', 'wp', 'r', 'wps']) expect(namespaces).toContain(`xmlns:${prefix}=`);
  });

  it('leaves no licensed face named', async () => {
    for (const name of ['word/styles.xml', 'word/fontTable.xml']) {
      expect(await part(name)).not.toMatch(/Adobe Garamond/);
    }
  });
});

describe('pickLetterheadDesign', () => {
  it('honours a firm\'s own choice', () => {
    for (const design of LETTERHEAD_DESIGNS) expect(pickLetterheadDesign(design, 'Any Firm')).toBe(design);
  });

  it('seeds a stable design from the name, ignoring case and spacing', () => {
    const a = pickLetterheadDesign('auto', 'Santos & Reyes');
    expect(pickLetterheadDesign('auto', '  santos   &  REYES ')).toBe(a);
    expect(LETTERHEAD_DESIGNS).toContain(a);
  });

  it('spreads names across every design', () => {
    const names = Array.from({ length: 60 }, (_, i) => `Firm Number ${i} Law Offices`);
    const seen = new Set(names.map((n) => pickLetterheadDesign('auto', n)));
    expect([...seen].sort()).toEqual([...LETTERHEAD_DESIGNS].sort());
  });
});

describe('rosterGroups', () => {
  it('lists counsel only, grouped, by rank then tenure then surname', () => {
    const groups = rosterGroups([
      { name: 'Paolo Cruz', position: 'Partner', start_date: '2015-01-01' },
      { name: 'Lea Bautista', position: 'Managing Partner', start_date: '2019-01-01' },
      { name: 'Ben Aquino', position: 'Partner', start_date: '2015-01-01' },
      { name: 'Rita Lim', position: 'Partner', start_date: null },
      { name: 'Carlo Tan', position: 'Partner', start_date: '2012-06-01' },
      { name: 'Joy Uy', position: 'Underbar Associate', start_date: '2024-01-01' },
      { name: 'Mae Go', position: 'admin', start_date: '2010-01-01' },
    ]);
    expect(groups).toEqual([
      { label: 'Partners', names: ['Lea Bautista', 'Carlo Tan', 'Ben Aquino', 'Paolo Cruz', 'Rita Lim'] },
    ]);
  });

  it('is total even for identical rank, start date and surname', () => {
    const a = { name: 'A Cruz', position: 'Partner', start_date: null };
    const b = { name: 'B Cruz', position: 'Partner', start_date: null };
    const cmp = bySeniority(['Partner']);
    expect(Math.sign(cmp(a, b))).toBe(-Math.sign(cmp(b, a)));
    expect(cmp(a, b)).not.toBe(0);
  });
});

describe.each(LETTERHEAD_DESIGNS)('the %s design', (design) => {
  const parts = (over: Partial<LetterheadContent> = {}, marks = NO_MARKS) =>
    letterheadParts(design, content(over), { namespaces: ns, marks });

  it('prints the roster once, on page one, in the firm\'s face and inks', () => {
    const { firstPageHeaderXml: first, continuationHeaderXml: rest } = parts();
    expect(first.match(/Maria Santos/g)).toHaveLength(1);
    expect(rest).not.toContain('Maria Santos');
    expect(first).not.toContain('mc:AlternateContent');
    expect(first).toContain('w:ascii="Garamond"');
    expect(first).toContain('<w:color w:val="B08D57"/>'); // roster labels in the accent
    expect(first).toContain('office@firm.example');
  });

  it('keeps the body clear of the roster on page one only', () => {
    const { firstPageHeaderXml: first, continuationHeaderXml: rest } = parts();
    expect(first).toContain('<wp:wrapTopAndBottom/>');
    expect(rest).not.toContain('<wp:wrapTopAndBottom/>');
    expect(parts({ roster: [] }).firstPageHeaderXml).not.toContain('<wp:wrapTopAndBottom/>');
  });

  it('runs the firm\'s name, escaped, on the pages after the first', () => {
    expect(parts().continuationHeaderXml).toContain('Santos &amp; Reyes');
  });

  it('gives every drawing in a part its own id', () => {
    for (const xml of Object.values(parts({}, ALL_MARKS)).filter((v) => typeof v === 'string') as string[]) {
      const ids = [...xml.matchAll(/<wp:docPr id="(\d+)"/g)].map((m) => m[1]);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('starts the body below the head of page one', () => {
    const { margins } = parts();
    expect(margins.top).toBeGreaterThan(90);
    expect(margins.top).toBeLessThan(200);
    expect(margins.left).toBe(margins.right);
  });

  it('leaves out the address for a firm with none configured', () => {
    expect(parts({ address: [], contact: [] }).firstPageHeaderXml).not.toContain('name="Address"');
  });
});

describe('marks', () => {
  it('places the wordmark in Classic and Ledger, and only the light monogram on the Band', () => {
    const marks = (design: 'classic' | 'band' | 'ledger') =>
      letterheadParts(design, content(), { namespaces: ns, marks: ALL_MARKS }).firstPageHeaderXml;
    expect(marks('classic')).toContain('r:embed="rId1"');
    expect(marks('ledger')).toContain('r:embed="rId1"');
    expect(marks('band')).not.toContain('r:embed="rId1"');
    expect(marks('band')).not.toContain('r:embed="rId2"');
    expect(marks('band')).toContain('r:embed="rId3"');
  });

  it('sets the name as type when there is no wordmark', () => {
    const first = letterheadParts('classic', content(), { namespaces: ns, marks: NO_MARKS }).firstPageHeaderXml;
    expect(first).toContain('Santos &amp; Reyes');
    expect(first).not.toContain('r:embed=');
  });

  it('holds a mark to its box, keeping its proportions', () => {
    expect(fitMark(1, 300, 40)).toEqual({ width: 40, height: 40 });
    const wide = fitMark(26, 300, 40);
    expect(wide.width).toBe(300);
    expect(wide.height).toBeCloseTo(300 / 26);
  });
});

describe('rosterOverflows', () => {
  it('reports a roster that would take more than a third of the page', () => {
    const names = Array.from({ length: 300 }, (_, i) => `Associate Number ${i}`);
    expect(rosterOverflows(content())).toBe(false);
    expect(rosterOverflows(content({ roster: [{ label: 'Partners', names }] }))).toBe(true);
  });
});

describe('package parts', () => {
  const m = { top: 150, right: 72, bottom: 72, left: 72 };

  it('rewrites the section margins to the letterhead\'s', () => {
    const sectPr = '<w:sectPr><w:pgSz w:w="11906" w:h="16837"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>';
    const out = applyMargins(sectPr, m);
    expect(out).toContain('w:top="3000"');
    expect(out.match(/<w:pgMar/g)).toHaveLength(1);
    expect(applyMargins('<w:sectPr><w:pgSz w:w="1" w:h="1"/></w:sectPr>', m)).toContain('<w:pgMar');
  });

  it('numbers image relationships from rId1', () => {
    const rels = imageRelationships(['media/firm-wordmark.png', 'media/firm-monogram.png']);
    expect(rels).toContain('Id="rId1"');
    expect(rels).toContain('Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/firm-monogram.png"');
  });

  it('declares the image type only when missing', () => {
    const types = '<Types xmlns="x"><Default Extension="xml" ContentType="application/xml"/></Types>';
    const png = ensureImageContentType(types, 'png');
    expect(png).toContain('<Default Extension="png" ContentType="image/png"/>');
    expect(ensureImageContentType(png, 'png')).toBe(png);
  });

  it('sets every style in the firm\'s face, dropping theme font references', () => {
    const styles = '<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:asciiTheme="minorHAnsi"/><w:rFonts w:cs="Arial"/>';
    expect(applyStyleFont(styles, 'Garamond')).toBe('<w:rFonts w:ascii="Garamond" w:hAnsi="Garamond"/><w:rFonts w:cs="Garamond"/>');
  });

  it('signs with the firm name, escaped', async () => {
    const out = signOff(await part('word/document.xml'), 'Reyes & Santos');
    expect(out).toContain('Reyes &amp; Santos');
    expect(out).not.toContain(SIGN_OFF_MARKER);
  });
});

describe('byLetterhead', () => {
  const m = (name: string, position: string, start_date: string | null = null) => ({ name, position, start_date });

  it('lists people in the letterhead order, then those it does not print', () => {
    const people = [
      m('Uma Underbar', 'Underbar Associate'),
      m('Oscar Counsel', 'Of Counsel'),
      m('Jill Junior', 'Junior Associate', '2024-06-01'),
      m('Sam Senior', 'Senior Associate'),
      m('Mara Managing', 'Managing Partner'),
      m('Pat Partner', 'Partner'),
      m('Fay Founder', 'Founding Partner', '2010-01-01'),
      m('Finn Founder', 'Founding Partner', '2012-01-01'),
      m('Jack Junior', 'Junior Associate', '2022-06-01'),
      m('Ada Admin', 'Office Administrator'),
    ];
    expect([...people].sort(byLetterhead).map((p) => p.name)).toEqual([
      'Fay Founder',
      'Finn Founder',
      'Mara Managing',
      'Pat Partner',
      'Sam Senior',
      'Jack Junior',
      'Jill Junior',
      'Oscar Counsel',
      'Uma Underbar',
      'Ada Admin',
    ]);
  });
});
