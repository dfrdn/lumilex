/**
 * The curated typeface sets a firm may choose between.
 *
 * v1 branding picks a set by name (`firms.branding.fontSet`); arbitrary font
 * upload is deliberately out of scope, because every face this product ships has
 * to be one we are licensed to redistribute to every tenant.
 *
 * Two kinds of face are supported:
 *
 *   - `core`  — one of the 14 standard PDF fonts. Nothing is embedded and
 *               nothing ships; every PDF reader already has them.
 *   - `file`  — a font file bundled under `public/fonts/<dir>/`. A bundled set
 *               MUST carry its licence beside it as `public/fonts/<dir>/LICENSE`
 *               and that licence must permit redistribution (OFL, Apache-2.0,
 *               Ubuntu Font Licence, …). `registerFonts` refuses to render a set
 *               whose files or licence are missing rather than quietly falling
 *               back to another set — a document in the wrong typeface is a
 *               brand failure that nobody notices until it is in a client's inbox.
 *
 * Adding a set: drop the files and their LICENSE into `public/fonts/<dir>/`, add
 * an entry to `FONT_SETS`, and pin `./public/fonts/**` in next.config's
 * `outputFileTracingIncludes` (already pinned for the document routes).
 *
 * One bundled face per file, never a variable font with several named instances:
 * pdfkit dedupes embedded fonts on the name records and `head.checkSumAdjustment`,
 * which every instance of one variable file shares, so a bold alias registered
 * off the same file as the regular one silently renders in the regular weight.
 */

import fs from 'fs';
import path from 'path';

/**
 * Aliases the renderers ask for. These are stable names registered into each
 * pdfkit document; which physical face they resolve to is the set's business.
 */
export const FONT = {
  /** Title-case display and numerals — cover titles, big figures. */
  disp: 'Disp',
  /** Engraved caps display — wordmark, section headers, letterspaced labels. */
  dispSb: 'DispSb',
  /** Heavy display, for the largest numerals. */
  dispB: 'DispB',
  /** Body text. */
  body: 'Body',
  bodyB: 'BodyB',
  bodySb: 'BodySb',
  bodyIt: 'BodyIt',
  bodyBIt: 'BodyBIt',
} as const;

/**
 * Every set must resolve every alias — `faces` is a total map, so adding one
 * here is a compile error until each set says what it resolves to.
 */

export type FontAlias = (typeof FONT)[keyof typeof FONT];

type Face =
  | { kind: 'core'; name: string }
  | { kind: 'file'; file: string };

export interface FontSet {
  name: string;
  /** Shown in the admin branding picker. */
  label: string;
  /** Subdirectory under public/fonts holding the files + LICENSE. Core-only sets have none. */
  dir: string | null;
  faces: Record<FontAlias, Face>;
  /** Nearest equivalent family name for the DOCX renderers, which name fonts by string. */
  docxFamily: string;
  /**
   * Whether *every* resolved face carries ₱ (U+20B1) — an amount can be set in
   * any of them. The core PDF fonts are WinAnsi-encoded and do not, so the peso
   * amount is prefixed "P" instead of printing a notdef box; the bundled
   * Garamond faces all do, checked glyph by glyph rather than assumed. This is a
   * property of the typeface, not a house rule.
   */
  hasPesoGlyph: boolean;
}

const core = (name: string): Face => ({ kind: 'core', name });
const bundled = (file: string): Face => ({ kind: 'file', file });

/**
 * The default: Cormorant for display, EB Garamond for text — two open-licensed
 * Garamond revivals bundled under `public/fonts/garamond/`.
 *
 * Cormorant is the *display* cut of its family (the reason to prefer it over
 * Cormorant Garamond, which is the text-optimised variant of the same design and
 * would compete with EB Garamond rather than complement it): high contrast and
 * fine hairlines that hold up at the 26–82pt the cover lockups, section headers
 * and stat figures are set at. EB Garamond is a text face and carries everything
 * from 8.5pt running heads to justified body copy.
 *
 * Both are SIL Open Font License 1.1, redistributable to every tenant, and both
 * carry ₱ — see `hasPesoGlyph` below.
 */
const STANDARD: FontSet = {
  name: 'standard',
  label: 'Standard (Cormorant display · EB Garamond body)',
  dir: 'garamond',
  faces: {
    [FONT.disp]: bundled('Cormorant-Regular.ttf'),
    [FONT.dispSb]: bundled('Cormorant-SemiBold.ttf'),
    [FONT.dispB]: bundled('Cormorant-Bold.ttf'),
    [FONT.body]: bundled('EBGaramond-Regular.ttf'),
    [FONT.bodyB]: bundled('EBGaramond-Bold.ttf'),
    // No separate semibold is bundled: no renderer asks for this alias yet, and
    // a fifth 500 KB EB Garamond face in every serverless function buys nothing
    // until one does. The core sets resolve it to their bold too.
    [FONT.bodySb]: bundled('EBGaramond-Bold.ttf'),
    [FONT.bodyIt]: bundled('EBGaramond-Italic.ttf'),
    [FONT.bodyBIt]: bundled('EBGaramond-BoldItalic.ttf'),
  },
  // Word names families by string and cannot embed from here. "Garamond" ships
  // with Microsoft Office, so a Word document lands on the nearest face the
  // reader actually has rather than on an EB Garamond nobody has installed.
  docxFamily: 'Garamond',
  hasPesoGlyph: true,
};

