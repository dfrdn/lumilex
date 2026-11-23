'use client';

interface Props {
  data: { lawyerName: string; pending: number; overdue: number }[];
}

export default function DeliverableLawyerTable({ data }: Props) {
  const maxPending = Math.max(...data.map((d) => d.pending), 1);

  if (data.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-stone-200/70 shadow-[var(--shadow-card)] p-4 sm:p-5 dark:bg-stone-900 dark:border-stone-800">
        <h3 className="text-sm font-semibold text-stone-700 dark:text-stone-200 mb-4">Workload by Lawyer</h3>
        <div className="h-64 sm:h-72 flex items-center justify-center text-sm text-stone-400 dark:text-stone-500">
          No pending deliverables
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-stone-200/70 shadow-[var(--shadow-card)] p-4 sm:p-5 dark:bg-stone-900 dark:border-stone-800">
      <h3 className="text-sm font-semibold text-stone-700 dark:text-stone-200 mb-4">Workload by Lawyer</h3>
      <div className="overflow-x-auto max-h-[360px] overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-white dark:bg-stone-900">
            <tr className="border-b border-stone-100 dark:border-stone-800">
              <th className="pb-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500">Lawyer</th>
              <th className="pb-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500">Pending</th>
              <th className="pb-2.5 text-right text-[11px] font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500">Overdue</th>
            </tr>
          </thead>
          <tbody>
            {data.map((l) => (
              <tr key={l.lawyerName} className="border-b border-stone-100/50 dark:border-stone-800/60 hover:bg-gold-50/30 dark:hover:bg-gold-500/5 transition-colors duration-100">
                <td className="py-2.5 pr-3">
                  <span className="font-medium text-stone-700 dark:text-stone-200 text-sm">{l.lawyerName}</span>
                </td>
                <td className="py-2.5 pr-3">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 bg-stone-100 dark:bg-stone-800 rounded-full h-1.5 max-w-[120px]">
                      <div
                        className="bg-gold-400 rounded-full h-1.5 transition-all"
                        style={{ width: `${Math.max((l.pending / maxPending) * 100, 4)}%` }}
                      />
                    </div>
                    <span className="text-stone-700 dark:text-stone-200 tabular-nums font-medium text-xs w-6 text-right">{l.pending}</span>
                  </div>
                </td>
                <td className="py-2.5 text-right">
                  <span className={`font-semibold tabular-nums text-xs ${l.overdue > 0 ? 'text-red-600 dark:text-red-400' : 'text-stone-300 dark:text-stone-600'}`}>
                    {l.overdue}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
