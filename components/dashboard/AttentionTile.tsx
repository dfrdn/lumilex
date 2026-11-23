'use client';

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { applyDeliverablePatch, useDeliverableUpdates } from '@/components/DeliverableUpdatesContext';
import type { DeliverableActionPatch } from '@/components/DeliverableActionButtons';
import { countsAsOverdue } from '@/lib/my-deliverables';

export type AttentionTone = 'rose' | 'blue' | 'amber';

const TONE: Record<AttentionTone, string> = {
  rose: 'bg-rose-50 text-rose-700 border-rose-200 hover:border-rose-300 dark:bg-rose-500/10 dark:text-rose-300 dark:border-rose-500/25 dark:hover:border-rose-500/40',
  blue: 'bg-blue-50 text-blue-700 border-blue-200 hover:border-blue-300 dark:bg-blue-500/10 dark:text-blue-300 dark:border-blue-500/25 dark:hover:border-blue-500/40',
  amber: 'bg-amber-50 text-amber-800 border-amber-200 hover:border-amber-300 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/25 dark:hover:border-amber-500/40',
};
const QUIET = 'bg-stone-50 text-stone-500 border-stone-200 hover:border-stone-300 dark:bg-white/[0.03] dark:text-stone-400 dark:border-white/10 dark:hover:border-white/20';

/** Just what deciding "overdue and with me" needs, so the tile can follow actions taken on the page. */
export interface OverdueCandidate {
  id: string;
  status: string;
  currentlyWith: string[];
  externalDueDate: string | null;
  reviewerIds: string[];
  reviewDates: (string | null)[];
}

interface Props {
  href: string;
  label: string;
  tone: AttentionTone;
  /** A fixed count; null when it failed to load. */
  count?: number | null;
  /** Count overdue deliverables live instead: they drop out as actions move them off the person's desk. */
  overdue?: { items: OverdueCandidate[]; userId: string; today: string } | null;
}

function TileBody({ count, label }: { count: number | null; label: string }) {
  return (
    <>
      <div className="font-serif text-2xl tabular-nums leading-none">{count ?? '—'}</div>
      <div className="mt-1.5 text-xs font-medium">{label}</div>
    </>
  );
}

/** One Needs attention tile. */
export default function AttentionTile({ href, label, tone, count = null, overdue }: Props) {
  const [items, setItems] = useState(overdue?.items ?? []);
  // A fresh server read replaces the local rows (set during render, as in MyDeliverables).
  const [seen, setSeen] = useState(overdue?.items);
  if (seen !== overdue?.items) {
    setSeen(overdue?.items);
    setItems(overdue?.items ?? []);
  }
  const applyPatch = useCallback((id: string, patch: DeliverableActionPatch) => {
    setItems((prev) => prev.map((it) => (it.id === id ? applyDeliverablePatch(it, patch) : it)));
  }, []);
  useDeliverableUpdates(applyPatch);

  const live = useMemo(
    () => (overdue ? items.filter((d) => countsAsOverdue(d, overdue.userId, overdue.today)).length : null),
    [items, overdue],
  );
  const n = overdue === undefined ? count : live;
  const cls = `press rounded-xl border px-3.5 py-3 transition-colors ${n ? TONE[tone] : QUIET}`;

  // A widget on this page is reached by a plain anchor: it scrolls natively and fires
  // the hashchange a collapsed SectionCard opens on, which a client-side Link does not.
  return href.startsWith('#') ? (
    <a href={href} className={cls}>
      <TileBody count={n} label={label} />
    </a>
  ) : (
    <Link href={href} className={cls}>
      <TileBody count={n} label={label} />
    </Link>
  );
}
