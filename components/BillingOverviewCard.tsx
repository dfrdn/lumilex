import { DollarSign } from 'lucide-react';
import SectionCard from '@/components/ui/SectionCard';
import type { DTRSummary } from '@/lib/queries/partner';

function fmt(h: number, m: number): string {
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

const emptyDTR: DTRSummary = { totalHours: 0, totalMinutes: 0, entries: [], byLawyer: {} };

interface Props {
  monthDTR?: DTRSummary | null;
}

export default function BillingOverviewCard({ monthDTR }: Props) {
  const month = monthDTR ?? emptyDTR;
  const monthEntries = Object.entries(month.byLawyer).sort((a, b) => b[1].hours - a[1].hours);
  const maxHours = monthEntries.length > 0 ? Math.max(...monthEntries.map(([, t]) => t.hours + t.minutes / 60)) : 1;

  return (
    <SectionCard id="billing" title="Billing Overview" icon={<DollarSign className="w-5 h-5" />}>
      <div>
        <div className="mb-4">
          <p className="text-[11px] font-medium text-stone-400 uppercase tracking-wider mb-1 dark:text-stone-500">This Month</p>
          <p className="text-2xl font-bold text-stone-900 tabular-nums dark:text-stone-100">{fmt(month.totalHours, month.totalMinutes)}</p>
        </div>
        {monthEntries.length === 0 ? (
          <p className="text-sm text-stone-400 dark:text-stone-500">No DTR entries this month</p>
        ) : (
          <div className="space-y-2.5">
            {monthEntries.map(([name, time]) => {
              const ratio = (time.hours + time.minutes / 60) / maxHours;
              return (
                <div key={name} className="flex items-center gap-3">
                  <span className="text-sm text-stone-700 truncate w-24 shrink-0 dark:text-stone-200">{name}</span>
                  <div className="flex-1 bg-stone-100 rounded-full h-1.5 dark:bg-stone-700">
                    <div
                      className="bg-gold-400 rounded-full h-1.5 transition-all"
                      style={{ width: `${Math.max(ratio * 100, 2)}%` }}
                    />
                  </div>
                  <span className="text-sm text-stone-900 font-semibold tabular-nums w-14 text-right shrink-0 dark:text-stone-100">
                    {fmt(time.hours, time.minutes)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </SectionCard>
  );
}
