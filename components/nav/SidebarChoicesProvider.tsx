'use client';

import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { confirmAction } from '@/components/ui/confirm';
import {
  NO_CHOICES, movePin, placePin, setAreaChoices, toggleHide, togglePin, type SavedSidebar, type SidebarChoices,
} from '@/lib/nav/custom-sidebar';
import type { NavArea } from '@/lib/nav/types';

interface SidebarChoicesContext {
  saved: SavedSidebar;
  update: (area: NavArea, choices: SidebarChoices | null) => void;
}

const Context = createContext<SidebarChoicesContext | null>(null);

/**
 * The person's sidebar choices, shared by the sidebar and More: a change shows
 * at once and is saved behind it. Saves run one at a time, so a quick run of
 * clicks reaches the server in order; once the last one settles the view takes
 * what was actually saved, which undoes whatever failed.
 */
export default function SidebarChoicesProvider({
  initial, children,
}: { initial: SavedSidebar | undefined; children: React.ReactNode }) {
  const [saved, setSaved] = useState<SavedSidebar>(initial ?? {});
  const confirmed = useRef<SavedSidebar>(initial ?? {});
  const queue = useRef<Promise<void>>(Promise.resolve());
  const pending = useRef(0);

  const update = useCallback((area: NavArea, choices: SidebarChoices | null) => {
    setSaved((prev) => setAreaChoices(prev, area, choices));
    pending.current += 1;
    queue.current = queue.current.then(async () => {
      try {
        const res = await fetch('/api/me/sidebar', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ area, choices }),
        });
        if (!res.ok) throw new Error(`Saving the sidebar returned ${res.status}`);
        confirmed.current = setAreaChoices(confirmed.current, area, choices);
      } catch (err) {
        toast.error('Could not save your sidebar');
        console.error('[sidebar] Failed to save:', err);
      } finally {
        pending.current -= 1;
        if (pending.current === 0) setSaved(confirmed.current);
      }
    });
  }, []);

  const value = useMemo(() => ({ saved, update }), [saved, update]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

/** One area's choices, and the ways to change them. */
export function useSidebarChoices(area: NavArea) {
  const context = useContext(Context);
  if (!context) throw new Error('useSidebarChoices needs a SidebarChoicesProvider above it');
  const { saved, update } = context;
  const choices = saved[area] ?? NO_CHOICES;

  // A move that changes nothing (an edge, a drop on itself) isn't saved.
  const change = (next: SidebarChoices) => {
    if (next !== choices) update(area, next);
  };

  return {
    saved,
    choices,
    customized: saved[area] !== undefined,
    togglePin: (href: string) => change(togglePin(choices, href)),
    toggleHide: (href: string) => change(toggleHide(choices, href)),
    /** `shown` is the Pinned group as drawn. */
    movePin: (shown: string[], href: string, by: -1 | 1) => change(movePin(choices, shown, href, by)),
    placePin: (shown: string[], href: string, target: string) => change(placePin(choices, shown, href, target)),
    reset: async () => {
      const ok = await confirmAction({
        title: 'Reset this sidebar?',
        message: 'Your pins and hidden links here are cleared, and the sidebar goes back to its default.',
        confirmLabel: 'Reset',
      });
      if (ok) update(area, null);
    },
  };
}
