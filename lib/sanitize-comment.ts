import { anyValue, safeUrl, sanitizeHtml, type SanitizePolicy } from '@/lib/sanitize-html';

/**
 * Minimal allow-list sanitizer for rich-text comment HTML.
 *
 * Defense-in-depth: TipTap's schema already constrains the editor's output
 * to a known set of nodes/marks, but the API accepts a raw HTML string,
 * so a hand-crafted POST could carry whatever the client wants. This pass
 * strips scripts, iframes, inline event handlers, javascript:/data: URLs,
 * and any attribute not on the allow-list — leaving the editor's normal
 * formatting (bold/italic/lists/links/mentions) intact. The mechanics live
 * in lib/sanitize-html.ts; this file is the comment policy.
 */

const COMMENT_POLICY: SanitizePolicy = {
  tags: new Set([
    'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'strike',
    'ul', 'ol', 'li', 'blockquote', 'code', 'pre',
    'a', 'span',
  ]),
  attrs: {
    a: { href: safeUrl, title: anyValue, target: anyValue, rel: anyValue },
    // TipTap's mention extension emits data-id / data-label / contenteditable
    // on the mention span; legacy spans use data-mention-id. Keep both so old
    // and new comments round-trip cleanly through the editor.
    span: {
      class: anyValue,
      'data-type': anyValue,
      'data-id': anyValue,
      'data-label': anyValue,
      'data-mention-id': anyValue,
      'data-mention-suggestion-char': anyValue,
      contenteditable: anyValue,
    },
  },
};

export function sanitizeCommentHtml(input: string): string {
  return sanitizeHtml(input, COMMENT_POLICY);
}
