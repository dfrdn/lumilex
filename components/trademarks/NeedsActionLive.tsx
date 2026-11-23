'use client';

import { useState } from 'react';
import NeedsAction, { type NeedsActionEntry } from './NeedsAction';
import { upcomingDeadlines } from '@/lib/trademark-deadlines';

/**
 * The Needs-action strip over the stored status. When a step is recorded the
 * entries it satisfied drop out at once, and come back in place if it is
 * undone; the stored reading catches up on the next refresh.
 */
export default function NeedsActionLive({ entries: initial }: { entries: NeedsActionEntry[] }) {
  const [entries, setEntries] = useState(initial);
  const [synced, setSynced] = useState(initial);
  if (synced !== initial) {
    setSynced(initial);
    setEntries(initial);
  }
  return (
    <NeedsAction
      entries={entries}
      onUpdated={(t) => {
        const owedKey = (d: NeedsActionEntry['deadline']) => `${d.label}|${d.due}|${d.officeAction?.id ?? ''}`;
        const owed = new Set(upcomingDeadlines(t).map(owedKey));
        const key = (e: NeedsActionEntry) => `${e.trademark.id}|${owedKey(e.deadline)}`;
        setEntries((prev) => {
          const shown = new Set(prev.map(key));
          return synced.filter((e) => (e.trademark.id === t.id ? owed.has(owedKey(e.deadline)) : shown.has(key(e))));
        });
      }}
    />
  );
}
