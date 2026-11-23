// The firm's branded email chrome (header, body, footer), kept free of server
// imports so a page can render an email exactly as it will be sent.
import { sanitizeHtml, safeUrl, type SanitizePolicy } from '@/lib/sanitize-html';

/** The firm's mark and name for an email header; lib/email.ts loads it per firm. */
export interface EmailBrand {
  /** Display name for the header wordmark and footer. Blank renders neither. */
  firmName: string;
  /** Absolute URL of the firm's reversed-out mark, or null for a text wordmark. */
  logoUrl: string | null;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * The firm's mark on the dark header bar, or its name set as a text wordmark
 * when no mark is configured. Never a packaged stand-in: an email header is the
 * one place a wrong logo is both permanent and forwarded.
 */
function headerLockup(brand: EmailBrand): string {
  if (brand.logoUrl) {
    return `<img src="${brand.logoUrl}" alt="${escapeHtml(brand.firmName)}" height="32" style="display:block;height:32px;width:auto;border:0" />`;
  }
  if (brand.firmName) {
    return `<span style="display:block;font-size:17px;font-weight:700;letter-spacing:0.06em;color:#ffffff">${escapeHtml(brand.firmName)}</span>`;
  }
  return '';
}

/**
 * `audience: 'client'` swaps the footer: a client has no Settings page to
 * manage notification preferences in.
 */
export function wrapBrandedEmail({ inner, brand, audience = 'team' }: { inner: string; brand: EmailBrand; audience?: 'team' | 'client' }): string {
  const name = brand.firmName ? escapeHtml(brand.firmName) : '';
  const footer = audience === 'client'
    ? name
    : `${name ? `${name} &middot; ` : ''}You can manage your notification preferences in Settings.`;
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <div style="max-width:600px;margin:0 auto;background:#f9fafb">
    <!-- Branded header -->
    <div style="background:#1e293b;padding:24px 32px;text-align:left">
      ${headerLockup(brand)}
    </div>

    <!-- Body -->
    <div style="padding:32px">
${inner}
    </div>

    <!-- Footer -->
    <div style="padding:20px 32px 28px 32px;text-align:center;border-top:1px solid #e5e7eb">
      <p style="font-size:11px;color:#9ca3af;margin:0">${footer}</p>
    </div>
  </div>
</body>
</html>`;
}

/** What the letter editor emits, and all an email paragraph may carry. */
const LETTER_EMAIL_POLICY: SanitizePolicy = {
  tags: new Set(['p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'ul', 'ol', 'li', 'a']),
  attrs: { a: { href: safeUrl } },
};

const TEXT = 'font-size:14px;color:#374151;line-height:1.6';
const LIST = `${TEXT};margin:0 0 14px 0;padding-left:22px`;

/**
 * Editor HTML with the inline styles email clients need. It is sanitized
 * first, whatever the caller says it is: it carries what a person typed.
 * Empty paragraphs (a blank line in the editor) are dropped, since every
 * paragraph already has its own spacing.
 */
export function styleLetterHtml(body: string): string {
  return sanitizeHtml(body, LETTER_EMAIL_POLICY).trim()
    .replace(/<li>\s*<p>([\s\S]*?)<\/p>\s*<\/li>/g, '<li>$1</li>')
    .replace(/<p>(\s|&nbsp;|<br\s*\/?>)*<\/p>/g, '')
    .replace(/<p>/g, `<p style="${TEXT};margin:0 0 14px 0">`)
    .replace(/<(ul|ol)>/g, `<$1 style="${LIST}">`)
    .replace(/<li>/g, '<li style="margin:0 0 4px 0">')
    .replace(/<a href="([^"]*)">/g, '<a href="$1" style="color:#1e293b;text-decoration:underline">');
}
