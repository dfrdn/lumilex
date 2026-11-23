import { describe, it, expect, vi } from 'vitest';
import { checkRateLimit, AUTH_LIMITS } from './rate-limit';

// The limiter keeps a module-level store keyed by string. Use a unique key per
// test so cases don't pollute each other.
describe('checkRateLimit', () => {
  it('allows the first request and decrements remaining', () => {
    const r = checkRateLimit('key-first', { limit: 3, windowSeconds: 60 });
    expect(r.allowed).toBe(true);
    expect(r.remaining).toBe(2);
    expect(r.resetAt).toBeGreaterThan(Date.now());
  });

  it('counts down across requests within the window', () => {
    const opts = { limit: 3, windowSeconds: 60 };
    expect(checkRateLimit('key-count', opts).remaining).toBe(2);
    expect(checkRateLimit('key-count', opts).remaining).toBe(1);
    expect(checkRateLimit('key-count', opts).remaining).toBe(0);
  });

  it('blocks once the limit is exceeded', () => {
    const opts = { limit: 2, windowSeconds: 60 };
    checkRateLimit('key-block', opts);
    checkRateLimit('key-block', opts);
    const blocked = checkRateLimit('key-block', opts);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
  });

  it('tracks keys independently', () => {
    const opts = { limit: 1, windowSeconds: 60 };
    expect(checkRateLimit('key-A', opts).allowed).toBe(true);
    expect(checkRateLimit('key-B', opts).allowed).toBe(true); // separate bucket
    expect(checkRateLimit('key-A', opts).allowed).toBe(false);
  });

  it('starts a fresh window once the previous one has elapsed', () => {
    // Drive time deterministically: same window blocks, a window later it resets.
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
      const opts = { limit: 1, windowSeconds: 60 };
      expect(checkRateLimit('key-window', opts).allowed).toBe(true);
      expect(checkRateLimit('key-window', opts).allowed).toBe(false); // still inside the window
      vi.advanceTimersByTime(61_000); // past resetAt
      expect(checkRateLimit('key-window', opts).allowed).toBe(true); // fresh window
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('AUTH_LIMITS', () => {
  it('defines the documented auth limits', () => {
    expect(AUTH_LIMITS.login).toEqual({ limit: 10, windowSeconds: 15 * 60 });
    expect(AUTH_LIMITS.setPassword).toEqual({ limit: 5, windowSeconds: 15 * 60 });
    expect(AUTH_LIMITS.changePassword).toEqual({ limit: 5, windowSeconds: 15 * 60 });
  });
});
