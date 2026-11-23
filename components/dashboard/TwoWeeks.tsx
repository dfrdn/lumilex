import { CalendarRange } from 'lucide-react';
import SectionCard from '@/components/ui/SectionCard';
import LoadError from '@/components/ui/LoadError';
import LoadStrip from '@/components/dashboard/LoadStrip';
import { LOAD_DAYS, getLoadItems, type LoadItem } from '@/lib/queries/dashboard';
import { manilaToday } from '@/lib/dates';

/**
 * How full each of the next fourteen days is: the person's deliverables
 * (passed in, since the page holds them), their hearings, and the deadlines
 * on their cases, companies and marks. A crunch shows up before it arrives.
 */
export default async function TwoWeeks({ firmId, userId, withMe, deliverables }: { firmId: string; userId: string; withMe: string; deliverables: LoadItem[] }) {
  const today = manilaToday();
  let items: LoadItem[];
  try {
    items = [...deliverables, ...(await getLoadItems(firmId, userId, today, withMe))];
  } catch (err) {
    console.error(`[dashboard] two-week load failed for ${userId}:`, err);
    return (
      <SectionCard id="twoweeks" title="Next two weeks" icon={<CalendarRange className="w-5 h-5" />}>
        <LoadError />
      </SectionCard>
    );
  }
  return (
    <SectionCard id="twoweeks" title="Next two weeks" icon={<CalendarRange className="w-5 h-5" />} count={items.length}>
      <LoadStrip items={items} today={today} days={LOAD_DAYS} />
    </SectionCard>
  );
}
