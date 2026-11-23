'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { DeliverableActionPatch } from '@/components/DeliverableActionButtons';

type DeliverableUpdateListener = (id: string, patch: DeliverableActionPatch) => void;

interface DeliverableUpdatesContextValue {
  publishDeliverableUpdate: (id: string, patch: DeliverableActionPatch) => void;
  subscribeDeliverableUpdate: (listener: DeliverableUpdateListener) => () => void;
}

// Cross-surface channel for deliverable workflow actions. The detail pane and
// the various dashboard lists all live under the same DetailPaneWrapper, but
// each owns its own local state. When one performs an action it publishes the
// patch here so every other surface showing the same deliverable stays in sync
// without a full RSC refresh. The default no-ops keep consumers safe outside a
// provider.
const DeliverableUpdatesContext = createContext<DeliverableUpdatesContextValue>({
  publishDeliverableUpdate: () => {},
  subscribeDeliverableUpdate: () => () => {},
});

export function DeliverableUpdatesProvider({ children }: { children: React.ReactNode }) {
  const listeners = useRef<Set<DeliverableUpdateListener>>(new Set());

  const subscribeDeliverableUpdate = useCallback((listener: DeliverableUpdateListener) => {
    listeners.current.add(listener);
    return () => { listeners.current.delete(listener); };
  }, []);

  const publishDeliverableUpdate = useCallback((id: string, patch: DeliverableActionPatch) => {
    // Snapshot first so a listener that unsubscribes on receipt can't mutate
    // the set mid-iteration.
    [...listeners.current].forEach((listener) => listener(id, patch));
  }, []);

  const value = useMemo(
    () => ({ publishDeliverableUpdate, subscribeDeliverableUpdate }),
    [publishDeliverableUpdate, subscribeDeliverableUpdate],
  );

  return (
    <DeliverableUpdatesContext.Provider value={value}>
      {children}
    </DeliverableUpdatesContext.Provider>
  );
}

/** Returns a stable function to broadcast a deliverable workflow patch. */
export function usePublishDeliverableUpdate() {
  return useContext(DeliverableUpdatesContext).publishDeliverableUpdate;
}

/**
 * Subscribe to deliverable workflow updates from any surface (pane, lists).
 * The listener may change every render; only the latest is invoked, and the
 * subscription is set up once.
 */
export function useDeliverableUpdates(listener: DeliverableUpdateListener) {
  const { subscribeDeliverableUpdate } = useContext(DeliverableUpdatesContext);
  const ref = useRef(listener);
  ref.current = listener;
  useEffect(
    () => subscribeDeliverableUpdate((id, patch) => ref.current(id, patch)),
    [subscribeDeliverableUpdate],
  );
}

/** Merge a workflow patch into a single deliverable-shaped row. */
export function applyDeliverablePatch<T extends { status: string; currentlyWith: string[] }>(
  item: T,
  patch: DeliverableActionPatch,
): T {
  return {
    ...item,
    status: patch.status ?? item.status,
    currentlyWith: patch.currentlyWithIds ?? item.currentlyWith,
  };
}

/**
 * Wire a `setRows`-style list into the shared channel: subscribes an applier
 * that merges incoming patches by id, and returns the publisher to hand to
 * action buttons. For lists that must DROP rows on a transition (e.g. archived,
 * handed off out of a personal queue), subscribe a custom applier with
 * useDeliverableUpdates instead and publish with usePublishDeliverableUpdate.
 */
export function useDeliverableRowSync<T extends { id: string; status: string; currentlyWith: string[] }>(
  setRows: Dispatch<SetStateAction<T[]>>,
): (id: string, patch: DeliverableActionPatch) => void {
  const apply = useCallback(
    (id: string, patch: DeliverableActionPatch) =>
      setRows((prev) => prev.map((r) => (r.id === id ? applyDeliverablePatch(r, patch) : r))),
    [setRows],
  );
  useDeliverableUpdates(apply);
  return usePublishDeliverableUpdate();
}