/**
 * Standard PDF fonts only — Helvetica display over a Times body. Embeds nothing
 * and ships nothing: every reader already has these 14 faces. This is the set
 * for a firm that wants zero embedded font data in documents it sends out, and
 * the one to fall back to if a bundled face ever has to be pulled.
 */
const CORE: FontSet = {
  name: 'core',
  label: 'Core PDF fonts (Helvetica display · Times body — nothing embedded)',
  dir: null,
  faces: {
    [FONT.disp]: core('Helvetica'),
    [FONT.dispSb]: core('Helvetica-Bold'),
    [FONT.dispB]: core('Helvetica-Bold'),
    [FONT.body]: core('Times-Roman'),
    [FONT.bodyB]: core('Times-Bold'),
    [FONT.bodySb]: core('Times-Bold'),
    [FONT.bodyIt]: core('Times-Italic'),
    [FONT.bodyBIt]: core('Times-BoldItalic'),
  },
  docxFamily: 'Times New Roman',
  hasPesoGlyph: false,
};

/** All-serif alternative: Times throughout, for firms that want no sans at all. */
const SERIF: FontSet = {
  name: 'serif',
  label: 'Serif (Times throughout)',
  dir: null,
  faces: {
    [FONT.disp]: core('Times-Roman'),
    [FONT.dispSb]: core('Times-Bold'),
    [FONT.dispB]: core('Times-Bold'),
    [FONT.body]: core('Times-Roman'),
    [FONT.bodyB]: core('Times-Bold'),
    [FONT.bodySb]: core('Times-Bold'),
    [FONT.bodyIt]: core('Times-Italic'),
    [FONT.bodyBIt]: core('Times-BoldItalic'),
  },
  docxFamily: 'Times New Roman',
  hasPesoGlyph: false,
};

/** All-sans alternative, for a firm with a modern mark. */
const SANS: FontSet = {
  name: 'sans',
  label: 'Sans (Helvetica throughout)',
  dir: null,
  faces: {
    [FONT.disp]: core('Helvetica'),
    [FONT.dispSb]: core('Helvetica-Bold'),
    [FONT.dispB]: core('Helvetica-Bold'),
    [FONT.body]: core('Helvetica'),
    [FONT.bodyB]: core('Helvetica-Bold'),
    [FONT.bodySb]: core('Helvetica-Bold'),
    [FONT.bodyIt]: core('Helvetica-Oblique'),
    [FONT.bodyBIt]: core('Helvetica-BoldOblique'),
  },
  docxFamily: 'Arial',
  hasPesoGlyph: false,
};

export const FONT_SETS: Record<string, FontSet> = {
  [STANDARD.name]: STANDARD,
  [CORE.name]: CORE,
  [SERIF.name]: SERIF,
  [SANS.name]: SANS,
};

export const DEFAULT_FONT_SET = STANDARD.name;

/** Resolve a configured set name. Throws on an unknown name — never substitutes. */
export function resolveFontSet(name: string): FontSet {
  const set = FONT_SETS[name || DEFAULT_FONT_SET];
  if (!set) {
    throw new Error(
      `Unknown branding.fontSet ${JSON.stringify(name)}. Available: ${Object.keys(FONT_SETS).join(', ')}.`,
    );
  }
  return set;
}

/** The currency prefix the set can actually print. */
export function pesoSymbol(set: FontSet): string {
  return set.hasPesoGlyph ? '₱' : 'P';
}

const fontDir = (dir: string) => path.join(process.cwd(), 'public', 'fonts', dir);

/**
 * Register a set's faces under the stable aliases. A bundled set whose files or
 * LICENSE are missing throws: rendering it in a substitute face would ship a
 * document that silently isn't the firm's.
 */
export function registerFonts(doc: PDFKit.PDFDocument, set: FontSet) {
  if (set.dir) {
    const base = fontDir(set.dir);
    if (!fs.existsSync(path.join(base, 'LICENSE'))) {
      throw new Error(
        `Font set "${set.name}" is missing public/fonts/${set.dir}/LICENSE. `
        + 'A bundled face must ship the licence that permits redistributing it.',
      );
    }
  }
  for (const [alias, face] of Object.entries(set.faces) as [FontAlias, Face][]) {
    if (face.kind === 'core') {
      doc.registerFont(alias, face.name);
      continue;
    }
    const file = path.join(fontDir(set.dir ?? ''), face.file);
    if (!fs.existsSync(file)) {
      throw new Error(`Font set "${set.name}" is missing ${file}.`);
    }
    doc.registerFont(alias, file);
  }
}
