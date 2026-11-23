import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import SectionCard from '@/components/ui/SectionCard';
import AttentionTile, { type OverdueCandidate } from '@/components/dashboard/AttentionTile';
import { getSupabaseServerAuthClient } from '@/lib/supabase-server';
import { countNewInboxFiles } from '@/lib/queries/files';
import { getMyDeadlinesOnce } from '@/lib/queries/dashboard';
import { countsAsOverdue } from '@/lib/my-deliverables';

interface Props {
  firmId: string;
  userId: string;
  today: string;
  /** The person's overdue deliverables, counted live as actions move them; null when the read failed. */
  overdueDeliverables: OverdueCandidate[] | null;
  overdueTasks: number | null;
  /** Where each tile goes: the widget on this page when it is shown, else the list page. */
  links: { deliverables: string; tasks: string; inbox: string; deadlines: string };
  /**
   * Set while My deliverables is on the page: it already counts the overdue
   * deliverables right beside this, so the tile counts overdue case, company
   * and mark deadlines instead (`withMe` as Deadlines reads it).
   */
  deadlinesInstead?: { withMe: string } | null;
}

/**
 * What is late or waiting on the person, at the top of the page: overdue
 * deliverables and tasks, and unread files. Each tile is
 * the list behind its number.
 */
export default async function NeedsAttention({ firmId, userId, today, overdueDeliverables, overdueTasks, links, deadlinesInstead }: Props) {
  const db = await getSupabaseServerAuthClient();
  const [inbox, deadlines] = await Promise.allSettled([
    countNewInboxFiles(firmId, userId, db),
    deadlinesInstead ? getMyDeadlinesOnce(userId, today, deadlinesInstead.withMe).then((d) => d.overdue.length) : Promise.resolve(0),
  ]);
  for (const [label, r] of [['unread files count', inbox], ['overdue deadlines', deadlines]] as const) {
    if (r.status === 'rejected') console.error(`[dashboard] ${label} failed for ${userId}:`, r.reason);
  }
  const value = (r: PromiseSettledResult<number>) => (r.status === 'fulfilled' ? r.value : null);
  const unread = value(inbox);
  const lateDeliverables = overdueDeliverables && overdueDeliverables.filter((d) => countsAsOverdue(d, userId, today)).length;
  const lateDeadlines = value(deadlines);
  // "Nothing overdue" has to hold for deliverables too, even while My
  // deliverables shows their count and this card shows deadlines instead.
  const clear =
    lateDeliverables === 0 &&
    (!deadlinesInstead || lateDeadlines === 0) &&
    overdueTasks === 0 &&
    unread === 0;

  return (
    <SectionCard
      id="attention"
      title="Needs attention"
      icon={clear ? <CheckCircle2 className="w-5 h-5" /> : <AlertTriangle className="w-5 h-5" />}
    >
      {/* Two by two in the side rail; one row when the card spans the page. */}
      <div className="@container">
        <div className="grid grid-cols-2 @xl:grid-cols-3 gap-2.5">
          {deadlinesInstead ? (
            <AttentionTile href={links.deadlines} label="Overdue deadlines" tone="rose" count={lateDeadlines} />
          ) : (
            <AttentionTile
              href={links.deliverables}
              label="Overdue deliverables"
              tone="rose"
              overdue={overdueDeliverables && { items: overdueDeliverables, userId, today }}
            />
          )}
          <AttentionTile href={links.tasks} label="Overdue tasks" tone="rose" count={overdueTasks} />
          <AttentionTile href={links.inbox} label="Unread files" tone="blue" count={unread} />
        </div>
      </div>
      {clear && <p className="mt-2.5 px-1 text-xs text-[var(--text-secondary)]">Nothing overdue or waiting on you.</p>}
    </SectionCard>
  );
}
