'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRight, FileText, Gavel } from 'lucide-react';
import { useDetailPane } from '@/components/DetailPaneContext';
import { applyDeliverablePatch, useDeliverableUpdates } from '@/components/DeliverableUpdatesContext';
import type { DeliverableActionPatch } from '@/components/DeliverableActionButtons';
import { daysLate, pickUpNext } from '@/lib/my-deliverables';
import { formatManilaTime } from '@/lib/dates';
import type { NotionDeliverable, NotionHearing } from '@/types/notion';

interface Props {
  /** The person's hearings today. */
  hearings: NotionHearing[];
  /** Every active deliverable the person is involved in. */
  deliverables: NotionDeliverable[];
  courtMatterIds: string[];
  userId: string;
  today: string;
  /** When the server rendered the page: the clock until the client takes over, so both renders agree. */
  renderedAt: number;
}

/** "in 2 h", "in 25 min", "now". */
function relative(iso: string, now: number): string {
  const mins = Math.round((new Date(iso).getTime() - now) / 60_000);
  if (mins <= 0) return 'now';
  if (mins < 60) return `in ${mins} min`;
  return `in ${Math.round(mins / 60)} h`;
}

/**
 * One line above everything: the single most time-critical thing for the
 * person right now (`pickUpNext`), opening in the side pane. Follows actions
 * taken on the page, and the clock, so a hearing gives way once it's over.
 */
export default function UpNext({ hearings, deliverables, courtMatterIds, userId, today, renderedAt }: Props) {
  const [items, setItems] = useState(deliverables);
  // A fresh server read replaces the local rows (set during render, as in MyDeliverables).
  const [seen, setSeen] = useState(deliverables);
  if (seen !== deliverables) {
    setSeen(deliverables);
    setItems(deliverables);
  }
  const applyPatch = useCallback((id: string, patch: DeliverableActionPatch) => {
    setItems((prev) => prev.map((it) => (it.id === id ? applyDeliverablePatch(it, patch) : it)));
  }, []);
  useDeliverableUpdates(applyPatch);
  const { openPane } = useDetailPane();

  // Starts at the server's clock so hydration matches, then follows the real one each minute.
  const [now, setNow] = useState(renderedAt);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  const court = useMemo(() => new Set(courtMatterIds), [courtMatterIds]);
  const pick = useMemo(
    () => pickUpNext(hearings, items, court, userId, today, new Date(now)),
    [hearings, items, court, userId, today, now],
  );
  if (!pick) return null;

  let tone: 'amber' | 'rose';
  let lead: string;
  let text: string;
  let icon: React.ReactNode;
  let open: () => void;

  if (pick.kind === 'hearing') {
    const h = pick.hearing;
    tone = 'amber';
    lead = `Up next · ${relative(h.date!, now)}`;
    text = `Hearing at ${formatManilaTime(h.date) ?? ''} — ${h.name}`;
    icon = <Gavel className="w-4 h-4" />;
    open = () => openPane('hearings', h.id);
  } else {
    const d = pick.deliverable;
    const late = daysLate(d, userId, today);
    tone = pick.reason === 'overdue' ? 'rose' : 'amber';
    lead =
      pick.reason === 'overdue'
        ? `Up next · ${late} ${late === 1 ? 'day' : 'days'} late`
        : pick.reason === 'court-today'
          ? 'Up next · court deadline today'
          : 'Up next · due today';
    text = [d.name, d.client || d.matter].filter(Boolean).join(' — ');
    icon = d.matterId && court.has(d.matterId) ? <Gavel className="w-4 h-4" /> : <FileText className="w-4 h-4" />;
    open = () => openPane('deliverables', d.id);
  }

  const cls =
    tone === 'rose'
      ? 'border-rose-200 bg-rose-50 text-rose-800 hover:border-rose-300 dark:hover:border-rose-500/50 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-200'
      : 'border-amber-200 bg-amber-50 text-amber-900 hover:border-amber-300 dark:hover:border-amber-500/50 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-200';

  return (
    <button
      type="button"
      onClick={open}
      className={`press mb-3 flex w-full items-center gap-3 rounded-xl border px-4 py-2.5 text-left text-sm transition-colors cursor-pointer ${cls}`}
    >
      <span className="shrink-0 opacity-80" aria-hidden="true">{icon}</span>
      <span className="min-w-0 flex-1 sm:truncate max-sm:line-clamp-2">
        <span className="font-semibold">{lead}</span>
        <span className="opacity-80"> — </span>
        {text}
      </span>
      <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium">
        Open <ArrowRight className="w-3.5 h-3.5" />
      </span>
    </button>
  );
}
