import { describe, it, expect } from 'vitest';
import { failureMessage } from './api-error';

function jsonResponse(body: unknown, status = 500): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('failureMessage', () => {
  it('returns the API error message when present', async () => {
    const res = jsonResponse({ error: 'Forbidden' }, 403);
    expect(await failureMessage(res, 'fallback')).toBe('Forbidden');
  });

  it('falls back when the body has no error field', async () => {
    const res = jsonResponse({ ok: false });
    expect(await failureMessage(res, 'fallback')).toBe('fallback');
  });

  it('falls back when the error message is blank', async () => {
    const res = jsonResponse({ error: '   ' });
    expect(await failureMessage(res, 'fallback')).toBe('fallback');
  });

  it('falls back when the error is not a string', async () => {
    const res = jsonResponse({ error: { code: 42501 } });
    expect(await failureMessage(res, 'fallback')).toBe('fallback');
  });

  it('falls back when the body is not JSON', async () => {
    const res = new Response('<html>502 Bad Gateway</html>', { status: 502 });
    expect(await failureMessage(res, 'fallback')).toBe('fallback');
  });

  it('falls back on an empty body', async () => {
    const res = new Response(null, { status: 500 });
    expect(await failureMessage(res, 'fallback')).toBe('fallback');
  });
});
