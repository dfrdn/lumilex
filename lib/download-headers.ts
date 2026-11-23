/**
 * Build a `Content-Disposition` value that preserves filenames containing
 * spaces, brackets, accents, or other non-token characters.
 *
 * Why both `filename=` and `filename*=`:
 * - `filename="..."` is the legacy form. Per RFC 6266 + RFC 7230 quoted-string,
 *   any printable ASCII except `"` and `\` is allowed, but older clients
 *   sometimes choke on non-ASCII. We strip down to printable ASCII here as a
 *   safe fallback for those clients.
 * - `filename*=UTF-8''...` (RFC 5987) is the modern form every current browser
 *   prefers. It carries the full UTF-8 filename percent-encoded with the
 *   stricter attr-char set, so brackets/parens/accents round-trip cleanly.
 */
function rfc5987Encode(s: string): string {
  return encodeURIComponent(s)
    // encodeURIComponent leaves !'()* alone, but RFC 5987 attr-char excludes
    // them — escape to keep strict parsers happy.
    .replace(/['()*!]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

function buildDisposition(type: 'attachment' | 'inline', filename: string): string {
  const safe = filename.trim() || 'file';
  // ASCII fallback: strip control chars, the two characters that need escaping
  // inside a quoted-string, and anything outside printable ASCII.
  const ascii = safe.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
  const encoded = rfc5987Encode(safe);
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

export function attachmentDisposition(filename: string): string {
  return buildDisposition('attachment', filename);
}

export function inlineDisposition(filename: string): string {
  return buildDisposition('inline', filename);
}
