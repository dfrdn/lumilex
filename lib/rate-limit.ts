/**
 * Simple in-memory rate limiter.
 * Tracks request counts per key (e.g., IP or email) within a sliding window.
 * Not shared across serverless instances — for distributed rate limiting,
 * use Redis or Supabase-backed storage.
 */

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

// Cleanup expired entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (now > entry.resetAt) store.delete(key);
  }
}, 5 * 60 * 1000);

interface RateLimitOptions {
  /** Maximum requests allowed in the window */
  limit: number;
  /** Window duration in seconds */
  windowSeconds: number;
}

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

export function checkRateLimit(key: string, options: RateLimitOptions): RateLimitResult {
  const now = Date.now();
  const windowMs = options.windowSeconds * 1000;
  const entry = store.get(key);

  if (!entry || now > entry.resetAt) {
    // New window
    store.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: options.limit - 1, resetAt: now + windowMs };
  }

  entry.count++;
  if (entry.count > options.limit) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt };
  }

  return { allowed: true, remaining: options.limit - entry.count, resetAt: entry.resetAt };
}

/**
 * Auth-specific rate limits.
 * - Login: 10 attempts per 15 minutes per email
 * - Password set: 5 attempts per 15 minutes per IP
 * - Password change: 5 attempts per 15 minutes per user
 */
export const AUTH_LIMITS = {
  login: { limit: 10, windowSeconds: 15 * 60 },
  setPassword: { limit: 5, windowSeconds: 15 * 60 },
  changePassword: { limit: 5, windowSeconds: 15 * 60 },
} as const;
