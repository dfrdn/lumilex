'use client';

import { CalendarDays } from 'lucide-react';
import SectionCard from '@/components/ui/SectionCard';
import LoadError from '@/components/ui/LoadError';
import WeeklyCalendar from '@/components/WeeklyCalendar';
import { useDashboardLayout } from '@/components/dashboard/DashboardBoard';
import type { CalendarMode } from '@/lib/dashboard-widgets';
import type { NotionFiling, NotionHearing, NotionMeeting, NotionTask } from '@/types/notion';

interface Week {
  meetings: NotionMeeting[];
  hearings: NotionHearing[];
  filings: NotionFiling[];
  tasks?: NotionTask[];
}

interface Props {
  /** Null when a read behind that view failed. */
  mine: Week | null;
  firm: Week | null;
  weekStart: string;
}

const MODES: { value: CalendarMode; label: string }[] = [
  { value: 'mine', label: 'Mine' },
  { value: 'firm', label: 'Firm' },
];

/** One calendar for the week: the person's own events and tasks, or the whole firm's. */
export default function CalendarWidget({ mine, firm, weekStart }: Props) {
  // The choice lives in the board's layout, so a refused save rolls it back here too.
  const { calendar: mode, saveCalendarMode } = useDashboardLayout();
  const week = mode === 'mine' ? mine : firm;
  const count = week ? week.meetings.length + week.hearings.length + week.filings.length + (week.tasks?.length ?? 0) : undefined;

  const choose = (next: CalendarMode) => {
    if (next !== mode) saveCalendarMode(next);
  };

  return (
    <SectionCard
      id="calendar"
      title="This week"
      icon={<CalendarDays className="w-5 h-5" />}
      count={count}
      actions={
        <div role="radiogroup" aria-label="Whose calendar" className="inline-flex rounded-lg border border-stone-200 dark:border-white/10 p-0.5 text-xs">
          {MODES.map((m) => (
            <button
              key={m.value}
              type="button"
              role="radio"
              aria-checked={mode === m.value}
              onClick={() => choose(m.value)}
              className={`px-2.5 py-1 max-sm:min-h-9 rounded-md font-medium transition-colors cursor-pointer ${
                mode === m.value
                  ? 'bg-stone-100 text-stone-900 dark:bg-white/10 dark:text-stone-50'
                  : 'text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-200'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      }
    >
      {week ? (
        <WeeklyCalendar
          key={mode}
          initialMeetings={week.meetings}
          initialHearings={week.hearings}
          initialFilings={week.filings}
          initialTasks={week.tasks}
          initialWeekStart={weekStart}
          apiEndpoint={mode === 'mine' ? '/api/my-calendar' : '/api/firm-calendar'}
        />
      ) : (
        <LoadError />
      )}
    </SectionCard>
  );
}
