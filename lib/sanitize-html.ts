/**
 * Allow-list HTML sanitizer shared by every surface that stores rich text a
 * person typed and renders it back with `dangerouslySetInnerHTML`.
 *
 * The editors (TipTap) constrain their own output, but the APIs accept a raw
 * HTML string, so a hand-crafted POST can carry anything. This pass strips
 * scripts, iframes and other embedding tags with their contents, drops every
 * tag and attribute its policy does not name, removes inline event handlers,
 * and keeps only URLs with a safe scheme — leaving the editor's formatting
 * intact.
 *
 * Attribute values are entity-decoded before they are checked and escaped
 * once on the way out. Checking the raw value let `javascript&#58;` through
 * (the browser decodes it before following the link), and escaping without
 * decoding added a layer of `&amp;` to every link with a query string on
 * each save.
 *
 * Deliberately regex-based and dependency-free: the surface is small and the
 * editor controls the happy path. Sanitize on write, and again on render for
 * rows written before the write path did.
 */

export interface SanitizePolicy {
  tags: ReadonlySet<string>;
  /**
   * Per tag, the attributes kept. A validator returns the value to emit, or
   * null to drop the attribute.
   */
  attrs: Readonly<Record<string, Readonly<Record<string, AttrValidator>>>>;
}

export type AttrValidator = (value: string) => string | null;

const EMBEDDING_TAGS = 'script|style|iframe|object|embed|link|meta|base|frame|frameset|noscript|template|svg|math';

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  colon: ':', tab: '\t', newline: '\n', sol: '/', lpar: '(', rpar: ')',
};

export function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);?/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    }
    const named = NAMED_ENTITIES[body.toLowerCase()];
    return named ?? whole;
  });
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * A URL is kept when it is relative or uses http(s), mailto or tel. Control
 * characters and whitespace are removed before the scheme is read, as a
 * browser does — `java\tscript:` is still javascript.
 */
export const safeUrl: AttrValidator = (value) => {
  const compact = value.replace(/[\u0000- \u007f-\u009f]/g, '');
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(compact);
  if (!scheme) return value.trim();
  return ['http', 'https', 'mailto', 'tel'].includes(scheme[1].toLowerCase()) ? value.trim() : null;
};

export const anyValue: AttrValidator = (value) => value;

export function oneOf(...allowed: string[]): AttrValidator {
  const set = new Set(allowed.map((a) => a.toLowerCase()));
  return (value) => (set.has(value.trim().toLowerCase()) ? value.trim().toLowerCase() : null);
}

export const smallInteger: AttrValidator = (value) => (/^\d{1,3}$/.test(value.trim()) ? value.trim() : null);

/** `style` reduced to a text alignment — the one inline style the editors emit. */
export const textAlignOnly: AttrValidator = (value) => {
  const m = /(?:^|;)\s*text-align\s*:\s*(left|center|right|justify)\s*(?:;|$)/i.exec(value);
  return m ? `text-align: ${m[1].toLowerCase()}` : null;
};

export function sanitizeHtml(input: string, policy: SanitizePolicy): string {
  let html = String(input ?? '');

  // Embedding tags go with their contents, then any stray opener or closer.
  html = html.replace(new RegExp(`<\\s*(${EMBEDDING_TAGS})\\b[^>]*>[\\s\\S]*?<\\s*\\/\\s*\\1\\s*>`, 'gi'), '');
  html = html.replace(new RegExp(`<\\s*\\/?\\s*(${EMBEDDING_TAGS})\\b[^>]*>`, 'gi'), '');

  // Walk tags: drop disallowed ones (keeping their text) and scrub the
  // attributes of the survivors.
  return html.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)([^>]*)>/g, (full, rawTag: string, rawAttrs: string) => {
    const tag = rawTag.toLowerCase();
    if (!policy.tags.has(tag)) return '';
    if (full.startsWith('</')) return `</${tag}>`;

    const allowed = policy.attrs[tag] ?? {};
    const selfClosing = /\/\s*$/.test(rawAttrs);

    // name="value" | name='value' | name=value | name
    const attrRegex = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))|([a-zA-Z_:][-a-zA-Z0-9_:.]*)/g;
    const kept: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = attrRegex.exec(rawAttrs)) !== null) {
      const name = (m[1] ?? m[5] ?? '').toLowerCase();
      if (!name || name.startsWith('on')) continue;
      const validate = Object.prototype.hasOwnProperty.call(allowed, name) ? allowed[name] : undefined;
      if (!validate) continue;
      const value = validate(decodeEntities(m[2] ?? m[3] ?? m[4] ?? ''));
      if (value == null) continue;
      kept.push(`${name}="${escapeAttr(value)}"`);
    }

    // A link that opens a new tab never hands the opener to the destination.
    if (tag === 'a' && kept.includes('target="_blank"')) {
      const i = kept.findIndex((a) => a.startsWith('rel='));
      if (i >= 0) kept.splice(i, 1);
      kept.push('rel="noopener noreferrer"');
    }

    return `<${tag}${kept.length ? ' ' + kept.join(' ') : ''}${selfClosing ? ' /' : ''}>`;
  });
}

const HEADING_ATTRS = { style: textAlignOnly };

/**
 * Library handbook pages: what the rich-text editor emits (headings, lists,
 * tables, links, highlights, alignment) and what the Rules of Court import
 * writes. No images, no classes but the import's lead paragraph, no inline
 * style but alignment.
 */
export const HANDBOOK_POLICY: SanitizePolicy = {
  tags: new Set([
    'p', 'br', 'hr', 'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'del', 'mark', 'sub', 'sup', 'span',
    'code', 'pre', 'blockquote', 'ul', 'ol', 'li',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'a',
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption',
  ]),
  attrs: {
    a: { href: safeUrl, title: anyValue, target: oneOf('_blank'), rel: anyValue },
    p: { style: textAlignOnly, class: oneOf('lead') },
    h1: HEADING_ATTRS, h2: HEADING_ATTRS, h3: HEADING_ATTRS, h4: HEADING_ATTRS, h5: HEADING_ATTRS, h6: HEADING_ATTRS,
    ol: { start: smallInteger },
    th: { colspan: smallInteger, rowspan: smallInteger },
    td: { colspan: smallInteger, rowspan: smallInteger },
  },
};

export function sanitizeHandbookHtml(input: string): string {
  return sanitizeHtml(input, HANDBOOK_POLICY);
}
