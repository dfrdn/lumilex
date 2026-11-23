import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import PDFKitDocument from 'pdfkit';
import { FONT, FONT_SETS, registerFonts, resolveFontSet, pesoSymbol, type FontAlias } from './fonts';

const PESO = 0x20b1;

/**
 * pdfkit opens a registered face lazily, on the first `doc.font(alias)`. The
 * opened font is the fontkit object it will embed — the only place to ask what
 * the file actually contains without taking a direct dependency on fontkit,
 * which is pdfkit's own and not ours to import.
 */
interface OpenedFont {
  postscriptName: string;
  /** Present only on a variable font — a static instance has no fvar table. */
  fvar?: unknown;
  hasGlyphForCodePoint(codePoint: number): boolean;
}

function open(alias: FontAlias, setName: string): OpenedFont {
  const doc = new PDFKitDocument({ autoFirstPage: false });
  registerFonts(doc, resolveFontSet(setName));
  doc.font(alias);
  return (doc as unknown as { _font: { font: OpenedFont } })._font.font;
}

const aliases = Object.values(FONT) as FontAlias[];
const sets = Object.values(FONT_SETS);
const bundled = sets.filter((s) => s.dir);

describe('font sets', () => {
  it.each(sets.map((s) => [s.name, s] as const))('%s resolves every alias a renderer can ask for', (_name, set) => {
    for (const alias of aliases) expect(set.faces[alias]).toBeDefined();
  });

  it('defaults to the bundled Garamond set', () => {
    // firms.branding.fontSet defaults to 'standard' in the branding schema, so
    // this is the set a firm gets without choosing one.
    expect(resolveFontSet('standard').dir).toBe('garamond');
    expect(resolveFontSet('').name).toBe('standard');
  });

  it('keeps a set that embeds nothing available', () => {
    expect(resolveFontSet('core').dir).toBeNull();
    for (const alias of aliases) expect(resolveFontSet('core').faces[alias].kind).toBe('core');
  });
});

describe.each(bundled.map((s) => [s.name, s] as const))('bundled set %s', (_name, set) => {
  const dir = path.join(process.cwd(), 'public', 'fonts', set.dir as string);

  it('ships the licence that permits redistributing its faces', () => {
    // registerFonts refuses the set without this, so a missing licence is an
    // outage rather than an unlicensed document. Keep it that way.
    expect(fs.existsSync(path.join(dir, 'LICENSE'))).toBe(true);
  });

  it('ships every face it declares', () => {
    for (const alias of aliases) {
      const face = set.faces[alias];
      if (face.kind !== 'file') continue;
      expect(fs.existsSync(path.join(dir, face.file)), `${alias} → ${face.file}`).toBe(true);
    }
  });

  it('registers each face as its own static font, with no weight collapsed into another', () => {
    // pdfkit dedupes embedded fonts on their name records, so faces cut from
    // one variable file — which share a name table — would silently render as a
    // single weight. Every bundled file must be a static instance, and two
    // different files must not be the same face under different names.
    const byFile = new Map<string, string>();
    for (const alias of aliases) {
      const face = set.faces[alias];
      if (face.kind !== 'file') continue;
      const font = open(alias, set.name);
      expect(font.fvar, `${face.file} is a variable font`).toBeUndefined();
      byFile.set(face.file, font.postscriptName);
    }
    expect(new Set(byFile.values()).size).toBe(byFile.size);
  });

  it(`declares hasPesoGlyph truthfully (₱ is ${set.hasPesoGlyph})`, () => {
    // An amount can be set in any face of the set: peso() may only print ₱ if
    // every one of them carries it, or a fee schedule gets a notdef box.
    const carries = aliases.every((alias) => open(alias, set.name).hasGlyphForCodePoint(PESO));
    expect(carries).toBe(set.hasPesoGlyph);
    expect(pesoSymbol(set)).toBe(carries ? '₱' : 'P');
  });
});
