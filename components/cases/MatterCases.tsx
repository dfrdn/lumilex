'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowUpRight, Landmark, Plus } from 'lucide-react';
import { SubjectCard } from '@/components/ui/primitives';
import { BTN_OUTLINE } from '@/components/ui/tone';
import type { MatterCase } from '@/lib/queries/cases';
import { NewCaseModal } from './forms';
import { CaseStatusPill } from './ui';

/**
 * On a matter's page: the cases it covers, each with where it stands — or,
 * for a litigation or labor matter with none, the way to start one.
 */
export default function MatterCases({
  cases,
  matter,
  canStart,
}: {
  cases: MatterCase[];
  matter: { id: string; name: string; code: string; clientName: string; nature: string };
  canStart: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-6">
      <SubjectCard
        title={cases.length > 1 ? 'Cases' : 'Case'}
        icon={<Landmark className="w-4 h-4" />}
        action={
          canStart && (
            <button type="button" onClick={() => setOpen(true)} className={`${BTN_OUTLINE} px-2.5 py-1`}>
              <Plus className="w-3.5 h-3.5" /> {cases.length ? 'Another case' : 'Start a case'}
            </button>
          )
        }
        bodyClassName="pb-2"
      >
        {cases.length === 0 ? (
          <p className="px-5 pb-3 text-[13px] text-stone-500 dark:text-stone-400">
            This matter isn’t linked to a case yet. Start one to track its proceedings, stages and hearings.
          </p>
        ) : (
          <ul className="divide-y divide-stone-100 dark:divide-white/[0.06]">
            {cases.map((c) => (
              <li key={c.id}>
                <Link href={`/dashboard/cases/${c.id}`} className="group flex items-center gap-3 px-5 py-2.5 hover:bg-stone-50/70 dark:hover:bg-white/[0.03] transition-colors">
                  <span className="flex-1 min-w-0">
                    <span className="block text-[13px] font-medium text-stone-900 dark:text-stone-50 truncate group-hover:text-navy-700 dark:group-hover:text-navy-300">{c.title}</span>
                    <span className="block text-[11px] text-stone-500 dark:text-stone-400 truncate">
                      {[c.where ?? 'Not yet filed', c.docket].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <CaseStatusPill status={c.status} size="sm" />
                  <ArrowUpRight className="w-3.5 h-3.5 text-stone-300 dark:text-stone-600 group-hover:text-navy-600 dark:group-hover:text-navy-300 shrink-0" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </SubjectCard>
      {open && (
        <NewCaseModal
          open
          onClose={() => setOpen(false)}
          onCreated={(id) => router.push(`/dashboard/cases/${id}`)}
          prefill={{ workingTitle: matter.name, nature: matter.nature, matter: { id: matter.id, name: matter.name, code: matter.code, clientName: matter.clientName } }}
        />
      )}
    </div>
  );
}
