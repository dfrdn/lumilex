import Link from 'next/link';
import TabLabel from '@/components/ui/TabLabel';
import { INSIGHTS_TABS, insightsHref, type InsightsTab } from '@/lib/finance/insights-tabs';

const GROUP = 'inline-flex p-0.5 rounded-lg bg-stone-100 dark:bg-white/[0.06] text-xs';
const SEGMENT = 'press shrink-0 inline-flex items-center gap-1.5 px-3 py-1 rounded-md transition-all whitespace-nowrap';
const SEGMENT_ON = 'bg-white dark:bg-card shadow-sm text-stone-900 dark:text-stone-50 font-medium';
const SEGMENT_OFF = 'text-stone-500 dark:text-stone-400 hover:text-stone-800 dark:hover:text-stone-100';

/** Leakage, Cash flow, Profitability: each a link, so the tab lives in the URL. */
export default function InsightsTabs({ tab }: { tab: InsightsTab }) {
  return (
    <div className="-mx-1 px-1 overflow-x-auto">
      <nav className={GROUP} aria-label="Insights">
        {INSIGHTS_TABS.map((t) => (
          <Link
            key={t.key}
            href={insightsHref(t.key)}
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
