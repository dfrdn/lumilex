'use client';

import { CalendarClock, Landmark, ScrollText, Stamp } from 'lucide-react';
import { shortDate, type CorporationStatus, type TrackKey } from '@/lib/corporations/status';
import SubjectTrackCards from '@/components/ui/TrackCards';
import { TRACK_TAB } from './tracks';

const ICON: Record<TrackKey, React.ReactNode> = {
  application: <Stamp className="w-4 h-4" />,
  registrations: <Landmark className="w-4 h-4" />,
  housekeeping: <CalendarClock className="w-4 h-4" />,
  compliance: <ScrollText className="w-4 h-4" />,
};

/**
 * The tracks in focus (status.focus — the current lifecycle phase, plus any
 * later track already needing attention): what state each is in, how far
 * along it is, and what to do next. Each opens the tab where that work lives.
 */
export default function TrackCards({
  status,
  activeTab,
  onOpen,
}: {
  status: CorporationStatus;
  activeTab: string;
  onOpen: (tab: (typeof TRACK_TAB)[TrackKey]) => void;
}) {
  const shown = status.tracks.filter((t) => status.focus.includes(t.key));
  const active = shown.find((t) => TRACK_TAB[t.key] === activeTab)?.key ?? null;
  return (
    <SubjectTrackCards
      activeKey={active}
      onOpen={(key) => onOpen(TRACK_TAB[key as TrackKey])}
      cards={shown.map((t) => ({
        key: t.key,
        label: t.label,
        icon: ICON[t.key],
        health: t.health,
        done: t.done,
        total: t.total,
        summary: t.summary,
        waitingOnClient: t.waitingOnClient,
        next:
          t.next && t.next.label !== t.summary.split(' — ')[0]
            ? `Next: ${t.next.label}${t.next.dueDate ? ` · ${shortDate(t.next.dueDate)}` : ''}`
            : (t.next?.detail ?? ''),
      }))}
    />
  );
}
