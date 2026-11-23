/**
 * Firm wording the app lets people edit — the billing letter, the trademark
 * reports — is stored in the drafting body markup the DOCX builder reads
 * (**bold**, *italic*, __underline__, a blank line between paragraphs, a line
 * starting "- " for a numbered item). The shared letter editor
 * (components/LetterEditor.tsx) works in HTML. These convert between the two
 * at the editor's edge, so storage and generation never see HTML.
 */

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

const marks = (text: string) =>
  escapeHtml(text)
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/__(.+?)__/g, '<u>$1</u>')
    .replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');

const isItem = (line: string) => line.trim().startsWith('- ');

/** Stored wording to editor HTML. A paragraph's "- " lines become a numbered list after its text. */
export function markupToHtml(markup: string): string {
  return markup
    .split(/\n\s*\n/)
    .map((para) => {
      const lines = para.split('\n');
      const text = lines.filter((l) => !isItem(l)).join(' ').replace(/\s+/g, ' ').trim();
      const items = lines.filter(isItem).map((l) => l.trim().slice(2).trim());
      return (text ? `<p>${marks(text)}</p>` : '') +
        (items.length ? `<ol>${items.map((i) => `<li><p>${marks(i)}</p></li>`).join('')}</ol>` : '');
    })
    .filter(Boolean)
    .join('');
}

/** Editor HTML (placeholders already back to tokens) to stored wording. */
export function htmlToMarkup(html: string): string {
  const text = html
    // A list is its own paragraph of "- " lines.
    .replace(/<(ol|ul)[^>]*>([\s\S]*?)<\/\1>/gi, (_, _tag: string, inner: string) =>
      `<p>${[...inner.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)].map((m) => `- ${m[1].replace(/<\/?p[^>]*>/gi, ' ').trim()}`).join('\n')}</p>`)
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/p>\s*<p[^>]*>/gi, '\n\n')
    .replace(/<\/?p[^>]*>/gi, '')
    .replace(/<(strong|b)(\s[^>]*)?>/gi, '**')
    .replace(/<\/(strong|b)>/gi, '**')
    .replace(/<(em|i)(\s[^>]*)?>/gi, '*')
    .replace(/<\/(em|i)>/gi, '*')
    .replace(/<u(\s[^>]*)?>/gi, '__')
    .replace(/<\/u>/gi, '__')
    .replace(/<[^>]+>/g, '');
  return decodeEntities(text)
    // Bold that closes and reopens across a chip or a space reads as one run.
    .replace(/\*\*(\s*)\*\*/g, '$1')
    .split('\n\n')
    .map((p) => p.split('\n').map((l) => l.replace(/[ \t]+/g, ' ').trim()).join('\n').trim())
    .filter(Boolean)
    .join('\n\n');
}
