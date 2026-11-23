import type { LiaisonTask } from '@/lib/queries/liaison';

export interface ErrandStats {
  totalAssigned: number;
  completed: number;
  cancelled: number;
  /** Percentage of non-cancelled errands that were completed, rounded. */
  completionRate: number;
  /** Six `YYYY-MM` keys, oldest first, ending with the month `now` falls in. */
  monthKeys: string[];
  completedByMonth: Map<string, number>;
  completedThisMonth: number;
  /** Completed errands per destination zone, busiest first. */
  topZones: { label: string; value: number }[];
}

/** `completed_at` is stored UTC — bucket it by the Manila day it happened on. */
function phMonth(iso: string) {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' }).slice(0, 7);
}

function pad(n: number) {
  return n.toString().padStart(2, '0');
}

export function computeErrandStats(
  tasks: LiaisonTask[],
  now: Date,
  { months = 6, zoneLimit = 5 } = {},
): ErrandStats {
  const completedTasks = tasks.filter((t) => t.status === 'completed');
  const cancelled = tasks.filter((t) => t.status === 'cancelled').length;

  // A cancelled errand is called off by whoever assigned it, so it doesn't
  // count against the liaison's rate.
  const rateBase = tasks.length - cancelled;
  const completionRate = rateBase > 0 ? Math.round((completedTasks.length / rateBase) * 100) : 0;

  // Anchor the window on the Manila month too. Anchoring on the server's local
  // month (UTC on Vercel) would drop the current month between 00:00 and 08:00
  // Manila on the 1st, when UTC is still in the previous month.
  const [phYear, phMonthNum] = phMonth(now.toISOString()).split('-').map(Number);
  const monthKeys = Array.from({ length: months }, (_, i) => {
    const d = new Date(Date.UTC(phYear, phMonthNum - 1 - (months - 1 - i), 1));
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
  });

  const completedByMonth = new Map(monthKeys.map((k) => [k, 0]));
  const byZone = new Map<string, number>();
  for (const t of completedTasks) {
    if (t.completed_at) {
      const key = phMonth(t.completed_at);
      if (completedByMonth.has(key)) completedByMonth.set(key, (completedByMonth.get(key) ?? 0) + 1);
    }
    const zone = t.zone_name ?? 'No zone set';
    byZone.set(zone, (byZone.get(zone) ?? 0) + 1);
  }

  return {
    totalAssigned: tasks.length,
    completed: completedTasks.length,
    cancelled,
    completionRate,
    monthKeys,
    completedByMonth,
    completedThisMonth: completedByMonth.get(monthKeys[monthKeys.length - 1]) ?? 0,
    topZones: [...byZone.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, zoneLimit)
      .map(([label, value]) => ({ label, value })),
  };
}
