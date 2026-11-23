'use client';

import { useState } from 'react';
import { CalendarClock, FileText, Stamp } from 'lucide-react';

type Section = 'meetings' | 'resolutions' | 'certificates';

/**
 * Meetings, the resolutions passed at them, and the secretary's certificates
 * issued on those resolutions — one body of corporate housekeeping, one tab.
 */
export default function BoardPapersTab({
  counts,
  initial = 'meetings',
  meetings,
  resolutions,
  certificates,
}: {
  counts: Record<Section, number>;
  initial?: Section;
  meetings: React.ReactNode;
  resolutions: React.ReactNode;
  certificates: React.ReactNode;
}) {
  const [section, setSection] = useState<Section>(initial);
  const items: { key: Section; label: string; icon: React.ReactNode }[] = [
    { key: 'meetings', label: 'Meetings', icon: <CalendarClock className="w-3.5 h-3.5" /> },
    { key: 'resolutions', label: 'Resolutions', icon: <FileText className="w-3.5 h-3.5" /> },
    { key: 'certificates', label: "Secretary's certificates", icon: <Stamp className="w-3.5 h-3.5" /> },
  ];
  return (
    <div className="space-y-4">
      <div className="inline-flex p-1 rounded-xl bg-stone-100 dark:bg-white/[0.06] gap-1">
        {items.map((i) => (
          <button
            key={i.key}
            type="button"
            onClick={() => setSection(i.key)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              section === i.key
                ? 'bg-white dark:bg-card text-stone-900 dark:text-stone-50 shadow-sm'
                : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100'
            }`}
          >
            {i.icon}
            {i.label}
            <span className={`text-[10px] tabular-nums ${section === i.key ? 'text-stone-400' : 'text-stone-400 dark:text-stone-500'}`}>
              {counts[i.key]}
            </span>
          </button>
        ))}
      </div>
      {section === 'meetings' && meetings}
      {section === 'resolutions' && resolutions}
      {section === 'certificates' && certificates}
    </div>
  );
}
