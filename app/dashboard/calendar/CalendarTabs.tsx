import Link from 'next/link';
import TabLabel from '@/components/ui/TabLabel';
import { CALENDAR_TABS, calendarHref, type CalendarTab } from '@/lib/calendar/views';

const GROUP = 'inline-flex p-0.5 rounded-lg bg-stone-100 dark:bg-white/[0.06] text-xs';
const SEGMENT = 'press shrink-0 px-3 py-1 rounded-md transition-all whitespace-nowrap';
const SEGMENT_ON = 'bg-white dark:bg-card shadow-sm text-stone-900 dark:text-stone-50 font-medium';
const SEGMENT_OFF = 'text-stone-500 dark:text-stone-400 hover:text-stone-800 dark:hover:text-stone-100';

/** Calendar, Hearings, Meetings: each a link, so the tab lives in the URL. */
export default function CalendarTabs({ tab }: { tab: CalendarTab }) {
  return (
    <div className="-mx-1 px-1 overflow-x-auto">
      <nav className={GROUP} aria-label="Calendar views">
        {CALENDAR_TABS.map((t) => (
          <Link
            key={t.key}
            href={calendarHref(t.key)}
            aria-current={tab === t.key ? 'page' : undefined}
            className={`${SEGMENT} ${tab === t.key ? SEGMENT_ON : SEGMENT_OFF}`}
          >
            <TabLabel label={t.label} />
          </Link>
        ))}
      </nav>
    </div>
  );
}
