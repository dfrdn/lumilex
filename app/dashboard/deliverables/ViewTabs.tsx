import Link from 'next/link';
import TabLabel from '@/components/ui/TabLabel';
import { DELIVERABLE_VIEWS, deliverablesHref, type DeliverableView } from '@/lib/deliverables/views';

const GROUP = 'inline-flex p-0.5 rounded-lg bg-stone-100 dark:bg-white/[0.06] text-xs';
const SEGMENT = 'press shrink-0 px-3 py-1 rounded-md transition-all whitespace-nowrap';
const SEGMENT_ON = 'bg-white dark:bg-card shadow-sm text-stone-900 dark:text-stone-50 font-medium';
const SEGMENT_OFF = 'text-stone-500 dark:text-stone-400 hover:text-stone-800 dark:hover:text-stone-100';

/** The saved filters, each a link so the choice lives in the URL. */
export default function ViewTabs({ view }: { view: DeliverableView }) {
  return (
    <div className="mb-4 -mx-1 px-1 overflow-x-auto">
      <nav className={GROUP} aria-label="Deliverable views">
        {DELIVERABLE_VIEWS.map((v) => (
          <Link
            key={v.key}
            href={deliverablesHref(v.key)}
            aria-current={view === v.key ? 'page' : undefined}
            className={`${SEGMENT} ${view === v.key ? SEGMENT_ON : SEGMENT_OFF}`}
          >
            <TabLabel label={v.label} />
          </Link>
        ))}
      </nav>
    </div>
  );
}
