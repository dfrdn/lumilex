import Link from 'next/link';
import { ChevronRight, ListFilter } from 'lucide-react';
import { getAllDeliverables } from '@/lib/queries/listing';
import { getDeliverablesByStatus } from '@/lib/queries/deliverables';
import { resolvePersonIds } from '@/lib/queries/people';
import { deliverableStatusTone, groupByStatus } from '@/lib/deliverable-status';
import { deliverablesHref } from '@/lib/deliverables/views';
import ItemRow from '@/components/ItemRow';
import DateChip from '@/components/DateChip';
import PersonBadge from '@/components/detail/PersonBadge';
import SectionCard from '@/components/ui/SectionCard';
import EmptyState from '@/components/ui/EmptyState';
import { StatusPill } from '@/components/ui/primitives';
import { FORMER_MEMBER } from '@/lib/former-member';

/**
 * One status's deliverables (`?status=`, any status, the 200 due soonest), or
 * with none chosen, every active status with how many deliverables hold it.
 */
export default async function ByStatusView({ firmId, status }: { firmId: string; status: string | null }) {
  if (!status) {
    const groups = groupByStatus(await getAllDeliverables(firmId));
    return (
      <SectionCard title="Active deliverables by status" icon={<ListFilter />} count={groups.reduce((n, g) => n + g.items.length, 0)}>
        {groups.length === 0 ? (
          <EmptyState message="No active deliverables" />
        ) : (
          <div className="px-3 pb-3 space-y-0.5">
            {groups.map((g) => (
              <Link
                key={g.status}
                href={deliverablesHref('by-status', { status: g.status })}
                className="group flex items-center justify-between gap-3 rounded-lg px-2.5 py-2 hover:bg-stone-50 dark:hover:bg-white/5 transition-colors"
              >
                <StatusPill label={g.status} tone={deliverableStatusTone(g.status)} />
                <span className="inline-flex items-center gap-1.5 text-sm font-semibold tabular-nums text-stone-800 dark:text-stone-100">
                  {g.items.length}
                  <ChevronRight className="w-4 h-4 text-stone-300 group-hover:text-stone-500 dark:text-stone-600 dark:group-hover:text-stone-300" />
                </span>
              </Link>
            ))}
          </div>
        )}
      </SectionCard>
    );
  }

  const deliverables = await getDeliverablesByStatus(firmId, status);
  const people = await resolvePersonIds(firmId, deliverables.flatMap((d) => d.currentlyWith));

  return (
    <SectionCard title={status} icon={<ListFilter />} count={deliverables.length}>
      {deliverables.length === 0 ? (
        <EmptyState message={`No deliverables with status "${status}"`} />
      ) : (
        <div className="px-3 pb-3 space-y-0.5">
          {deliverables.map((d) => (
            <ItemRow
              key={d.id}
              href={`/dashboard/deliverables/${d.id}`}
              title={d.name}
              subtitle={d.client || d.matter || undefined}
              badge={d.priority || undefined}
              right={
                <div className="flex items-center gap-2.5">
                  {d.currentlyWith.length > 0 && (
                    <div className="flex gap-1">
                      {d.currentlyWith.map((pid) => {
                        const p = people.get(pid);
                        return <PersonBadge key={pid} initials={p?.initials ?? FORMER_MEMBER} position={p?.position} />;
                      })}
                    </div>
                  )}
                  <DateChip date={d.externalDueDate} />
                </div>
              }
            />
          ))}
        </div>
      )}
    </SectionCard>
  );
}
