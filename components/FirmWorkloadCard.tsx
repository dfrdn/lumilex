import Link from 'next/link';
import { AlertCircle, BarChart3 } from 'lucide-react';
import SectionCard from '@/components/ui/SectionCard';
import type { FirmDeliverableSummary } from '@/lib/queries/partner';
import { DELIVERABLE_STATUS } from '@/lib/deliverable-status';
import { deliverablesHref } from '@/lib/deliverables/views';

const statusColors: Record<string, string> = {
  [DELIVERABLE_STATUS.NOT_STARTED]:         'bg-gray-100 text-gray-600',
  [DELIVERABLE_STATUS.DRAFTING]:            'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300',
  [DELIVERABLE_STATUS.UNDER_REVIEW]:        'bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-300',
  [DELIVERABLE_STATUS.REVISING]:            'bg-purple-100 text-purple-700 dark:bg-purple-500/20 dark:text-purple-300',
  [DELIVERABLE_STATUS.FINALIZING]:          'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300',
  [DELIVERABLE_STATUS.PRE_FINALIZED]:       'bg-pink-100 text-pink-700 dark:bg-pink-500/20 dark:text-pink-300',
  [DELIVERABLE_STATUS.AWAITING_CLIENT]:     'bg-gold-100 text-gold-700 dark:bg-gold-500/20 dark:text-gold-300',
  [DELIVERABLE_STATUS.OUTBOX]:              'bg-teal-100 text-teal-700 dark:bg-teal-500/20 dark:text-teal-300',
  [DELIVERABLE_STATUS.FILED_OR_SENT_OUT]:   'bg-green-100 text-green-700',
  'For Initial Review':  'bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-300',
  'For Final Review':    'bg-purple-100 text-purple-700 dark:bg-purple-500/20 dark:text-purple-300',
  'For Revision':        'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300',
  'Ready to File':       'bg-teal-100 text-teal-700 dark:bg-teal-500/20 dark:text-teal-300',
};

interface Props {
  byStatus: FirmDeliverableSummary[];
  total: number;
  overdueCount: number;
}

const statusOrder: readonly string[] = [
  DELIVERABLE_STATUS.NOT_STARTED,
  DELIVERABLE_STATUS.DRAFTING,
  DELIVERABLE_STATUS.UNDER_REVIEW,
  DELIVERABLE_STATUS.REVISING,
  DELIVERABLE_STATUS.FINALIZING,
  DELIVERABLE_STATUS.PRE_FINALIZED,
  DELIVERABLE_STATUS.AWAITING_CLIENT,
  DELIVERABLE_STATUS.OUTBOX,
  DELIVERABLE_STATUS.FILED_OR_SENT_OUT,
];

export default function FirmWorkloadCard({ byStatus, total, overdueCount }: Props) {
  const sorted = [...byStatus].sort((a, b) => {
    const ai = statusOrder.indexOf(a.status);
    const bi = statusOrder.indexOf(b.status);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });

  return (
    <SectionCard id="firm-workload" title="Firm Workload" icon={<BarChart3 className="w-5 h-5" />} count={total}>
      {overdueCount > 0 && (
        <div className="mb-4 px-3.5 py-2.5 bg-red-50 border border-red-200/80 dark:border-red-500/20 rounded-xl text-sm text-red-700 font-semibold flex items-center gap-2 dark:bg-red-500/10 dark:text-red-300">
          <AlertCircle className="w-5 h-5 text-red-500 shrink-0 dark:text-red-400" />
          {overdueCount} overdue deliverable{overdueCount !== 1 ? 's' : ''}
        </div>
      )}
      <div className="space-y-1.5">
        {sorted.map((s) => (
          <Link
            key={s.status}
            href={deliverablesHref('by-status', { status: s.status })}
            className="flex items-center justify-between text-sm hover:bg-stone-50 rounded-lg px-2.5 py-2 -mx-1 transition-colors duration-150 group dark:hover:bg-stone-800"
          >
            <span className={`px-2 py-0.5 rounded text-xs font-medium ring-1 ring-inset ring-current/10 ${statusColors[s.status] ?? 'bg-gray-100 text-gray-600 dark:bg-stone-800 dark:text-stone-300'}`}>
              {s.status}
            </span>
            <span className="font-bold text-stone-800 tabular-nums group-hover:text-gold-700 transition-colors duration-150 dark:text-stone-100">{s.count}</span>
          </Link>
        ))}
      </div>
      <div className="mt-3 pt-3 border-t border-stone-100 flex items-center justify-between text-sm dark:border-stone-800">
        <span className="text-stone-500 font-medium dark:text-stone-400">Total Active</span>
        <span className="font-bold text-stone-900 tabular-nums dark:text-stone-100">{total}</span>
      </div>
    </SectionCard>
  );
}
