'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, ClipboardList, Plus } from 'lucide-react';
import { deliverableStatusTone, isClosed } from '@/lib/deliverable-status';
import { formatDate } from '@/lib/format-date';
import Button from '@/components/ui/Button';
import { DueChip, StatusPill, SubjectCard } from '@/components/ui/primitives';
import AddDeliverableModal, { type DeliverableSubject } from '@/components/AddDeliverableModal';

interface CompanyDeliverable {
  id: string;
  name: string;
  status: string;
  type: string | null;
  due: string | null;
  doneOn: string | null;
}

const MUTED = 'text-stone-500 dark:text-stone-400';
const href = (id: string) => `/dashboard/deliverables/${id}`;

/**
 * The written work on a company — every deliverable that names it — and
 * starting new work on one of the company's matters. Registrations are its
 * tasks, not deliverables ([CompanyTasks](./CompanyTasks.tsx)).
 */
export default function CompanyDeliverables({ corporationId, companyName, version }: {
  corporationId: string;
  companyName: string;
  /** Changes whenever the company record does. */
  version: unknown;
}) {
  const [deliverables, setDeliverables] = useState<CompanyDeliverable[]>([]);
  const [subject, setSubject] = useState<DeliverableSubject | null>(null);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);

  const load = useCallback(() => {
    fetch(`/api/corporation/${corporationId}/deliverables`)
      .then((r) => r.json())
      .then((d) => {
        setDeliverables(d.deliverables ?? []);
        setSubject({ id: corporationId, name: companyName, matters: d.matters ?? [], defaultMatterId: d.defaultMatterId ?? null });
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [corporationId, companyName]);

  useEffect(load, [load, version]);

  const canAdd = !!subject && subject.matters.length > 0;

  return (
    <SubjectCard
      title="Deliverables"
      icon={<ClipboardList className="w-4 h-4" />}
      action={
        canAdd && (
          <Button variant="outline" size="sm" className="inline-flex items-center gap-1" onClick={() => setAdding(true)}>
            <Plus className="w-3.5 h-3.5" />
            New deliverable
          </Button>
        )
      }
      bodyClassName="pb-3"
    >
      {loading ? (
        <p className={`px-5 text-sm ${MUTED}`}>Loading…</p>
      ) : deliverables.length === 0 ? (
        <p className={`px-5 text-sm ${MUTED}`}>
          {canAdd
            ? 'None yet. A letter, a memo or a filing for the company goes here, on one of its matters.'
            : 'None yet. Link the company to a matter to start work on it.'}
        </p>
      ) : (
        <ul className="divide-y divide-stone-100 dark:divide-white/[0.06]">
          {deliverables.map((d) => {
            const done = isClosed(d.status);
            return (
              <li key={d.id}>
                <Link href={href(d.id)} className="group flex items-center gap-3 px-5 py-2.5 hover:bg-stone-50/70 dark:hover:bg-white/[0.02] transition-colors">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-stone-900 dark:text-stone-50 truncate group-hover:text-navy-700 dark:group-hover:text-navy-300">{d.name}</p>
                    {d.type && <p className={`text-[11px] ${MUTED}`}>{d.type}</p>}
                  </div>
                  {done ? (
                    d.doneOn && <span className={`text-xs whitespace-nowrap ${MUTED}`}>{formatDate(d.doneOn)}</span>
                  ) : (
                    d.due && <DueChip due={d.due} />
                  )}
                  <StatusPill label={d.status} tone={deliverableStatusTone(d.status)} size="sm" />
                  <ArrowUpRight className="w-3.5 h-3.5 text-stone-300 group-hover:text-stone-500 dark:text-stone-600 shrink-0" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {subject && (
        <AddDeliverableModal
          open={adding}
          onClose={() => setAdding(false)}
          subject={subject}
          onCreated={(d) => setDeliverables((prev) => [{ ...d, doneOn: null }, ...prev])}
        />
      )}
    </SubjectCard>
  );
}
