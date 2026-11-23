'use client';

import { useCallback, useSyncExternalStore } from 'react';

export interface PageVisit {
  visitedAt: string | null;
  hintDismissedAt: string | null;
}

/**
 * Which pages this browser has opened, and which tool hints it has closed.
 * Kept in localStorage, not on the server: it only decides whether a "New"
 * pill or a hint is still worth showing, and the app keeps no record of who
 * opened which page. A new browser shows a page's pill again until it is
 * opened there.
 */
const STORAGE_KEY = 'lumilex:pageVisits';

type Visits = Record<string, PageVisit>;

const listeners = new Set<() => void>();
let snapshot: Visits | null = null;
const EMPTY: Visits = {};

function read(): Visits {
  if (snapshot) return snapshot;
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    snapshot = parsed && typeof parsed === 'object' ? (parsed as Visits) : {};
  } catch {
    snapshot = {};
  }
  return snapshot;
}

function write(next: Visits) {
  snapshot = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable: the pill simply shows again next time.
  }
  for (const l of listeners) l();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) {
      snapshot = null;
      listener();
    }
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

const subscribeNever = () => () => {};

/** False on the server and during hydration, true once mounted. */
export function useHydrated(): boolean {
  return useSyncExternalStore(subscribeNever, () => true, () => false);
}

/**
 * The pages this browser has opened, and the hints it has closed. `loaded` is
 * false on the server and during hydration: before then nothing counts as
 * unseen, so no "New" pill or hint flashes in and out.
 */
export function usePageVisits() {
  const mounted = useHydrated();
  const visits = useSyncExternalStore(subscribe, read, () => EMPTY);

  const record = useCallback((path: string, field: keyof PageVisit) => {
    const all = read();
    if (all[path]?.[field]) return;
    const prev = all[path] ?? { visitedAt: null, hintDismissedAt: null };
    write({ ...all, [path]: { ...prev, [field]: new Date().toISOString() } });
  }, []);

  return {
    loaded: mounted,
    hasVisited: (path: string) => !!visits[path]?.visitedAt,
    hintDismissed: (path: string) => !!visits[path]?.hintDismissedAt,
    /** Show a tool's hint: never opened, and the hint never closed. */
    showHint: (path: string) => mounted && !visits[path]?.visitedAt && !visits[path]?.hintDismissedAt,
    recordVisit: (path: string) => record(path, 'visitedAt'),
    dismissHint: (path: string) => record(path, 'hintDismissedAt'),
  };
}
