'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * useState-shaped hook backed by localStorage.
 *
 * Uses a lazy initializer so the first render already reflects the persisted
 * value (avoids a hydration flicker and the race where the persist effect
 * clobbers the stored value before the hydrate effect runs).
 *
 * On the server (or during SSR pre-hydration) we fall back to `initial` and
 * sync from localStorage in an effect.
 *
 * `afterMount` skips the lazy read: a server-rendered component whose first
 * client render must match the server's HTML starts at `initial` and picks
 * the stored value up in the effect, one render later.
 */
export function usePersistedState<T>(
  key: string | null | undefined,
  initial: T,
  { afterMount = false }: { afterMount?: boolean } = {},
): [T, (v: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => {
    if (!key || afterMount || typeof window === 'undefined') return initial;
    try {
      const raw = window.localStorage.getItem(key);
      return raw !== null ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });

  // If we rendered on the server (or skipped hydration for any reason),
  // re-read from storage on mount so client state matches.
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    if (!key) return;
    try {
      const raw = window.localStorage.getItem(key);
      if (raw !== null) {
        const parsed = JSON.parse(raw) as T;
        setValue((prev) => (Object.is(prev, parsed) ? prev : parsed));
      }
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Persist on change (skip before hydration guard is set to avoid clobbering)
  useEffect(() => {
    if (!key) return;
    if (!hydratedRef.current) return;
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // ignore
    }
  }, [key, value]);

  return [value, setValue];
}
