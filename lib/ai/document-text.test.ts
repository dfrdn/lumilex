import { describe, it, expect } from 'vitest';
import { pickAttachment } from './document-text';

describe('pickAttachment', () => {
  const urls = [
    { name: 'Order dated 1 Sept.pdf', url: '', path: 'temp/Order_dated_1_Sept.pdf' },
    { name: 'Annex A.pdf', url: 'https://x/annex-a.pdf', path: 'temp/Annex_A.pdf' },
  ];

  it('matches the attachment by exact name', () => {
    expect(pickAttachment(urls, 'Annex A.pdf')?.path).toBe('temp/Annex_A.pdf');
  });

  it('falls back to a case-insensitive basename match on name or path', () => {
    expect(pickAttachment(urls, 'annex a.pdf')?.path).toBe('temp/Annex_A.pdf');
    expect(pickAttachment(urls, 'Order_dated_1_Sept.pdf')?.name).toBe('Order dated 1 Sept.pdf');
  });

  it('returns the only attachment when the name does not match', () => {
    expect(pickAttachment([urls[0]], 'something else.pdf')?.name).toBe('Order dated 1 Sept.pdf');
  });

  it('returns null when ambiguous or malformed', () => {
    expect(pickAttachment(urls, 'something else.pdf')).toBeNull();
    expect(pickAttachment(null, 'x.pdf')).toBeNull();
    expect(pickAttachment('[]', 'x.pdf')).toBeNull();
    expect(pickAttachment([], 'x.pdf')).toBeNull();
    expect(pickAttachment([null, 3], 'x.pdf')).toBeNull();
  });
});
