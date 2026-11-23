import type { SWRConfiguration, Cache } from 'swr';

/**
 * Default fetcher for SWR — fetches JSON from an API route.
 * Throws on non-OK responses so SWR can handle errors.
 */
export async function fetcher<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Fetch failed: ${res.status}`);
  }
  return res.json();
}

// ── localStorage cache provider for SWR ──────────────────────────

const CACHE_KEY = 'lumilex-swr-cache';
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

interface CacheEntry {
  data: unknown;
  timestamp: number;
}

/**
 * Money, pay and people records, client mail, and a matter's contents stay in
 * memory only: the cache outlives the tab, and a shared machine shouldn't hand
 * them to the next person to open it.
 */
const NO_PERSIST_PREFIXES = [
  '/api/email',
  '/api/matters/',
  '/api/matter-summary',
  '/api/finance',
  '/api/partner',
  '/api/reimbursement',
  '/api/fee-schedule',
  '/api/user',
  '/api/admin/users',
  '/api/admin/audit-log',
  '/api/leave',
  '/api/intakes',
  '/api/feedback',
  '/api/transportation-zones',
];

/** Written on sign-out so every open tab stops persisting, not just this one. */
const SIGNED_OUT_KEY = 'lumilex-swr-signed-out';

let persistenceStopped = false;

/** Drop the stored cache and stop writing it, here and in other tabs — called on sign-out. */
export function clearPersistedSWRCache() {
  persistenceStopped = true;
  try {
    localStorage.removeItem(CACHE_KEY);
    localStorage.setItem(SIGNED_OUT_KEY, String(Date.now()));
  } catch {
    // Storage unavailable — nothing stored
  }
}

/**
 * Creates an SWR cache provider backed by localStorage.
 * On init, loads any non-expired entries from localStorage into a Map.
 * On unload, writes the current cache back to localStorage.
 */
export function localStorageCacheProvider(): Cache {
  if (typeof window === 'undefined') return new Map() as Cache;

  // Load from localStorage, filtering out expired entries
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const map = new Map<string, any>();
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) {
      const stored: Record<string, CacheEntry> = JSON.parse(raw);
      const now = Date.now();
      for (const [key, entry] of Object.entries(stored)) {
        if (now - entry.timestamp < CACHE_TTL) {
          map.set(key, entry.data);
        }
      }
    }
  } catch {
    // Corrupted cache — start fresh
  }

  // Another tab signed out: its unload must not write this tab's cache back.
  window.addEventListener('storage', (e) => {
    if (e.key === SIGNED_OUT_KEY) persistenceStopped = true;
  });

  // Persist cache to localStorage before page unload
  window.addEventListener('beforeunload', () => {
    if (persistenceStopped) return;
    try {
      const obj: Record<string, CacheEntry> = {};
      const now = Date.now();
      map.forEach((value, key) => {
        // Only persist API data, not internal SWR keys
        if ((key.startsWith('/api/') || key.startsWith('$')) && !NO_PERSIST_PREFIXES.some((p) => key.includes(p))) {
          obj[key] = { data: value, timestamp: now };
        }
      });
      localStorage.setItem(CACHE_KEY, JSON.stringify(obj));
    } catch {
      // Storage full or unavailable — ignore
    }
  });

  return map as Cache;
}

/**
 * Global SWR configuration.
 * - dedupingInterval: 10s — prevents duplicate requests within 10s
 * - revalidateOnFocus: true — refresh data when user returns to tab
 * - errorRetryCount: 2 — retry failed requests twice
 * - provider: localStorage-backed cache for instant page loads
 */
export const swrConfig: SWRConfiguration = {
  fetcher,
  dedupingInterval: 10_000,
  revalidateOnFocus: true,
  errorRetryCount: 2,
  provider: localStorageCacheProvider,
};
