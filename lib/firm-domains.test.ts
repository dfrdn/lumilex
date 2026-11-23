import { describe, it, expect } from 'vitest';
import { isFirmAddress } from './firm-domains';

const OWNED = ['example.law', 'legacy-example.com'];

describe('isFirmAddress', () => {
  it('recognises every domain the firm owns', () => {
    expect(isFirmAddress('lawyer@example.law', OWNED)).toBe(true);
    expect(isFirmAddress('lawyer@legacy-example.com', OWNED)).toBe(true);
  });

  it('is case-insensitive and trims surrounding whitespace', () => {
    expect(isFirmAddress('  Lawyer@Example.Law  ', OWNED)).toBe(true);
  });

  it('tolerates a configured domain written with a leading @ or stray case', () => {
    expect(isFirmAddress('lawyer@example.law', ['  @Example.LAW '])).toBe(true);
  });

  it('rejects outside addresses', () => {
    expect(isFirmAddress('client@gmail.com', OWNED)).toBe(false);
  });

  it('does not treat a subdomain as the firm domain', () => {
    expect(isFirmAddress('x@mail.example.law', OWNED)).toBe(false);
  });

  it('requires the @ — a bare domain string is not a firm address', () => {
    expect(isFirmAddress('example.law', OWNED)).toBe(false);
  });

  it('handles null/undefined/empty', () => {
    expect(isFirmAddress(null, OWNED)).toBe(false);
    expect(isFirmAddress(undefined, OWNED)).toBe(false);
    expect(isFirmAddress('', OWNED)).toBe(false);
  });

  it('claims nothing when the firm has configured no domains', () => {
    expect(isFirmAddress('lawyer@example.law', [])).toBe(false);
  });

  it('ignores blank entries rather than matching every address', () => {
    expect(isFirmAddress('client@gmail.com', ['', '   '])).toBe(false);
  });

  it('never matches one firm against another firm’s domains', () => {
    expect(isFirmAddress('lawyer@example.law', ['other-firm.law'])).toBe(false);
  });
});
