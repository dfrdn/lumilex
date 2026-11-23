'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { ArrowUpRight, CheckCircle2, ListTodo, Loader2, Plus } from 'lucide-react';
import type { CorporationStepOption } from '@/lib/corporations/step-tasks';
import { statusTone } from '@/lib/status-tone';
import CellDropdown from '@/components/admin/CellDropdown';
import Button from '@/components/ui/Button';
import { DueChip, StatusPill, SubjectCard } from '@/components/ui/primitives';
import { confirmAction } from '@/components/ui/confirm';

interface CompanyTask {
  id: string;
  name: string;
  status: string;
  done: boolean;
  due: string | null;
  assignees: string[];
  /** The registration it gets done, when it is one. */
  step: string | null;
}

type StepChoice = CorporationStepOption & { name: string };

const MUTED = 'text-stone-500 dark:text-stone-400';
const href = (id: string) => `/dashboard/tasks/${id}`;

/**
 * The errands for a company: its registrations — each started here as a task
 * and closed when the registration is recorded on the company — and its
 * business permit. Reloaded when the company changes, since recording a
 * registration closes its task.
 */
export default function CompanyTasks({ corporationId, version }: {
  corporationId: string;
  /** Changes whenever the company record does. */
  version: unknown;
}) {
  const [tasks, setTasks] = useState<CompanyTask[]>([]);
  const [options, setOptions] = useState<StepChoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);

  const load = useCallback(() => {
    fetch(`/api/corporation/${corporationId}/tasks`)
      .then((r) => r.json())
      .then((d) => {
        setTasks(d.tasks ?? []);
        setOptions(d.options ?? []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [corporationId]);

  useEffect(load, [load, version]);

  /** Asks first — the new task notifies the admins — then creates it. */
  async function create(o: StepChoice) {
    const ok = await confirmAction({
      title: 'Start this task?',
      message: `“${o.name}”, assigned to the matter's team. Recording the registration on the company closes it.`,
      confirmLabel: 'Start task',
    });
    if (!ok) return;
    setCreating(o.step);
    const res = await fetch(`/api/corporation/${corporationId}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ step: o.step }),
    }).catch(() => null);
    const data = await res?.json().catch(() => ({}));
    setCreating(null);
    if (!res?.ok || !data?.task) {
      toast.error(data?.error ?? 'Could not start the task');
      if (res?.status === 409) load();
      return;
    }
    const created = data.task as CompanyTask;
    setTasks((prev) => [created, ...prev]);
    setOptions((prev) => prev.filter((x) => x.step !== o.step));
    toast.success('Task started', { description: created.name });
  }

  return (
    <SubjectCard
      title="Tasks"
      icon={<ListTodo className="w-4 h-4" />}
      action={
        options.length > 0 && (
          <>
            <Button ref={anchor} variant="outline" size="sm" className="inline-flex items-center gap-1" disabled={!!creating} onClick={() => setPicking((p) => !p)}>
              {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              Start a registration
            </Button>
            {picking && (
              <CellDropdown
                mode="single"
                value={null}
                anchorRef={anchor}
                minWidth={280}
                options={options.map((o) => ({ id: o.step, label: o.label, sublabel: 'Closed when the registration is recorded' }))}
                onSelect={(id) => {
                  setPicking(false);
                  const o = options.find((x) => x.step === id);
                  if (o) void create(o);
                }}
                onClose={() => setPicking(false)}
              />
            )}
          </>
        )
      }
      bodyClassName="pb-3"
    >
      {loading ? (
        <p className={`px-5 text-sm ${MUTED}`}>Loading…</p>
      ) : tasks.length === 0 ? (
        <p className={`px-5 text-sm ${MUTED}`}>
          None yet. Start a task for a registration — recording the registration here closes it.
        </p>
      ) : (
        <ul className="divide-y divide-stone-100 dark:divide-white/[0.06]">
          {tasks.map((t) => (
            <li key={t.id}>
              <Link href={href(t.id)} className="group flex items-center gap-3 px-5 py-2.5 hover:bg-stone-50/70 dark:hover:bg-white/[0.02] transition-colors">
                <div className="flex-1 min-w-0">
                  <p className={`text-sm truncate group-hover:text-navy-700 dark:group-hover:text-navy-300 ${t.done ? MUTED : 'text-stone-900 dark:text-stone-50'}`}>{t.name}</p>
                  {t.assignees.length > 0 && <p className={`text-[11px] ${MUTED}`}>{t.assignees.join(', ')}</p>}
                </div>
                {t.done ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" aria-label="Done" />
                ) : (
                  <>
                    {t.due && <DueChip due={t.due} />}
                    <StatusPill label={t.status} tone={statusTone(t.status)} size="sm" />
                  </>
                )}
                <ArrowUpRight className="w-3.5 h-3.5 text-stone-300 group-hover:text-stone-500 dark:text-stone-600 shrink-0" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </SubjectCard>
  );
}
