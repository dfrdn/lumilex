import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * firmBaseUrl swaps only the hostname of the platform URL, keeping its scheme
 * and port. That is what lets one implementation serve dev (http, :3000) and
 * production (https, no port) without either being special-cased — and it is
 * the part a future edit is most likely to get wrong.
 */
const maybeSingle = vi.fn();

vi.mock('@/lib/supabase', () => ({
  getSupabase: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({ maybeSingle }),
        }),
      }),
    }),
  }),
}));

// React's cache() memoizes per call in a non-request context, which would make
// the second case in a test see the first case's answer.
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  cache: <T,>(fn: T) => fn,
}));

async function resolve(platform: string, domain: string | null): Promise<string> {
  vi.stubEnv('APP_BASE_URL', platform);
  maybeSingle.mockResolvedValue({ data: domain ? { domain } : null });
  const { firmBaseUrl } = await import('./config');
  return firmBaseUrl('firm-1');
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('firmBaseUrl', () => {
  it('keeps the platform scheme and port when swapping in a dev host', async () => {
    expect(await resolve('http://localhost:3000', 'firm-b.localhost')).toBe(
      'http://firm-b.localhost:3000',
    );
  });

  it('produces a bare https origin for a production custom domain', async () => {
    expect(await resolve('https://app.lumilex.com', 'meridian.example.com')).toBe(
      'https://meridian.example.com',
    );
  });

  it('falls back to the platform origin when the firm has no primary domain', async () => {
    expect(await resolve('https://app.lumilex.com', null)).toBe('https://app.lumilex.com');
  });

  it('drops a trailing slash on the platform URL', async () => {
    expect(await resolve('https://app.lumilex.com/', null)).toBe('https://app.lumilex.com');
  });
});
