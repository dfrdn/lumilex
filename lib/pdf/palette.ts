/**
 * The document palette, derived from the two colours a firm actually configures.
 *
 * `firms.branding.palette` carries a primary and an accent; every other ink the
 * renderers ask for (the deep panel, the section band, the paper tints, the
 * hairlines) is computed from those two so a tenant supplies two hex values and
 * gets a coherent set. The neutral inks are fixed — black text is not brand
 * identity, and letting a tenant tint body copy only produces unreadable pages.
 *
 * Role names, not colour names: a renderer asks for `primary`, never `navy`.
 * The original single-firm kit named these after one firm's colours, which meant
 * a tenant with a burgundy mark had code filling shapes with `C.navy`.
 */

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Parse `#abc` / `#aabbcc` (with or without the hash). Throws on anything else. */
export function parseHex(value: string, field: string): Rgb {
  const m = HEX.exec(value.trim());
  if (!m) throw new Error(`${field} must be a hex colour like #1f3a5f, got ${JSON.stringify(value)}`);
  const h = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

function toHex({ r, g, b }: Rgb): string {
  const c = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return { r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t };
}

const BLACK: Rgb = { r: 0, g: 0, b: 0 };
const WHITE: Rgb = { r: 255, g: 255, b: 255 };

/** Darker by `t` (0–1). */
const shade = (c: Rgb, t: number) => toHex(mix(c, BLACK, t));
/** Lighter by `t` (0–1); at t→1 it reaches paper white. */
const tint = (c: Rgb, t: number) => toHex(mix(c, WHITE, t));

/**
 * Relative luminance (WCAG). Used to decide whether a configured colour is dark
 * enough to carry reversed-out white type.
 */
export function luminance(hex: string): number {
  const { r, g, b } = parseHex(hex, 'colour');
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export interface Palette {
  /** The firm's primary — cover panel, table headers, headings. */
  primary: string;
  /** Darkest step; used where the primary would read as washed out over cream. */
  primaryDeep: string;
  /** One step down from `primary`, for stacked panels. */
  primaryStrong: string;
  /** Mid steps, for rules and secondary panels. */
  primaryMid: string;
  primarySoft: string;
  primaryFaint: string;
  /** Brighter than `primary` — the deco bar accent on the cover. */
  primaryBar: string;

  /** The firm's accent — section bands, keylines, figures. */
  accent: string;
  /** Deeper accent, for accent-coloured type on a light ground. */
  accentDeep: string;
  /** Lighter accent, for sublabels reversed out of the primary. */
  accentSoft: string;
  /** Hairline weight of the accent — keylines and rules. */
  accentLine: string;
  /** Very pale accent wash, for zebra fills. */
  accentPale: string;

  /** Paper tints, warmed by the accent so the page reads as stock, not screen. */
  surface: string;
  surfacePage: string;
  surfaceDeep: string;

  /** Rules and table gridlines. */
  hairline: string;
  border: string;

  /** Fixed neutral inks — never brand-tinted. */
  ink: string;
  inkSoft: string;
  inkMuted: string;
  white: string;
}

/**
 * Build the full palette from the two configured colours.
 *
 * The paper tints are the accent mixed far into white rather than a fixed cream:
 * a firm with a cool grey accent gets cool paper, a firm with a gold accent gets
 * the warm stock the design was drawn for, and neither inherits the other's.
 */
export function derivePalette(primaryHex: string, accentHex: string): Palette {
  const primary = parseHex(primaryHex, 'branding.palette.primary');
  const accent = parseHex(accentHex, 'branding.palette.accent');

  return {
    primary: toHex(primary),
    primaryDeep: shade(primary, 0.45),
    primaryStrong: shade(primary, 0.2),
    primaryMid: tint(primary, 0.18),
    primarySoft: tint(primary, 0.34),
    primaryFaint: tint(primary, 0.5),
    primaryBar: tint(primary, 0.24),

    accent: toHex(accent),
    accentDeep: shade(accent, 0.18),
    accentSoft: tint(accent, 0.18),
    accentLine: tint(accent, 0.18),
    accentPale: tint(accent, 0.82),

    surface: tint(accent, 0.92),
    surfacePage: tint(accent, 0.955),
    surfaceDeep: tint(accent, 0.85),

    hairline: tint(accent, 0.62),
    border: tint(accent, 0.7),

    ink: '#1c1c1c',
    inkSoft: '#3a3a3a',
    inkMuted: '#6c6c6c',
    white: '#ffffff',
  };
}
